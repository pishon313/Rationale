import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { sampleStocks } from "@/features/stocks/sample-data";
import { PlanForm } from "./plan-form";

const mocks = vi.hoisted(() => ({ stocks: [] as typeof sampleStocks }));
vi.mock("@/lib/use-local-collection", () => ({
  useLocalCollection: () => ({ items: mocks.stocks.filter((stock) => !stock.deletedAt), allItems: mocks.stocks, ready: true }),
}));

describe("PlanForm", () => {
  it("등록 종목을 검색하고 ID, 이름, 티커를 함께 저장한다", async () => {
    mocks.stocks = [...sampleStocks];
    const onSave = vi.fn();
    render(<PlanForm onCancel={vi.fn()} onSave={onSave} />);
    await waitFor(() => expect(screen.getByLabelText("종목")).toBeInTheDocument());
    expect(screen.getByText("조건 체크리스트")).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: "종목" });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "MU" } });
    fireEvent.click(screen.getByRole("option", { name: "MU · Micron Technology" }));
    fireEvent.change(screen.getByLabelText("계획 제목"), { target: { value: "테스트 계획" } });
    fireEvent.change(screen.getByLabelText("무효화 조건"), { target: { value: "조건 훼손" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stockId: "micron", stockName: "Micron Technology", ticker: "MU" }));
  });

  it("등록 결과가 없으면 Phase 2 온라인 검색 안내를 표시한다", async () => {
    mocks.stocks = [...sampleStocks];
    render(<PlanForm onCancel={vi.fn()} onSave={vi.fn()} />);
    const picker = await screen.findByRole("combobox", { name: "종목" });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "없는 종목" } });
    expect(screen.getByText("등록된 종목에서 찾을 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("온라인 종목 검색은 다음 단계에서 지원합니다.")).toBeInTheDocument();
  });
});
