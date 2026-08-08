import { z } from "zod";
import { currencies, investmentTypes, markets, stockStatuses, stockViews } from "./types";

const optionalNumber = z.preprocess(
  (value) => value === "" || value == null ? null : Number(value),
  z.number().nonnegative("0 이상의 값을 입력해 주세요.").nullable(),
);

export const stockFormSchema = z.object({
  ticker: z.string().trim().min(1, "티커를 입력해 주세요.").max(20).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "종목명을 입력해 주세요.").max(100),
  market: z.enum(markets),
  currency: z.enum(currencies),
  assetType: z.string().trim().min(1, "자산 유형을 입력해 주세요."),
  sector: z.string().trim().max(60),
  status: z.enum(stockStatuses),
  investmentType: z.enum(investmentTypes),
  currentPrice: z.coerce.number().nonnegative("0 이상의 값을 입력해 주세요."),
  targetPrice: optionalNumber,
  averagePrice: z.coerce.number().nonnegative("0 이상의 값을 입력해 주세요."),
  quantity: z.coerce.number().nonnegative("0 이상의 값을 입력해 주세요."),
  thesisSummary: z.string().trim().max(500),
  currentView: z.enum(stockViews),
  currentViewMemo: z.string().trim().max(1000),
  nextReviewDate: z.string().nullable(),
  reviewNote: z.string().trim().max(300, "검토할 사항은 300자 이내로 입력해 주세요."),
  nextEarningsDate: z.string().nullable(),
  tagsText: z.string(),
});

export type StockFormValues = z.input<typeof stockFormSchema>;
export type ParsedStockFormValues = z.output<typeof stockFormSchema>;
