import { describe, expect, it } from "vitest";
import { translate } from ".";

describe("stock account messages", () => {
  it.each(["ja", "en", "fr", "it", "es"] as const)("translates stock account UI in %s", (locale) => {
    for (const key of ["보유 계좌", "현재 보유 포지션이 없습니다.", "현재 보유 계좌가 없습니다.", "보유 계좌·수량·평균단가는 종목 추가 후 매매 원장에서 등록합니다.", "계좌와 보유 수량은 매매 원장에서 관리됩니다.", "기존 보유 정보", "매매 원장 전환 전의 기존 보유 기록입니다.", "{name} 외 {count}"]) {
      expect(translate(locale, key)).not.toBe(key);
    }
  });
});
