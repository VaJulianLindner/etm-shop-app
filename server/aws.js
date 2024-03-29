const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');

module.exports = class AWSService {
    constructor() {
        AWS.config.update({
            accessKeyId: process.env.CUSTOM_AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.CUSTOM_AWS_SECRET_ACCESS_KEY
        });

        this.s3 = new AWS.S3();
    }

    listBuckets() {
        return new Promise((resolve, reject) => {
            this.s3.listBuckets(function(err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data.Buckets);
                }
            });
        });
    }

    listObjects(bucketName) {
        return new Promise((resolve, reject) => {
            this.s3.listObjects({
                Bucket: bucketName
            }, function(err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data)
                }
            });
        });
    }

    upload(readStream, fileName) {
        const params = {
            Bucket: process.env.CUSTOM_AWS_BUCKET_NAME,
            Body: readStream,
            Key: fileName
        };

        console.log("AWS, upload:", fileName);
        return new Promise((resolve, reject) => {
            this.s3.upload(params, function (err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data.Location)
                }
            });
        });
    }

    download(fileName) {
        const params = {
            Bucket: process.env.CUSTOM_AWS_BUCKET_NAME,
            Key: fileName
        };
        console.log("AWS Download:", params);

        return new Promise((resolve, reject) => {
            this.s3.getObject(params, function (err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data.Body);
                }
            });
        });
    }
}
