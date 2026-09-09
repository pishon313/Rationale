import type { Currency } from "@/domain/currency";

export const portfolioPlanStateId = "default" as const;

export type LegacyPortfolioPlanStateV6 = {
  id: typeof portfolioPlanStateId;
  activeRevisionId: string | null;
  updatedAt: string;
};

export type LegacyPortfolioPlanRevisionV6 = {
  id: string;
  revisionNumber: number;
  basedOnRevisionId: string | null;
  targetAmountKrw?: number | null;
  thesis: string;
  changeNote: string;
  createdAt: string;
  activatedAt: string | null;
  updatedAt: string;
};

export type LegacyPortfolioAllocationTargetV6 = {
  id: string;
  revisionId: string;
  targetWeightBps: number;
  sortOrder: number;
  updatedAt: string;
} & ({ targetType: "stock"; stockId: string } | { targetType: "cash"; stockId: null });

/** Migration-only storage. It keeps V6 intent intact until account selection can be repaired. */
export type PortfolioPlanRepairDraft = {
  version: 1;
  status: "needsAccountSelection";
  legacyState: LegacyPortfolioPlanStateV6 | null;
  legacyRevisions: LegacyPortfolioPlanRevisionV6[];
  legacyTargets: LegacyPortfolioAllocationTargetV6[];
  unresolvedTargetIds: string[];
  /** Deterministic V6 mappings found during migration. Older V7 backups may omit it. */
  inferredAccountIdsByTargetId?: Record<string, string>;
};

export type PortfolioBalancePolicy = {
  version: 1;
  mode: "fixed" | "balanceAssist";
  targetWeightsBps: {
    savings: number;
    stocks: number;
    bonds: number;
  };
  toleranceBps: number;
  /** Optional target mix inside the Stocks bucket. When present, its weights total 100%. */
  stockTargets?: Array<{ stockId: string; targetWeightBps: number }>;
  stockToleranceBps?: number;
  updatedAt: string;
};

export type PortfolioPlanState = {
  id: typeof portfolioPlanStateId;
  activeRevisionId: string | null;
  contributionAmountMinor: number;
  contributionCurrency: Currency;
  updatedAt: string;
  repairDraft?: PortfolioPlanRepairDraft | null;
  balancePolicy?: PortfolioBalancePolicy | null;
};

export type PortfolioPlanRevision = {
  id: string;
  revisionNumber: number;
  basedOnRevisionId: string | null;
  thesis: string;
  changeNote: string;
  createdAt: string;
  activatedAt: string | null;
  updatedAt: string;
};

export type PortfolioAllocationGroup = {
  id: string;
  revisionId: string;
  name: string;
  targetWeightBps: number;
  sortOrder: number;
  updatedAt: string;
};

type PortfolioAllocationTargetBase = {
  id: string;
  revisionId: string;
  groupId: string;
  /** Optional execution hint. A Plan describes intent and does not require an Account. */
  accountId: string | null;
  weightWithinGroupBps: number;
  sortOrder: number;
  updatedAt: string;
};

export type PortfolioAllocationTarget =
  | (PortfolioAllocationTargetBase & { targetType: "stock"; stockId: string })
  | (PortfolioAllocationTargetBase & { targetType: "cash"; stockId: null });

export type PortfolioAllocationGroupDraft = {
  id: string;
  name: string;
  targetWeightBps: number;
  sortOrder: number;
};

export type PortfolioAllocationTargetDraft =
  | { groupId: string; accountId: string | null; targetType: "stock"; stockId: string; weightWithinGroupBps: number; sortOrder: number }
  | { groupId: string; accountId: string | null; targetType: "cash"; stockId: null; weightWithinGroupBps: number; sortOrder: number };
