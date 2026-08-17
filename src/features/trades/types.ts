import type { Currency } from "@/domain/currency";
import type { AccountFeeRoundingMode, AccountFeeRuleMarket } from "@/features/accounts/account-fee-policy";

export const tradeTypes = ["매수", "매도", "배당", "입금", "출금"] as const;
export const emotions = ["평온", "확신", "불안", "공포", "FOMO", "조급함", "손실 만회 심리", "과도한 자신감", "무기력", "기타"] as const;
export const tradeJournalStatuses = ["unreviewed", "recorded"] as const;
export const tradeOriginKinds = ["manual", "fileImport", "brokerApi", "system", "legacy"] as const;
export const tradeFeeModes = ["manual", "accountPolicy", "sourceProvided", "unknown"] as const;
export type RecordedRuleViolation = { ruleId: string; title: string; severity: "안내" | "주의" | "경고"; message: string };
export type TradeJournalStatus = (typeof tradeJournalStatuses)[number];
export type TradeFeeMode = (typeof tradeFeeModes)[number];
export type AccountFeeCalculationSnapshotV1 = {
  version: 1;
  policyAccountId: string;
  ruleId: string;
  ruleName: string;
  market: AccountFeeRuleMarket;
  currency: Currency;
  side: "buy" | "sell";
  ratePercent: string;
  fixedFee: string;
  minimumFee: string | null;
  maximumFee: string | null;
  grossAmountFrom: string | null;
  grossAmountTo: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  roundingMode: AccountFeeRoundingMode;
  roundingUnit: string;
  tradedAtDate: string;
  quantity: string;
  price: string;
  grossAmount: string;
  calculatedFee: string;
  calculatedAt: string;
};
export type TradeOrigin = {
  kind: (typeof tradeOriginKinds)[number];
  sourceKey?: string;
  provider?: string;
  externalExecutionId?: string;
  externalOrderId?: string;
  importBatchId?: string;
  importedAt?: string;
  sourceRow?: number;
  timePrecision?: "date" | "minute" | "second";
};
export type Trade = {
  id: string;
  stockId: string | null;
  stockName: string;
  planId: string | null;
  tradeType: (typeof tradeTypes)[number];
  tradedAt: string;
  quantity: number;
  price: number;
  amount?: number;
  isOpeningPosition?: boolean;
  cashFlowKind?: "external" | "transfer" | "reconciliation" | "opening";
  transferId?: string;
  currency: Currency;
  exchangeRate: number;
  fee: number;
  feeMode?: TradeFeeMode;
  feeCalculation?: AccountFeeCalculationSnapshotV1 | null;
  tax: number;
  accountId?: string | null;
  accountName: string;
  memo: string;
  emotion: string;
  emotionIntensity: number;
  confidenceScore: number;
  ruleComplianceScore: number;
  ruleViolations?: RecordedRuleViolation[];
  journalStatus?: TradeJournalStatus;
  origin?: TradeOrigin;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
};

export function journalStatusOf(trade: Trade): TradeJournalStatus {
  return trade.journalStatus ?? "recorded";
}

export function tradeOriginOf(trade: Trade): TradeOrigin {
  return trade.origin ?? { kind: "legacy" };
}

export function isJournalRecorded(trade: Trade) {
  return journalStatusOf(trade) === "recorded";
}
