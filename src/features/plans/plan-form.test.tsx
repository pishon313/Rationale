import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import type { InstrumentSearchResult } from "@/features/stocks/market-data";
import { sampleStocks } from "@/features/stocks/sample-data";
import { PlanForm } from "./plan-form";

const mocks = vi.hoisted(() => ({ stocks: [] as typeof sampleStocks, isTauri: false, invoke: vi.fn() }));
vi.mock("@/lib/use-local-collection", () => ({
  useLocalCollection: () => ({ items: mocks.stocks.filter((stock) => !stock.deletedAt), allItems: mocks.stocks, ready: true }),
}));
vi.mock("@/lib/local-repository", () => ({ isTauriApp: () => mocks.isTauri }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

const remoteResult = (overrides: Partial<InstrumentSearchResult> = {}): InstrumentSearchResult => ({
  provider: "eodhd", providerSymbol: "CRWD.US", ticker: "CRWD", name: "CrowdStrike Holdings", countryCode: "US", countryName: "USA",
  exchangeCode: "US", exchangeMic: "XNAS", exchangeName: "NASDAQ", currency: "USD", assetType: "Common Stock",
  isin: "US22788C1053", previousClose: 430.25, previousCloseDate: "2026-08-17", isPrimary: true, ...overrides,
});

describe("PlanForm", () => {
  beforeEach(() => { mocks.isTauri = false; mocks.invoke.mockReset(); });

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

  it("브라우저에서는 온라인 검색이 비활성화되지만 등록 종목 선택은 계속 동작한다", async () => {
    mocks.stocks = [...sampleStocks];
    const onSave = vi.fn();
    render(<PlanForm onCancel={vi.fn()} onSave={onSave} />);
    const picker = await screen.findByRole("combobox", { name: "종목" });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "없는 종목" } });
    expect(screen.getByText("등록된 종목에서 찾을 수 없습니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "온라인에서 ‘없는 종목’ 검색" }));
    expect(screen.getByText("온라인 종목 검색은 Mac 앱에서만 사용할 수 있습니다.")).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: "MU" } });
    fireEvent.click(screen.getByRole("option", { name: "MU · Micron Technology" }));
    fireEvent.change(screen.getByLabelText("계획 제목"), { target: { value: "로컬 계획" } });
    fireEvent.change(screen.getByLabelText("무효화 조건"), { target: { value: "조건 훼손" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stockId: "micron" })));
  });

  it("온라인 신규 종목은 확인 후에도 Plan 저장 전까지 생성 요청을 하지 않는다", async () => {
    mocks.stocks = [...sampleStocks]; mocks.isTauri = true; mocks.invoke.mockResolvedValue([remoteResult()]);
    const onSave = vi.fn(); const onCancel = vi.fn();
    render(<PlanForm onCancel={onCancel} onSave={onSave} />);
    const picker = screen.getByRole("combobox", { name: "종목" });
    fireEvent.focus(picker); fireEvent.change(picker, { target: { value: "CRWD" } });
    fireEvent.click(screen.getByRole("button", { name: "온라인에서 ‘CRWD’ 검색" }));
    fireEvent.click(await screen.findByRole("button", { name: /CRWD · CrowdStrike Holdings/ }));
    const dialog = screen.getByRole("alertdialog", { name: "종목 추가 확인" });
    fireEvent.click(within(dialog).getByRole("button", { name: "추가하고 계획 만들기" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("계획을 저장할 때 이 종목을 관찰 상태로 함께 추가합니다.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onCancel).toHaveBeenCalledTimes(1); expect(onSave).not.toHaveBeenCalled();
  });

  it("온라인 신규 종목을 관찰 기본값의 draft로 넘기고 Plan이 같은 ID를 사용한다", async () => {
    mocks.stocks = [...sampleStocks]; mocks.isTauri = true; mocks.invoke.mockResolvedValue([remoteResult()]);
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PlanForm onCancel={vi.fn()} onSave={onSave} />);
    const picker = screen.getByRole("combobox", { name: "종목" });
    fireEvent.focus(picker); fireEvent.change(picker, { target: { value: "CRWD" } });
    fireEvent.click(screen.getByRole("button", { name: "온라인에서 ‘CRWD’ 검색" }));
    fireEvent.click(await screen.findByRole("button", { name: /CRWD · CrowdStrike Holdings/ }));
    fireEvent.click(screen.getByRole("button", { name: "추가하고 계획 만들기" }));
    fireEvent.change(screen.getByLabelText("계획 제목"), { target: { value: "CRWD 계획" } });
    fireEvent.change(screen.getByLabelText("무효화 조건"), { target: { value: "조건 훼손" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [savedPlan, selection] = onSave.mock.calls[0];
    expect(selection).toMatchObject({ kind: "create", stock: { id: expect.any(String), ticker: "CRWD", status: "관찰", investmentType: "관찰 전용" } });
    expect(savedPlan).toMatchObject({ stockId: selection.stock.id, stockName: "CrowdStrike Holdings", ticker: "CRWD" });
  });

  it("온라인 결과가 활성 Stock과 일치하면 기존 ID를 선택하고 중복 생성하지 않는다", async () => {
    const existing = { ...sampleStocks[0], id: "existing-crwd", ticker: "CRWD", name: "CrowdStrike Holdings", market: "미국" as const, currency: "USD" as const, isin: "US22788C1053", providerRefs: [{ provider: "eodhd" as const, symbol: "CRWD.US", exchangeCode: "US" }] };
    mocks.stocks = [existing, ...sampleStocks]; mocks.isTauri = true; mocks.invoke.mockResolvedValue([remoteResult()]);
    const onSave = vi.fn(); render(<PlanForm onCancel={vi.fn()} onSave={onSave} />);
    const picker = screen.getByRole("combobox", { name: "종목" }); fireEvent.focus(picker); fireEvent.change(picker, { target: { value: "remote" } });
    fireEvent.click(screen.getByRole("button", { name: "온라인에서 ‘remote’ 검색" }));
    fireEvent.click(await screen.findByRole("button", { name: /CRWD · CrowdStrike Holdings/ }));
    expect(screen.getByText("이미 등록된 종목을 선택했습니다.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("계획 제목"), { target: { value: "Existing" } }); fireEvent.change(screen.getByLabelText("무효화 조건"), { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stockId: "existing-crwd" })));
  });

  it("삭제된 exact Stock은 명시적으로 복원하고 지원하지 않는 통화는 차단한다", async () => {
    const deleted = { ...sampleStocks[0], id: "deleted-crwd", ticker: "CRWD", name: "Old CrowdStrike", isin: "US22788C1053", providerRefs: [{ provider: "eodhd" as const, symbol: "CRWD.US", exchangeCode: "US" }], deletedAt: "2026-08-01T00:00:00Z" };
    mocks.stocks = [deleted, ...sampleStocks]; mocks.isTauri = true; mocks.invoke.mockResolvedValue([remoteResult(), remoteResult({ providerSymbol: "VOD.LSE", ticker: "VOD", name: "Vodafone", exchangeCode: "LSE", currency: "GBP", isin: "GB00BH4HKS39" })]);
    const onSave = vi.fn(); render(<PlanForm onCancel={vi.fn()} onSave={onSave} />);
    const picker = screen.getByRole("combobox", { name: "종목" }); fireEvent.focus(picker); fireEvent.change(picker, { target: { value: "remote" } });
    fireEvent.click(screen.getByRole("button", { name: "온라인에서 ‘remote’ 검색" }));
    expect(await screen.findByRole("button", { name: /VOD · Vodafone/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /CRWD · CrowdStrike Holdings/ }));
    const dialog = screen.getByRole("alertdialog", { name: "삭제된 종목 복원" });
    fireEvent.click(within(dialog).getByRole("button", { name: "종목 복원 후 계획 만들기" }));
    fireEvent.change(screen.getByLabelText("계획 제목"), { target: { value: "Restore" } }); fireEvent.change(screen.getByLabelText("무효화 조건"), { target: { value: "invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stockId: "deleted-crwd", stockName: "Old CrowdStrike" }), { kind: "restore", stockId: "deleted-crwd" }));
  });
});
