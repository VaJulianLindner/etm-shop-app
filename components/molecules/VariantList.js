import {ResourceList, TextStyle, ButtonGroup, Button, TextField} from "@shopify/polaris";
import React, {useState, useEffect, useCallback} from "react";
import VariantItem from "./VariantItem";

const VariantList = ({existingProduct}) => {
    if (!existingProduct || !existingProduct.product) {
        return null;
    }

    // const variants = existingProduct.product.variants;
    //
    // if (!variants || !variants.edges || !variants.edges.length) {
    //     return null;
    // }
    const variants = {
        edges: []
    };
    console.log(existingProduct)

    return (
        <div className="Polaris-ResourceList__ResourceListWrapper">
            <div className="Polaris-ResourceList__HeaderOuterWrapper">
                <div>
                    <div style={{paddingBottom: "0px"}}></div>
                    <div>
                        <div className="Polaris-ResourceList__HeaderWrapper">
                            <div className="Polaris-ResourceList__HeaderContentWrapper">
                                <div className="Polaris-ResourceList__HeaderTitleWrapper">{variants.edges.length} Varianten {existingProduct.product.totalVariants}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <ul className="Polaris-ResourceList">
                {variants.edges.map((item) => <VariantItem item={item} />)}
            </ul>
        </div>
    );
};

export default VariantList;
