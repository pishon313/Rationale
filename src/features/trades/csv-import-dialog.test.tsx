import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";
import { buildTabularColumns } from "@/features/import/column-mapping";
import type { ImportMappingProfile, ImportPreview, ParsedTabularFile } from "@/features/import/import-types";
import type { InvestmentAccount } from "@/features/accounts/types";
import { CsvImportDialog } from "./csv-import-dialog";

const mocks = vi.hoisted(() => ({
  parseImportFile: vi.fn(),
  buildImportPreview: vi.fn(),
  preflightImport: vi.fn(() => ({ ok: true, plan: { insertedTrades: [], restoredTrades: [], restoredTradeIds: [], allTrades: [] }, issues: [] })),
  useLocalCollection: vi.fn(),
}));

vi.mock("@/features/import/tabular-parser", () => ({ parseImportFile: mocks.parseImportFile }));
vi.mock("@/features/import/import-pipeline", () => ({ buildImportPreview: mocks.buildImportPreview, preflightImport: mocks.preflightImport }));
vi.mock("@/lib/use-local-collection", () => ({ useLocalCollection: mocks.useLocalCollection }));
vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => Object.entries(params ?? {}).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), key),
    formatNumber: (value: number) => String(value),
  }),
}));

const parsed: ParsedTabularFile = {
  columns: buildTabularColumns(["거래일", "구분", "수량", "가격", "종목코드", "비고"]),
  rows: [["2026-08-12", "매수", "1", "100", "TEST", "sample"]],
};
const bindings = Object.fromEntries([
  ["tradedAt", 0], ["tradeType", 1], ["quantity", 2], ["price", 3], ["ticker", 4],
].map(([field, index]) => [field, parsed.columns[index as number].reference]));
const account: InvestmentAccount = { id: "account", name: "Account", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
const profile: ImportMappingProfile = { id: "profile", name: "Broker", version: 1, bindings, headerSignature: parsed.columns.map((column) => `${column.reference.normalizedHeader}#${column.reference.occurrence}`).sort().join("|"), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

function preview(): ImportPreview {
  return { candidates: [], issues: [], requiresTimezoneConfirmation: false, summary: { ready: 0, exact_duplicate: 0, possible_duplicate: 0, previously_deleted: 0, source_conflict: 0, rejected: 0 } };
}

function mockProfileStore(initial: ImportMappingProfile[], persist: (next: ImportMappingProfile[]) => Promise<void> = async () => undefined) {
  mocks.useLocalCollection.mockImplementation(() => {
    const [items, setItems] = useState(initial);
    return {
      items, allItems: items, ready: true, loadError: "",
      replaceAsync: async (next: ImportMappingProfile[]) => { await persist(next); setItems(next); },
    };
  });
}

function renderDialog(onCancel = vi.fn()) {
  const result = render(<CsvImportDialog stocks={[]} accounts={[account]} existing={[]} onCancel={onCancel} onImport={vi.fn(async () => true)} />);
  const input = result.container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["content"], "trades.csv", { type: "text/csv" })] } });
  return { ...result, onCancel };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.parseImportFile.mockResolvedValue(parsed);
  mocks.buildImportPreview.mockResolvedValue(preview());
  window.confirm = vi.fn(() => true);
  mockProfileStore([]);
});

describe("CsvImportDialog state hardening", () => {
  it("cancels a stale preview immediately and lets a newer generation win", async () => {
    const requestA = deferred<ImportPreview>();
    const requestB = deferred<ImportPreview>();
    mocks.buildImportPreview.mockReturnValueOnce(requestA.promise).mockReturnValueOnce(requestB.promise);
    const { onCancel } = renderDialog();

    const review = await screen.findByRole("button", { name: "거래 후보 검토" });
    fireEvent.click(review);
    expect(screen.getByRole("button", { name: "거래 후보를 만들고 있습니다..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("증권사 또는 파일 출처"), { target: { value: "changed" } });
    expect(screen.getByRole("button", { name: "거래 후보 검토" })).toBeEnabled();
    expect(screen.queryByText("가져오기 후보")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onCancel).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "거래 후보 검토" }));
    requestA.resolve(preview());
    await Promise.resolve();
    expect(screen.getByRole("button", { name: "거래 후보를 만들고 있습니다..." })).toBeDisabled();
    expect(screen.queryByText("가져오기 후보")).not.toBeInTheDocument();

    requestB.resolve(preview());
    await waitFor(() => expect(screen.getByText("가져오기 후보")).toBeInTheDocument());
    expect(screen.queryByText("거래 후보를 만들고 있습니다...")).not.toBeInTheDocument();
    expect(screen.queryByText("가져오기 미리보기를 만들지 못했습니다.")).not.toBeInTheDocument();
  });

  it("suppresses an error from a canceled preview generation", async () => {
    const request = deferred<ImportPreview>();
    mocks.buildImportPreview.mockReturnValueOnce(request.promise);
    renderDialog();
    fireEvent.click(await screen.findByRole("button", { name: "거래 후보 검토" }));
    fireEvent.change(screen.getByLabelText("증권사 또는 파일 출처"), { target: { value: "new source" } });
    request.reject(new Error("stale failure"));
    await waitFor(() => expect(screen.getByRole("button", { name: "거래 후보 검토" })).toBeEnabled());
    expect(screen.queryByText("가져오기 미리보기를 만들지 못했습니다.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("detaches a blank profile without losing assignments", async () => {
    mockProfileStore([profile]);
    renderDialog();
    await waitFor(() => expect(screen.getAllByText("프로필", { exact: true })).toHaveLength(5));
    fireEvent.change(screen.getByLabelText("매핑 프로필"), { target: { value: "" } });
    expect(screen.getByLabelText("거래일 열 매핑")).toHaveValue("tradedAt");
    expect(screen.getAllByText("직접 연결", { exact: true })).toHaveLength(5);
    expect(screen.queryByRole("button", { name: "프로필 업데이트" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "프로필 삭제" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새 프로필로 저장" })).toBeEnabled();
    expect(screen.getByText("저장되지 않은 변경")).toBeVisible();
  });

  it("detaches only after profile deletion persistence succeeds", async () => {
    mockProfileStore([profile]);
    renderDialog();
    await waitFor(() => expect(screen.getAllByText("프로필", { exact: true })).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "프로필 삭제" }));
    await waitFor(() => expect(screen.getAllByText("직접 연결", { exact: true })).toHaveLength(5));
    expect(screen.getByLabelText("매핑 프로필")).toHaveValue("");
    expect(screen.getByLabelText("거래일 열 매핑")).toHaveValue("tradedAt");
    expect(screen.getByRole("button", { name: "거래 후보 검토" })).toBeEnabled();
  });

  it("keeps profile provenance when profile deletion persistence fails", async () => {
    mockProfileStore([profile], async () => { throw new Error("storage failed"); });
    renderDialog();
    await waitFor(() => expect(screen.getAllByText("프로필", { exact: true })).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "프로필 삭제" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("매핑 프로필을 삭제하지 못했습니다."));
    expect(screen.getByLabelText("매핑 프로필")).toHaveValue("profile");
    expect(screen.getAllByText("프로필", { exact: true })).toHaveLength(5);
    expect(screen.getByLabelText("거래일 열 매핑")).toHaveValue("tradedAt");
  });
});
