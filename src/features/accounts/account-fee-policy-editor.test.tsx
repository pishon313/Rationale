import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AccountForm } from "./accounts-page-client";
import { AccountFeePolicyEditor } from "./account-fee-policy-editor";
import type { AccountFeePolicyV1 } from "./account-fee-policy";
import type { InvestmentAccount } from "./types";

const policy: AccountFeePolicyV1 = { version: 1, enabled: true, rules: [{ id: "r1", name: "Existing", market: "미국", currency: "USD", side: "buy", ratePercent: "0.1", fixedFee: "0", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "round", roundingUnit: "0.01" }] };

describe("AccountFeePolicyEditor", () => {
  it("enables an absent policy and adds a normalized account-currency rule with preview", () => {
    render(<Harness/>);
    fireEvent.click(screen.getByRole("checkbox", { name: "수수료 정책 사용" }));
    fireEvent.click(screen.getByRole("button", { name: "수수료 규칙 추가" }));
    const dialog = screen.getByRole("dialog", { name: "수수료 규칙 추가" });
    expect(within(dialog).getByLabelText("통화")).toHaveValue("KRW");
    fireEvent.change(within(dialog).getByLabelText("수수료율 (%)"), { target: { value: "+00.1000" } });
    fireEvent.change(within(dialog).getByLabelText("예상 거래금액"), { target: { value: "10000" } });
    expect(within(dialog).getByText("10 KRW")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "규칙 저장" }));
    expect(screen.getByText("기본 수수료")).toBeInTheDocument();
    expect(screen.getByText(/0.1% \+ 0/)).toBeInTheDocument();
  });

  it("blocks a duplicated rule until its overlapping scope is resolved", () => {
    const onChange = vi.fn(); render(<AccountFeePolicyEditor value={policy} baseCurrency="USD" onChange={onChange}/>);
    fireEvent.click(screen.getByRole("button", { name: "Existing 복제" }));
    const dialog = screen.getByRole("dialog", { name: "수수료 규칙 복제" });
    fireEvent.click(within(dialog).getByRole("button", { name: "규칙 저장" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("우선순위가 같은 수수료 규칙의 적용 범위가 겹칩니다.");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("requires an alertdialog confirmation and preserves data on cancel", async () => {
    const onChange = vi.fn(); render(<AccountFeePolicyEditor value={policy} baseCurrency="USD" onChange={onChange}/>);
    const deleteButton = screen.getByRole("button", { name: "Existing 삭제" }); fireEvent.click(deleteButton);
    const confirmation = screen.getByRole("alertdialog", { name: "수수료 규칙을 삭제할까요?" });
    fireEvent.click(within(confirmation).getByRole("button", { name: "취소" }));
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(deleteButton).toHaveFocus());
    fireEvent.click(deleteButton);
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "삭제" }));
    expect(onChange).toHaveBeenCalledWith({ ...policy, rules: [] });
  });
});

describe("AccountForm fee policy persistence", () => {
  it("saves the whole normalized policy atomically with the account", async () => {
    const onSave = vi.fn<(account: InvestmentAccount) => Promise<void>>().mockResolvedValue(undefined);
    render(<AccountForm account={account} hasDefault onCancel={vi.fn()} onSave={onSave}/>);
    fireEvent.click(screen.getByRole("button", { name: "Existing 수정" }));
    const dialog = screen.getByRole("dialog", { name: "수수료 규칙 수정" });
    fireEvent.change(within(dialog).getByLabelText("고정 수수료"), { target: { value: "000.2500" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "규칙 저장" }));
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: "a", feePolicy: { version: 1, enabled: true, rules: [expect.objectContaining({ fixedFee: "0.25" })] } });
  });
});

const account: InvestmentAccount = { id: "a", name: "Account", institution: "Broker", kind: "brokerage", subtype: "", baseCurrency: "USD", isDefault: true, archivedAt: null, memo: "", feePolicy: policy, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };

function Harness() { const [value, setValue] = useState<AccountFeePolicyV1 | null>(null); return <AccountFeePolicyEditor value={value} baseCurrency="KRW" onChange={setValue}/>; }
