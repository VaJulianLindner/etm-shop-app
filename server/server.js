import "@babel/polyfill";
import fs from "fs";
import path from "path";
import gql from "graphql-tag";
import dotenv from "dotenv";
import "isomorphic-fetch";
import createShopifyAuth, {verifyRequest} from "@shopify/koa-shopify-auth";
import Shopify, {ApiVersion} from "@shopify/shopify-api";
import {createClient, updateProduct, removeMetafield, getProduct} from "./handlers/index";
import Koa from "koa";
import next from "next";
import Router from "koa-router";
import KoaBody from "koa-body";
import speakingurl from "speakingurl";
import AWSService from "./aws";
import getProductBySku from "./handlers/mutations/getProductBySku";

dotenv.config();
const port = parseInt(process.env.PORT, 10) || 8081;
const dev = process.env.NODE_ENV !== "production";
const app = next({
    dev,
});
const handle = app.getRequestHandler();
const aws = new AWSService();
const client = createClient(process.env.SHOP, process.env.ETM_SHOPIFY_KEY, process.env.ETM_SHOPIFY_PASSWORD);

Shopify.Context.initialize({
    API_KEY: process.env.SHOPIFY_API_KEY,
    API_SECRET_KEY: process.env.SHOPIFY_API_SECRET,
    SCOPES: process.env.SCOPES.split(","),
    HOST_NAME: process.env.HOST.replace(/https:\/\//, ""),
    API_VERSION: ApiVersion.October20,
    IS_EMBEDDED_APP: true,
    // This should be replaced with your preferred storage strategy
    SESSION_STORAGE: new Shopify.Session.MemorySessionStorage(),
});

// Storing the currently active shops in memory will force them to re-login when your server restarts. You should
// persist this object in your app.
const ACTIVE_SHOPIFY_SHOPS = {};
const ACTIVE_SHOPIFY_SHOPS_REDIRECTS = {};
const ALLOWED_INITIAL_URL_FOR_REDIRECT = [
    "/product/upload"
];
const IMAGE_TYPE_SUFFIXES = [
    "gif",
    "jpg",
    "jpeg",
    "png"
];

app.prepare().then(async () => {
    const server = new Koa();
    const router = new Router();
    server.keys = [Shopify.Context.API_SECRET_KEY];
    server.use(
        createShopifyAuth({
            async afterAuth(ctx) {
                // Access token and shop available in ctx.state.shopify
                const {shop, accessToken, scope} = ctx.state.shopify;
                const host = ctx.query.host;
                ACTIVE_SHOPIFY_SHOPS[shop] = scope;

                const response = await Shopify.Webhooks.Registry.register({
                    shop,
                    accessToken,
                    path: "/webhooks",
                    topic: "APP_UNINSTALLED",
                    webhookHandler: async (topic, shop, body) =>
                        delete ACTIVE_SHOPIFY_SHOPS[shop],
                });

                if (!response.success) {
                    console.log(`Failed to register APP_UNINSTALLED webhook: ${response.result}`);
                }

                let redirectUrl = "/";
                let queryString = "shop=" + shop + "&host=" + host;
                if (ACTIVE_SHOPIFY_SHOPS_REDIRECTS && ACTIVE_SHOPIFY_SHOPS_REDIRECTS[shop]) {
                    let tempUrl = new URL("https://" + process.env.SHOP + ACTIVE_SHOPIFY_SHOPS_REDIRECTS[shop]);
                    redirectUrl = tempUrl.pathname;
                    queryString += "&id=" + tempUrl.searchParams.get("id");
                }

                // Redirect to app with shop parameter upon auth
                ctx.redirect(`${redirectUrl}?${queryString}`);
            },
        })
    );

    const handleRequest = async (ctx) => {
        await handle(ctx.req, ctx.res);
        ctx.respond = false;
        ctx.res.statusCode = 200;
    };

    router.post("/webhooks", async (ctx) => {
        try {
            await Shopify.Webhooks.Registry.process(ctx.req, ctx.res);
            console.log(`Webhook processed, returned status code 200`);
        } catch (error) {
            console.log(`Failed to process webhook: ${error}`);
        }
    });

    router.post("/graphql", verifyRequest({returnHeader: true}), async (ctx, next) => {
        await Shopify.Utils.graphqlProxy(ctx.req, ctx.res);
    });

    router.get("/product/download/:productHash", async (ctx, next) => {
        const {productHash} = ctx.params;

        if (!productHash) {
            ctx.res.status = 400;
            ctx.body = "productId missing";
            return;
        }

        const productId = Buffer.from(productHash, "hex").toString();
        const shopifyId = "gid://shopify/Product/" + productId;
        const res = await getProduct(client, shopifyId);

        if (!res.data || !res.data.product) {
            ctx.res.status = 404;
            ctx.body = "no product found for id " + shopifyId;
            return;
        }

        const metafields = res.data.product.metafields;

        if (!metafields || !metafields.edges || !metafields.edges.length) {
            ctx.res.status = 404;
            ctx.body = "no attached files found for product with id " + shopifyId;
            return;
        }

        const downloadFields = metafields.edges.map(edge => edge.node).filter(node => node.key === "filename");

        if (!downloadFields.length) {
            ctx.res.status = 404;
            ctx.body = "no attached files found for product with id " + shopifyId;
            return;
        }

        //TODO check ob releasedatum erreicht

        const downloadField = downloadFields[0];
        const fileName = String(downloadField.value);
        const fileSuffix = String(fileName.split("-").pop()).toLowerCase();

        ctx.set("Content-disposition", "attachment; filename=" + (fileName.replace("-" + fileSuffix, "." + fileSuffix)));
        if (IMAGE_TYPE_SUFFIXES.indexOf(fileSuffix) !== -1) {
            ctx.set("Content-type", "image/" + fileSuffix);
        } else if (fileSuffix === "pdf") {
            ctx.set("Content-type", "application/" + fileSuffix);
        }
        ctx.body = await aws.download("downloads/" + fileName);
    });

    router.post("/product/upload/:productId", KoaBody({multipart: true, keepExtensions: true}), async (ctx, next) => {
        const {productId} = ctx.params;
        const body = ctx.request.body;
        const file = ctx.request.files?.file;

        if (!productId) {
            ctx.res.status = 400;
            ctx.body = "productId missing";
            return;
        }

        const shopifyId = "gid://shopify/Product/" + productId;
        const metafields = [];

        if (file) {
            try {
                const downloads = String(body.downloads).length ? body.downloads.split(",") : [];
                if (downloads && downloads.length) {
                    for (let i = 0; i < downloads.length; i++) {
                        await removeMetafield(client, downloads[i]);
                    }
                }
            } catch (e) {
                console.log("error in removeMetafield", e.toString());
            }

            const slug = speakingurl(file.name);
            const reader = fs.createReadStream(file.path);

            metafields.push({
                description: "filename of the associated download attachment",
                namespace: "Download",
                key: "filename",
                value: slug,
                valueType: "STRING"
            });
            metafields.push({
                description: "filename of the associated download attachment",
                namespace: "Download",
                key: "idhash",
                value: Buffer.from(productId, "utf-8").toString("hex"),
                valueType: "STRING"
            });

            try {
                await aws.upload(reader, "downloads/" + slug);
            } catch (e) {
                console.log(e);
                ctx.body = e.toString();
            }
        }

        if (body.uploaddate) {

        }

        const res = await updateProduct(client, shopifyId, metafields);
        ctx.body = "ok";
    });

    router.post("/product/find/:sku", async (ctx, next) => {
        const {sku} = ctx.params;

        if (!sku) {
            ctx.res.status = 400;
            ctx.body = "sku missing";
            return;
        }

        try {
            const res = await getProductBySku(client, `sku:${sku}`);
            ctx.body = res.data;
        } catch (e) {
            console.log(e);
            ctx.body = {
                empty: true
            };
        }
    });

    router.post("/product/:productId", async (ctx, next) => {
        const {productId} = ctx.params;

        if (!productId) {
            ctx.res.status = 400;
            ctx.body = "productId missing";
            return;
        }

        const shopifyId = "gid://shopify/Product/" + productId;

        try {
            const res = await getProduct(client, shopifyId);
            ctx.body = res.data;
        } catch (e) {
            console.log(e);
            ctx.body = {
                empty: true
            };
        }
    });

    router.get("(/_next/static/.*)", handleRequest); // Static content is clear
    router.get("/_next/webpack-hmr", handleRequest); // Webpack content is clear
    router.get("(.*)", async (ctx) => {
        const shop = ctx.query.shop;

        // This shop hasn't been seen yet, go through OAuth to create a session
        if (ACTIVE_SHOPIFY_SHOPS[shop] === undefined) {
            ACTIVE_SHOPIFY_SHOPS_REDIRECTS[shop] = ctx.req.url;
            ctx.redirect(`/auth?shop=${shop}`);
        } else {
            await handleRequest(ctx);
        }
    });

    server.use(router.allowedMethods());
    server.use(router.routes());
    server.listen(port, () => {
        console.log(`> Ready on http://localhost:${port}`);
    });
});
