type Params = Record<string, string | number>;

export type TradeTranslator = (key: string, params?: Params) => string;
export type TradeNumberFormatter = (value: number, options?: Intl.NumberFormatOptions) => string;

const reservedAccountNames = ["기본 계좌", "파일 가져오기"] as const;
const reservedSystemTexts = new Set<string>([
  ...reservedAccountNames,
  "기존 보유 포지션 자동 이관",
  "증권사 거래 내역 가져오기",
]);

type Pattern = {
  expression: RegExp;
  key: string;
  params: (match: RegExpMatchArray) => Params;
};

const patterns: Pattern[] = [
  { expression: /^(.*): 오류가 있는 매매 기록을 먼저 확인해 주세요\.$/, key: "{stock}: 오류가 있는 매매 기록을 먼저 확인해 주세요.", params: (match) => ({ stock: match[1] }) },
  { expression: /^(.*): 종목 보유 수량 (.*)주와 매매 원장 (.*)주가 다릅니다\.$/, key: "{stock}: 종목 보유 수량 {stockQuantity}주와 매매 원장 {ledgerQuantity}주가 다릅니다.", params: (match) => ({ stock: match[1], stockQuantity: match[2], ledgerQuantity: match[3] }) },
  { expression: /^(.*): 종목 통화 (.*)와 매매 원장 통화 (.*)가 다릅니다\.$/, key: "{stock}: 종목 통화 {stockCurrency}와 매매 원장 통화 {ledgerCurrency}가 다릅니다.", params: (match) => ({ stock: match[1], stockCurrency: match[2], ledgerCurrency: match[3] }) },
  { expression: /^(.*): 종목 평균단가 (.*)와 매매 원장 평균단가 (.*)가 다릅니다\.$/, key: "{stock}: 종목 평균단가 {stockPrice}와 매매 원장 평균단가 {ledgerPrice}가 다릅니다.", params: (match) => ({ stock: match[1], stockPrice: match[2], ledgerPrice: match[3] }) },
  { expression: /^거래금액 (.*)이 한도 (.*)을 초과합니다\.$/, key: "거래금액 {amount}이 한도 {limit}을 초과합니다.", params: (match) => ({ amount: match[1], limit: match[2] }) },
  { expression: /^거래 후 현금 비중이 최소 (.*)% 아래로 내려갑니다\.$/, key: "거래 후 현금 비중이 최소 {percent}% 아래로 내려갑니다.", params: (match) => ({ percent: match[1] }) },
  { expression: /^거래 후 종목 비중이 최대 (.*)%를 초과합니다\.$/, key: "거래 후 종목 비중이 최대 {percent}%를 초과합니다.", params: (match) => ({ percent: match[1] }) },
  { expression: /^종목을 찾을 수 없습니다: (.*)$/, key: "종목을 찾을 수 없습니다: {value}", params: (match) => ({ value: match[1] }) },
  { expression: /^숫자 형식이 올바르지 않습니다: (.*)$/, key: "숫자 형식이 올바르지 않습니다: {value}", params: (match) => ({ value: match[1] }) },
  { expression: /^매수\/매도 구분을 확인해 주세요: (.*)$/, key: "매수/매도 구분을 확인해 주세요: {value}", params: (match) => ({ value: match[1] }) },
  { expression: /^지원하지 않는 통화입니다: (.*)$/, key: "지원하지 않는 통화입니다: {value}", params: (match) => ({ value: match[1] }) },
  { expression: /^날짜가 모호합니다: (.*)\. YYYY-MM-DD 형식으로 입력해 주세요\.$/, key: "날짜가 모호합니다: {value}. YYYY-MM-DD 형식으로 입력해 주세요.", params: (match) => ({ value: match[1] }) },
  { expression: /^거래일 형식을 확인해 주세요: (.*)$/, key: "거래일 형식을 확인해 주세요: {value}", params: (match) => ({ value: match[1] }) },
  { expression: /^거래 시간을 확인해 주세요: (.*)$/, key: "거래 시간을 확인해 주세요: {value}", params: (match) => ({ value: match[1] }) },
  { expression: /^(\d+)건의 거래 내역을 원장에 추가했습니다\.$/, key: "{count}건의 거래 내역을 원장에 추가했습니다.", params: (match) => ({ count: match[1] }) },
  { expression: /^(\d+)건의 거래 내역을 추가하고 (\d+)건을 복원했습니다\.$/, key: "{inserted}건의 거래 내역을 추가하고 {restored}건을 복원했습니다.", params: (match) => ({ inserted: match[1], restored: match[2] }) },
];

export function translateTradeText(value: string, t: TradeTranslator, formatNumber?: TradeNumberFormatter): string {
  for (const pattern of patterns) {
    const match = value.match(pattern.expression);
    if (match) {
      const params = pattern.params(match);
      if (typeof params.value === "string") params.value = t(params.value);
      if (formatNumber) {
        for (const name of ["count", "inserted", "restored", "amount", "limit", "percent", "stockQuantity", "ledgerQuantity", "stockPrice", "ledgerPrice"]) {
          const raw = params[name];
          if (typeof raw !== "string") continue;
          const numeric = Number(raw.replaceAll(",", ""));
          if (Number.isFinite(numeric)) params[name] = formatNumber(numeric);
        }
      }
      return t(pattern.key, params);
    }
  }

  const separator = value.indexOf(": ");
  if (separator > 0) {
    const prefix = value.slice(0, separator);
    const suffix = value.slice(separator + 2);
    const translated = translateTradeText(suffix, t, formatNumber);
    if (translated !== suffix) return `${prefix}: ${translated}`;
  }

  return t(value);
}

/** Translates only exact, app-generated values and leaves user-authored text untouched. */
export function displayTradeSystemText(value: string, t: TradeTranslator): string {
  return reservedSystemTexts.has(value) ? t(value) : value;
}

/** Keeps reserved account names canonical even when the user selects their translated label. */
export function canonicalTradeAccount(value: string, t: TradeTranslator): string {
  return reservedAccountNames.find((name) => value === name || value === t(name)) ?? value;
}
