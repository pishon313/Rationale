import { describe, expect, it } from "vitest";
import { sampleStocks } from "@/features/stocks/sample-data";
import { sampleTrades } from "./sample-data";
import type { Trade } from "./types";
import { migrateTrades, projectStocksFromTrades } from "./migrate-trades";

describe("migrateTrades", () => {
  it("거래 내역이 없는 기존 보유 종목을 현금 영향 없는 시작 포지션으로 이관한다", () => {
    const stock = { ...sampleStocks[0], id: "legacy", quantity: 3, averagePrice: 100 };
    const result = migrateTrades([stock], []);
    expect(result.addedOpeningPositions).toBe(1);
    expect(result.trades[0].isOpeningPosition).toBe(true);
    expect(result.trades[0].quantity).toBe(3);
  });

  it("보유 수량이 0인 기존 관찰 종목은 시작 거래 없이 원장 관리로 전환한다", () => {
    const stock = { ...sampleStocks[1], id: "watch-only", quantity: 0, averagePrice: 0, ledgerInitializedAt: null };
    const result = migrateTrades([stock], []);

    expect(result.addedOpeningPositions).toBe(0);
    expect(result.trades).toHaveLength(0);
    expect(result.initializedStockIds).toContain(stock.id);
  });

  it("과거 버전에서 삭제된 보유 종목도 기초 포지션으로 복구한다", () => {
    const stock = { ...sampleStocks[0], id: "deleted-holding", quantity: 3, averagePrice: 100, ledgerInitializedAt: null, deletedAt: "2026-01-02" };
    const result = migrateTrades([stock], []);

    expect(result.addedOpeningPositions).toBe(1);
    expect(result.initializedStockIds).toContain(stock.id);
    expect(result.trades[0]).toEqual(expect.objectContaining({ stockId: stock.id, quantity: 3, isOpeningPosition: true }));
  });

  it("매매 원장과 보유 수량이 일치하면 시작 포지션을 중복 생성하지 않는다", () => {
    const result = migrateTrades(sampleStocks, sampleTrades);
    expect(result.addedOpeningPositions).toBe(0);
    expect(result.unresolvedStockIds).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("원장 이관이 끝난 종목은 거래 삭제 후에도 시작 포지션을 다시 만들지 않는다", () => {
    const stock = { ...sampleStocks[0], ledgerInitializedAt: "2026-01-01" };
    expect(migrateTrades([stock], []).addedOpeningPositions).toBe(0);
  });

  it("삭제된 과거 시작 포지션과 ID가 겹치면 새 ID로 이관한다", () => {
    const stock = { ...sampleStocks[0], id: "legacy", quantity: 3, averagePrice: 100 };
    const deletedOpening: Trade = {
      ...sampleTrades[0],
      id: "opening-position:legacy",
      stockId: stock.id,
      stockName: stock.name,
      deletedAt: "2026-01-02",
    };
    const result = migrateTrades([stock], [deletedOpening]);

    expect(result.trades[0].id).toBe("opening-position:legacy:2");
    expect(new Set(result.trades.map((trade) => trade.id)).size).toBe(result.trades.length);
  });

  it("기존 보유 수량과 원장 수량이 다르면 경고하고 이관 완료로 표시하지 않는다", () => {
    const stock = { ...sampleStocks[0], id: "mismatch", quantity: 5, averagePrice: 100, ledgerInitializedAt: null };
    const trade: Trade = { ...sampleTrades[0], id: "mismatch-buy", stockId: stock.id, stockName: stock.name, quantity: 2, price: 100 };
    const result = migrateTrades([stock], [trade]);

    expect(result.warnings).toHaveLength(1);
    expect(result.initializedStockIds).not.toContain(stock.id);
    expect(result.unresolvedStockIds).toContain(stock.id);
    expect(result.addedOpeningPositions).toBe(0);
  });

  it("수량 불일치가 해결되지 않은 종목은 기존 보유 스냅샷을 유지한다", () => {
    const stock = { ...sampleStocks[0], id: "raw-mismatch", quantity: 5, averagePrice: 100, ledgerInitializedAt: null };
    const trade: Trade = { ...sampleTrades[0], id: "raw-mismatch-buy", stockId: stock.id, stockName: stock.name, quantity: 2, price: 100, fee: 0 };
    const [projected] = projectStocksFromTrades([stock], [trade]);

    expect(projected.quantity).toBe(5);
    expect(projected.averagePrice).toBe(100);
  });

  it("수량이 같아도 원가 차이가 수수료 허용 범위를 넘으면 해결되지 않은 상태로 남긴다", () => {
    const stock = { ...sampleStocks[0], id: "cost-mismatch", quantity: 2, averagePrice: 150, ledgerInitializedAt: null };
    const trade: Trade = { ...sampleTrades[0], id: "cost-mismatch-buy", stockId: stock.id, stockName: stock.name, quantity: 2, price: 100, fee: 0 };
    const result = migrateTrades([stock], [trade]);
    const [projected] = projectStocksFromTrades([stock], [trade]);

    expect(result.unresolvedStockIds).toContain(stock.id);
    expect(result.initializedStockIds).not.toContain(stock.id);
    expect(result.warnings[0]).toContain("평균단가");
    expect(projected.averagePrice).toBe(150);
  });

  it("종목과 원장의 통화가 다르면 기존 스냅샷을 유지한다", () => {
    const stock = { ...sampleStocks[0], id: "currency-mismatch", quantity: 2, averagePrice: 100, currency: "KRW" as const, ledgerInitializedAt: null };
    const trade: Trade = { ...sampleTrades[1], id: "currency-mismatch-buy", stockId: stock.id, stockName: stock.name, quantity: 2, price: 100, fee: 0 };
    const result = migrateTrades([stock], [trade]);
    const [projected] = projectStocksFromTrades([stock], [trade]);

    expect(result.unresolvedStockIds).toContain(stock.id);
    expect(result.warnings[0]).toContain("통화");
    expect(projected.currency).toBe("KRW");
    expect(projected.averagePrice).toBe(100);
  });

  it("이관 완료 종목의 유일한 매수가 삭제되면 보유 수량과 평균단가를 0으로 투영한다", () => {
    const stock = { ...sampleStocks[0], id: "deleted-only", quantity: 3, averagePrice: 100, ledgerInitializedAt: "2026-01-01" };
    const deletedTrade: Trade = { ...sampleTrades[0], id: "deleted-buy", stockId: stock.id, stockName: stock.name, quantity: 3, price: 100, deletedAt: "2026-01-02" };
    const [projected] = projectStocksFromTrades([stock], [deletedTrade]);

    expect(projected.quantity).toBe(0);
    expect(projected.averagePrice).toBe(0);
  });

  it("보유량 0인 종목은 삭제된 과거 매매가 있어도 빈 원장 상태로 초기화한다", () => {
    const stock = { ...sampleStocks[0], id: "historical-deleted", quantity: 0, averagePrice: 100, ledgerInitializedAt: null };
    const deletedTrade: Trade = { ...sampleTrades[0], id: "historical-buy", stockId: stock.id, stockName: stock.name, deletedAt: "2026-01-02" };
    const [projected] = projectStocksFromTrades([stock], [deletedTrade]);

    expect(projected.quantity).toBe(0);
    expect(projected.averagePrice).toBe(0);
  });
});
