import { z } from "zod";
import { marketSectors } from "./market-sectors";
import { normalizePortfolioCategoryDisplay } from "./portfolio-categories";
import { currencies, investmentTypes, marketDataProviders, markets, stockStatuses, stockViews } from "./types";

const optionalNumber = z.preprocess(
  (value) => value === "" || value == null ? null : Number(value),
  z.number().nonnegative("0 이상의 값을 입력해 주세요.").nullable(),
);

export const stockFormSchema = z.object({
  ticker: z.string().trim().min(1, "티커를 입력해 주세요.").max(20).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1, "종목명을 입력해 주세요.").max(100),
  market: z.enum(markets),
  currency: z.enum(currencies),
  countryCode: z.string().trim().toUpperCase().regex(/^$|^[A-Z]{2}$/, "국가 코드는 ISO 두 글자로 입력해 주세요."),
  exchangeCode: z.string().trim().max(30),
  providerSymbol: z.string().trim().max(40),
  provider: z.enum(marketDataProviders),
  assetType: z.string().trim().min(1, "자산 유형을 입력해 주세요."),
  marketSector: z.preprocess((value) => value === "" || value == null ? null : value, z.enum(marketSectors).nullable()),
  sector: z.string().transform(normalizePortfolioCategoryDisplay).pipe(z.string().max(60, "내 분류는 60자 이내로 입력해 주세요.")),
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
}).superRefine((value, context) => {
  if (value.provider === "manual") return;
  for (const [path, field] of [["countryCode", value.countryCode], ["exchangeCode", value.exchangeCode], ["providerSymbol", value.providerSymbol]] as const) if (!field) context.addIssue({ code: "custom", path: [path], message: "자동 시세 연결 정보가 완전하지 않습니다." });
});

export type StockFormValues = z.input<typeof stockFormSchema>;
export type ParsedStockFormValues = z.output<typeof stockFormSchema>;
