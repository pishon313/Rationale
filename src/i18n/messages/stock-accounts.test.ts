import { describe, expect, it } from "vitest";
import { translate } from ".";

describe("stock account messages", () => {
  it.each(["ja", "en", "fr", "it", "es"] as const)("translates stock account UI in %s", (locale) => {
    for (const key of ["보유 계좌", "현재 보유 포지션이 없습니다.", "현재 보유 계좌가 없습니다.", "보유 계좌·수량·평균단가는 종목 추가 후 매매 원장에서 등록합니다.", "계좌와 보유 수량은 매매 원장에서 관리됩니다.", "기존 보유 정보", "매매 원장 전환 전의 기존 보유 기록입니다.", "통화를 변경하면 기존 매수·매도 기록의 통화와 거래일 환율을 다시 적용합니다.", "종목 통화를 변경할까요?", "통화 변경", "영향받는 매매 기록", "영향받는 계좌", "가격 숫자는 환산하지 않습니다.", "기존 매수·매도의 통화가 {currency}(으)로 변경됩니다.", "각 거래일의 과거 환율을 다시 적용합니다.", "원화 기준 투자원금과 손익이 다시 계산됩니다.", "이 종목에는 서로 다른 통화의 매매 기록이 있어 통화를 자동으로 변경할 수 없습니다. 매매 기록의 통화를 먼저 확인해 주세요.", "{date} 거래의 과거 환율을 확인하지 못해 통화를 변경하지 않았습니다.", "통화를 변경하지 못했습니다.", "{name} 외 {count}"]) {
      expect(translate(locale, key)).not.toBe(key);
    }
  });
});
