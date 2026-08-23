export const portfolioPlanStateId = "default" as const;

export type PortfolioPlanState = {
  id: typeof portfolioPlanStateId;
  activeRevisionId: string | null;
  updatedAt: string;
};

export type PortfolioPlanRevision = {
  id: string;
  revisionNumber: number;
  basedOnRevisionId: string | null;
  /** KRW amount the allocation percentages are applied to. Missing on legacy V1 records. */
  targetAmountKrw?: number | null;
  thesis: string;
  changeNote: string;
  createdAt: string;
  activatedAt: string | null;
  updatedAt: string;
};

type PortfolioAllocationTargetBase = {
  id: string;
  revisionId: string;
  targetWeightBps: number;
  sortOrder: number;
  updatedAt: string;
};

export type PortfolioAllocationTarget =
  | (PortfolioAllocationTargetBase & { targetType: "stock"; stockId: string })
  | (PortfolioAllocationTargetBase & { targetType: "cash"; stockId: null });

export type PortfolioAllocationDraft =
  | { targetType: "stock"; stockId: string; targetWeightBps: number; sortOrder: number }
  | { targetType: "cash"; stockId: null; targetWeightBps: number; sortOrder: number };
