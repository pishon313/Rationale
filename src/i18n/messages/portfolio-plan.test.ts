import { describe, expect, it } from "vitest";
import { translate } from ".";
import { locales } from "../types";

const phaseTwoKeys = [
  "Contribution Plan",
  "Contribution Amount 형식이 올바르지 않습니다.",
  "Allocation Group 이름을 입력해 주세요.",
  "비중은 0%부터 100%까지 소수점 둘째 자리로 입력해 주세요.",
  "활성 계좌를 선택해 주세요.",
  "등록된 종목을 선택해 주세요.",
  "Group 내부 Target 비중 합계는 정확히 100%여야 합니다.",
  "Allocation Group 비중 합계는 정확히 100%여야 합니다.",
  "This Contribution",
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
