import { describe, expect, it } from "vitest";
import { translate } from ".";
import { locales } from "../types";

const phaseTwoKeys = [
  "Contribution Plan",
  "월 저축액을 적금·주식·채권으로 나눠보세요.",
  "전체 저축액",
  "저축 비율과 세부 항목 설정",
  "적금",
  "주식 투자",
  "채권",
  "사용 안 함 · 0%",
  "적금 계좌 추가",
  "주식 종목 추가",
  "채권 종목 추가",
  "Contribution Amount 형식이 올바르지 않습니다.",
  "Allocation Group 이름을 입력해 주세요.",
  "비중은 0%부터 100%까지 소수점 둘째 자리로 입력해 주세요.",
  "활성 계좌를 선택해 주세요.",
  "등록된 종목을 선택해 주세요.",
  "Group 내부 Target 비중 합계는 정확히 100%여야 합니다.",
  "Allocation Group 비중 합계는 정확히 100%여야 합니다.",
  "0%보다 큰 카테고리에는 하나 이상의 세부 항목을 추가해 주세요.",
  "This Contribution",
  "이번 저축 실행표",
  "수동 실행표",
  "Target {count}개 · {value}%",
  "Targets {count}개 · {value}%",
  "Allocation 유효 · minor-unit 합계 일치",
  "새 리비전 저장",
  "Contribution 저장",
  "이전 Plan의 Account 연결을 완료해 주세요.",
  "복구된 Plan 활성화",
] as const;

describe("Phase 2 Portfolio Plan localization", () => {
  it("provides every new critical UI and validation key in all six locales", () => {
    for (const locale of locales) {
      for (const key of phaseTwoKeys) {
        expect(translate(locale, key), `${locale}:${key}`).toBeTruthy();
        if (locale !== "ko" && key !== "Contribution Plan" && key !== "This Contribution") expect(translate(locale, key), `${locale}:${key}`).not.toBe(key);
      }
    }
  });
});
