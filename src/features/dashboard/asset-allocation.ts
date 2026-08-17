import type { MarketSectorId } from "@/features/stocks/market-sectors";
import { normalizePortfolioCategoryDisplay, normalizePortfolioCategoryKey } from "@/features/stocks/portfolio-categories";

export type AssetGroupingMode = "portfolio-category" | "market-sector";

export type AssetAllocationItem = {
  id: string;
  name: string;
  value: number;
  share: number;
  portfolioCategory: string;
  marketSector: MarketSectorId | null;
};

export type AssetAllocationGroup = {
  id: string;
  name: string;
  value: number;
  share: number;
  holdings: AssetAllocationItem[];
  isUnspecified: boolean;
};

type GroupOptions = {
  mode: AssetGroupingMode;
  unspecifiedLabel: string;
  marketSectorLabel: (id: MarketSectorId) => string;
};

const ASSET_GROUP_COLORS = [
  "#5f57d9",
  "#45a99a",
  "#e0a144",
  "#d96b76",
  "#5d8cc9",
  "#a477bd",
  "#7c8b57",
  "#dc7d3f",
  "#2f9fbd",
  "#b56c9d",
  "#6f9f4f",
  "#d2594d",
  "#796ec8",
  "#3eaaa8",
] as const;

export function buildAssetAllocationGroups(data: readonly AssetAllocationItem[], options: GroupOptions): AssetAllocationGroup[] {
  const grouped = new Map<string, AssetAllocationGroup>();
  for (const item of data) {
    const identity = groupIdentity(item, options);
    const group = grouped.get(identity.id) ?? {
      id: identity.id,
      name: identity.name,
      value: 0,
      share: 0,
      holdings: [],
      isUnspecified: identity.isUnspecified,
    };
    group.value += item.value;
    group.share += item.share;
    group.holdings.push(item);
    grouped.set(identity.id, group);
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      holdings: [...group.holdings].sort((left, right) => right.value - left.value || left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => Number(left.isUnspecified) - Number(right.isUnspecified) || right.value - left.value || left.name.localeCompare(right.name));
}

function groupIdentity(item: AssetAllocationItem, options: GroupOptions) {
  if (options.mode === "market-sector") {
    return item.marketSector
      ? { id: `market-sector:${item.marketSector}`, name: options.marketSectorLabel(item.marketSector), isUnspecified: false }
      : { id: "market-sector:__unspecified__", name: options.unspecifiedLabel, isUnspecified: true };
  }

  const name = normalizePortfolioCategoryDisplay(item.portfolioCategory);
  const key = normalizePortfolioCategoryKey(name);
  return key
    ? { id: `portfolio-category:${key}`, name, isUnspecified: false }
    : { id: "portfolio-category:__unspecified__", name: options.unspecifiedLabel, isUnspecified: true };
}

export function colorForAssetGroup(groupId: string) {
  let hash = 2166136261;
  for (let index = 0; index < groupId.length; index += 1) {
    hash ^= groupId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ASSET_GROUP_COLORS[(hash >>> 0) % ASSET_GROUP_COLORS.length];
}

export type AllocationShareDisplayPolicy = {
  value: number;
  lessThan: boolean;
  options: Intl.NumberFormatOptions;
};

export function allocationShareDisplayPolicy(share: number): AllocationShareDisplayPolicy {
  if (share <= 0) {
    return { value: 0, lessThan: false, options: { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 } };
  }
  if (share < 0.1) {
    return { value: 0.001, lessThan: true, options: { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 } };
  }
  if (share < 1) {
    return { value: share / 100, lessThan: false, options: { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 2 } };
  }
  return { value: share / 100, lessThan: false, options: { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 } };
}

export function formatAllocationShare(share: number, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string) {
  const policy = allocationShareDisplayPolicy(share);
  const formatted = formatNumber(policy.value, policy.options);
  return policy.lessThan ? `<${formatted}` : formatted;
}

export function assetGroupColorPaletteSize() {
  return ASSET_GROUP_COLORS.length;
}
