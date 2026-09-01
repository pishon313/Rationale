import type { SecurityAssetClass, Stock } from "./types";

const bondLabels = ["bond", "bonds", "fixedincome", "treasury", "채권", "국채"];

export function inferSecurityAssetClass(assetType: string): SecurityAssetClass {
  const normalized = assetType.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
  return bondLabels.some((label) => normalized.includes(label)) ? "bond" : "equity";
}

export function securityAssetClass(stock: Pick<Stock, "assetClass" | "assetType">): SecurityAssetClass {
  return stock.assetClass ?? inferSecurityAssetClass(stock.assetType);
}

export function isBondStock(stock: Pick<Stock, "assetClass" | "assetType">) {
  return securityAssetClass(stock) === "bond";
}
