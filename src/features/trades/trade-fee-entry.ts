import Decimal from "decimal.js";
import { calculateAccountFee, type AccountFeeCalculationResult } from "@/features/accounts/account-fee-policy";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type { AccountFeeCalculationSnapshotV1, Trade, TradeFeeMode } from "./types";

export type TradeFeeBasis = {
  accountId: string;
  stockId: string;
  tradeType: Trade["tradeType"];
  tradedAt: string;
  quantity: number;
  price: number;
  currency: Trade["currency"];
};

export type AutomaticTradeFeeEvaluation =
  | { status: "ineligible"; reason: "unsupported-type" | "opening-position" | "missing-account" | "missing-stock" | "policy-disabled" }
  | { status: "incomplete" }
  | AccountFeeCalculationResult;

export type TradeFeeEntryState =
  | { mode: "manual"; value: string; explicitlySelected: boolean }
  | { mode: "auto" }
  | { mode: "preserved"; feeMode: TradeFeeMode | undefined; value: string; snapshot: AccountFeeCalculationSnapshotV1 | null | undefined };

export function createInitialTradeFeeEntryState(input: {
  trade?: Trade;
  account?: InvestmentAccount;
  stock?: Stock;
  openingPosition: boolean;
  tradeType: Trade["tradeType"];
}): TradeFeeEntryState {
  if (input.trade) return { mode: "preserved", feeMode: input.trade.feeMode, value: decimalInput(input.trade.fee), snapshot: input.trade.feeCalculation };
  return automaticFeeEligible(input) ? { mode: "auto" } : { mode: "manual", value: "0", explicitlySelected: false };
}

export function automaticFeeEligible(input: { account?: InvestmentAccount; stock?: Stock; openingPosition: boolean; tradeType: Trade["tradeType"] }) {
  return !input.openingPosition && (input.tradeType === "매수" || input.tradeType === "매도") && Boolean(input.account?.feePolicy?.enabled && input.stock);
}

export function evaluateAutomaticTradeFee(input: {
  account?: InvestmentAccount;
  stock?: Stock;
  openingPosition: boolean;
  basis: TradeFeeBasis;
}): AutomaticTradeFeeEvaluation {
  if (input.openingPosition) return { status: "ineligible", reason: "opening-position" };
  if (input.basis.tradeType !== "매수" && input.basis.tradeType !== "매도") return { status: "ineligible", reason: "unsupported-type" };
  if (!input.account) return { status: "ineligible", reason: "missing-account" };
  if (!input.stock) return { status: "ineligible", reason: "missing-stock" };
  if (!input.account.feePolicy?.enabled) return { status: "ineligible", reason: "policy-disabled" };
  if (!Number.isFinite(input.basis.quantity) || !Number.isFinite(input.basis.price) || input.basis.quantity <= 0 || input.basis.price <= 0) return { status: "incomplete" };
  const grossAmount = new Decimal(input.basis.quantity).mul(input.basis.price);
  return calculateAccountFee(input.account.feePolicy, {
    accountId: input.account.id,
    market: input.stock.market,
    currency: input.basis.currency,
    side: input.basis.tradeType === "매수" ? "buy" : "sell",
    tradedAt: input.basis.tradedAt,
    grossAmount,
  });
}

export function tradeFeeBasisKey(basis: TradeFeeBasis) {
  return JSON.stringify([
    basis.accountId,
    basis.stockId,
    basis.tradeType,
    basis.tradedAt.slice(0, 10),
    decimalInput(basis.quantity),
    decimalInput(basis.price),
    basis.currency,
  ]);
}

export function savedTradeFeeBasisKey(trade: Trade) {
  return tradeFeeBasisKey({
    accountId: trade.accountId ?? "",
    stockId: trade.stockId ?? "",
    tradeType: trade.tradeType,
    tradedAt: trade.tradedAt,
    quantity: trade.quantity,
    price: trade.price,
    currency: trade.currency,
  });
}

function decimalInput(value: number) {
  try { const decimal = new Decimal(value); return decimal.isFinite() ? decimal.toFixed() : String(value); } catch { return String(value); }
}
