import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { conditionTypes, planStatuses, scenarioTypes } from "@/features/plans/types";
import { reviewEvaluations } from "@/features/reviews/types";
import { ruleTypes, severities } from "@/features/rules/types";
import { investmentTypes, markets, stockStatuses, stockViews } from "@/features/stocks/types";
import { emotions, tradeTypes } from "@/features/trades/types";
import { canonicalTradeAccount, displayTradeSystemText, translateTradeText } from "@/features/trades/trade-i18n";
import { translate } from "./messages";
import { locales, type TranslatedLocale } from "./types";

const translatedLocales = locales.filter((locale): locale is TranslatedLocale => locale !== "ko");

describe("translations", () => {
  it("translates every literal Korean UI key used by the app", () => {
    const keys = [...literalUiKeys(), ...indirectUiKeys];
    for (const locale of translatedLocales) {
      const missing = keys.filter((key) => translate(locale, key) === key);
      expect(missing, `${locale} is missing: ${missing.join(" | ")}`).toEqual([]);
    }
  });

  it("preserves every interpolation placeholder", () => {
    for (const key of [...literalUiKeys(), ...indirectUiKeys]) {
      const expected = placeholders(key);
      for (const locale of translatedLocales) {
        expect(placeholders(translate(locale, key)), `${locale}: ${key}`).toEqual(expected);
      }
    }
  });

  it("translates stored domain labels without changing their canonical values", () => {
    const storedLabels = [
      ...tradeTypes, ...emotions, ...markets, ...stockStatuses, ...investmentTypes, ...stockViews,
      ...planStatuses, ...scenarioTypes, ...conditionTypes, ...reviewEvaluations, ...ruleTypes, ...severities,
    ].filter((value) => /[가-힣]/.test(value));

    expect(tradeTypes).toEqual(["매수", "매도", "배당", "입금", "출금"]);
    for (const locale of translatedLocales) {
      const missing = storedLabels.filter((label) => translate(locale, label) === label);
      expect(missing, `${locale} domain labels: ${missing.join(" | ")}`).toEqual([]);
    }
  });

  it("falls back to the original text for user-authored or unknown values", () => {
    expect(translate("en", "사용자가 직접 작성한 문장")).toBe("사용자가 직접 작성한 문장");
  });

  it("localizes only reserved trade text while preserving canonical account values", () => {
    const t = (key: string) => translate("en", key);

    expect(displayTradeSystemText("기본 계좌", t)).toBe("Default account");
    expect(displayTradeSystemText("기존 보유 포지션 자동 이관", t)).toBe("Automatic migration of an existing position");
    expect(displayTradeSystemText("사용자 계좌", t)).toBe("사용자 계좌");
    expect(displayTradeSystemText("직접 쓴 메모", t)).toBe("직접 쓴 메모");
    expect(canonicalTradeAccount("Default account", t)).toBe("기본 계좌");
    expect(canonicalTradeAccount("Import file", t)).toBe("파일 가져오기");
    expect(canonicalTradeAccount("My account", t)).toBe("My account");
  });

  it("localizes locale-sensitive CSV validation errors", () => {
    const t = (key: string, params?: Record<string, string | number>) => {
      const message = translate("en", key);
      return Object.entries(params ?? {}).reduce(
        (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
        message,
      );
    };

    expect(translateTradeText("날짜가 모호합니다: 01/08/2026. YYYY-MM-DD 형식으로 입력해 주세요.", t))
      .toBe("Date is ambiguous: 01/08/2026. Use YYYY-MM-DD.");
    expect(translateTradeText("거래 시간을 확인해 주세요: 25:00", t))
      .toBe("Check the trade time: 25:00");
  });
});

const indirectUiKeys = [
  "밝은 모드", "어두운 모드", "자동 저장됨", "이 Mac에 자동 저장",
  "인터넷 연결이 없어 마지막 저장 환율을 사용합니다.",
  "15MB 이하 이미지만 첨부할 수 있습니다.", "이미지를 읽지 못했습니다.", "지원하지 않는 이미지 형식입니다.",
  "갱신 중", "현재가 갱신", "자동 갱신", "오프라인·저장 가격", "수동 입력",
  "종목 수정", "새 종목 추가", "변경 저장",
  "준수", "미준수", "전략", "실수", "회고 수정", "새 회고",
  "관찰 기록 수정", "메모 수정", "원칙 수정", "투자 원칙 추가", "매수 계획 수정", "새 매수 계획",
  "저장된 거래 환율", "기준환율 확인 중", "저장된 환율 · 오프라인", "직접 입력한 환율",
  "{date} 기준환율 · 직접 수정 가능", "{date} 환율 · 오프라인", "기본 계좌", "기존 보유 포지션 자동 이관", "비계획",
  "기존 보유 기록을 원장으로 옮기지 못했습니다. 앱을 다시 열어 재시도해 주세요.",
  "원장 기록을 저장하지 못했습니다. 다시 시도해 주세요.",
  "{count}건의 거래 내역을 원장에 추가했습니다.", "기록을 삭제하고 전체 원장을 다시 계산했습니다.",
  "기존 보유 수량 확인 필요", "기초 현금이 등록되지 않은 계좌가 있습니다",
  "표시된 현금은 현재 기록의 순현금흐름입니다. 실제 잔액을 맞추려면 가장 오래된 날짜로 입금 기록을 추가하세요.",
  "{stock}: 오류가 있는 매매 기록을 먼저 확인해 주세요.",
  "{stock}: 종목 보유 수량 {stockQuantity}주와 매매 원장 {ledgerQuantity}주가 다릅니다.",
  "{stock}: 종목 통화 {stockCurrency}와 매매 원장 통화 {ledgerCurrency}가 다릅니다.",
  "{stock}: 종목 평균단가 {stockPrice}와 매매 원장 평균단가 {ledgerPrice}가 다릅니다.",
  "거래금액 {amount}이 한도 {limit}을 초과합니다.",
  "거래 후 현금 비중이 최소 {percent}% 아래로 내려갑니다.", "거래 후 종목 비중이 최대 {percent}%를 초과합니다.",
  "파일 문자 인코딩을 읽을 수 없습니다.",
  "날짜가 모호합니다: {value}. YYYY-MM-DD 형식으로 입력해 주세요.", "거래 시간을 확인해 주세요: {value}",
];

function literalUiKeys() {
  const roots = ["app", "components", "features"].map((directory) => path.resolve("src", directory));
  const keys = new Set<string>();
  const pattern = /\bt\(\s*["`]([^"`]+)["`]/g;
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(pattern)) if (/[가-힣]/.test(match[1])) keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(item);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name) ? [item] : [];
  });
}

function placeholders(value: string) {
  return [...value.matchAll(/\{[^}]+\}/g)].map((match) => match[0]).sort();
}
