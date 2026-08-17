import type { AssetGroupingMode } from "./asset-allocation";

export const ASSET_GROUPING_KEY = "tradejournal.dashboard.asset-grouping";
export const ASSET_GROUPING_EVENT = "tradejournal:asset-grouping";
export const DEFAULT_ASSET_GROUPING: AssetGroupingMode = "portfolio-category";

export function isAssetGroupingMode(value: unknown): value is AssetGroupingMode {
  return value === "portfolio-category" || value === "market-sector";
}

export function getAssetGroupingServerSnapshot(): AssetGroupingMode {
  return DEFAULT_ASSET_GROUPING;
}

export function getAssetGroupingSnapshot(): AssetGroupingMode {
  if (typeof window === "undefined") return DEFAULT_ASSET_GROUPING;
  const stored = window.localStorage.getItem(ASSET_GROUPING_KEY);
  return isAssetGroupingMode(stored) ? stored : DEFAULT_ASSET_GROUPING;
}

export function subscribeAssetGrouping(callback: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === ASSET_GROUPING_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(ASSET_GROUPING_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(ASSET_GROUPING_EVENT, callback);
  };
}

export function setAssetGrouping(mode: AssetGroupingMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ASSET_GROUPING_KEY, mode);
  window.dispatchEvent(new Event(ASSET_GROUPING_EVENT));
}
