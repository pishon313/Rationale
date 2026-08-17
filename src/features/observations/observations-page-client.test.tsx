import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { Stock } from "@/features/stocks/types";
import { ObservationForm, ObservationsPageClient } from "./observations-page-client";
import type { Observation } from "./types";

const collectionMocks = vi.hoisted(() => ({
  observations: [] as Observation[],
  stocks: [] as Stock[],
  add: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/use-local-collection", () => ({
  useLocalCollection: (name: string) => name === "observations"
    ? { items: collectionMocks.observations, allItems: collectionMocks.observations, ready: true, add: collectionMocks.add, update: collectionMocks.update, remove: collectionMocks.remove }
    : { items: collectionMocks.stocks.filter((stock) => !stock.deletedAt), allItems: collectionMocks.stocks, ready: true, add: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

describe("Observation registered Stock picker", () => {
  beforeEach(() => {
    collectionMocks.observations = [];
    collectionMocks.stocks = [...sampleStocks];
    collectionMocks.add.mockReset();
    collectionMocks.update.mockReset();
    collectionMocks.remove.mockReset();
  });

  it("searches a registered Stock and saves its exact ID and current name", () => {
    const onSave = vi.fn();
    render(<ObservationForm stocks={sampleStocks} onCancel={vi.fn()} onSave={onSave} />);
    const picker = screen.getByRole("combobox", { name: "종목" });
    expect(picker).toHaveValue("");
    selectStock(picker, "MU", "MU · Micron Technology");
    fireEvent.change(screen.getByLabelText("제목"), { target: { value: "메모리 확인" } });
    fireEvent.change(screen.getByLabelText("내용"), { target: { value: "가격과 수요를 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stockId: "micron", stockName: "Micron Technology", scope: "stock" }));
  });

  it("does not silently choose the first Stock when switching Market to Stock", () => {
    render(<ObservationForm stocks={sampleStocks} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /^시장$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^종목$/ }));
    expect(screen.getByRole("combobox", { name: "종목" })).toHaveValue("");
  });

  it("filters observations by an exact searched stockId without mutating records", () => {
    collectionMocks.observations = [
      observation("micron-observation", "micron", "Micron Technology", "Micron 기록"),
      observation("tesla-observation", "tesla", "Tesla", "Tesla 기록"),
    ];
    render(<ObservationsPageClient />);
    fireEvent.click(screen.getByRole("button", { name: /^종목$/ }));
    const picker = screen.getByRole("combobox", { name: "관찰 종목 필터" });
    selectStock(picker, "MU", "MU · Micron Technology");
    expect(screen.getByText("Micron 기록")).toBeInTheDocument();
    expect(screen.queryByText("Tesla 기록")).not.toBeInTheDocument();
    expect(collectionMocks.add).not.toHaveBeenCalled();
    expect(collectionMocks.update).not.toHaveBeenCalled();
  });

  it("keeps a referenced deleted Stock available in the page filter", () => {
    const deleted = { ...sampleStocks[0], id: "deleted-stock", ticker: "OLD", name: "Old Stock", deletedAt: "2026-08-01T00:00:00Z" };
    collectionMocks.stocks = [sampleStocks[1], deleted];
    collectionMocks.observations = [observation("old-observation", deleted.id, deleted.name, "과거 기록")];
    render(<ObservationsPageClient />);
    fireEvent.click(screen.getByRole("button", { name: /^종목$/ }));
    fireEvent.focus(screen.getByRole("combobox", { name: "관찰 종목 필터" }));
    expect(screen.getByRole("option", { name: "OLD · Old Stock · 삭제됨" })).toBeInTheDocument();
  });
});

function selectStock(picker: HTMLElement, query: string, optionName: string) {
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: query } });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

function observation(id: string, stockId: string, stockName: string, title: string): Observation {
  return {
    id, scope: "stock", stockId, stockName, marketTargets: [], observedAt: "2026-08-18T10:00", title,
    content: "내용", marketCondition: "", stockView: "중립", tags: [], attachmentUrls: [],
    createdAt: "2026-08-18T10:00:00Z", updatedAt: "2026-08-18T10:00:00Z", deletedAt: null,
  };
}
