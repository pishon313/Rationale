import { describe, expect, it } from "vitest";
import { sampleTrades } from "@/features/trades/sample-data";
import type { InvestmentAccount } from "./types";
import { archiveAccount, buildAccountMerge, withSingleDefault } from "./account-operations";

const now = "2026-08-08T00:00:00.000Z";
const account = (id: string, name: string, isDefault = false): InvestmentAccount => ({ id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault, archivedAt: null, memo: "", createdAt: now, updatedAt: now });

describe("account operations", () => {
  it("allows a zero-balance account and keeps at most one default", () => {
    const result = withSingleDefault([account("a", "A", true)], account("b", "B", true));
    expect(result.filter((item) => item.isDefault).map((item) => item.id)).toEqual(["b"]);
    expect(result[0]).not.toHaveProperty("balance");
  });
  it("archives instead of deleting and promotes another active default", () => {
    const result = archiveAccount([account("a", "A", true), account("b", "B")], "a", now);
    expect(result).toHaveLength(2); expect(result.find((item) => item.id === "a")?.archivedAt).toBe(now); expect(result.find((item) => item.id === "b")?.isDefault).toBe(true);
  });
  it("merges by accountId without rewriting legacy accountName", () => {
    const trades = [{ ...sampleTrades[0], accountId: "a", accountName: "Old snapshot" }];
    const writes = buildAccountMerge([account("a", "Renamed"), account("b", "Target")], trades, "a", "b", now);
    const merged = writes.find((write) => write.collection === "trades")?.values[0] as typeof trades[number];
    expect(merged.accountId).toBe("b"); expect(merged.accountName).toBe("Old snapshot");
  });
  it("rejects an invalid merge before persistence", () => {
    expect(() => buildAccountMerge([account("a", "A")], [], "a", "a", now)).toThrow("서로 다른 계좌");
  });
});
