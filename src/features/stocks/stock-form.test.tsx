import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { StockForm } from "./stock-form";

describe("StockForm", () => {
  it("필수 필드 없이 제출하면 오류를 표시한다", async () => {
    render(<StockForm onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("티커"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "종목 추가" }));
    await waitFor(() => expect(screen.getByText("티커를 입력해 주세요.")).toBeInTheDocument());
  });
});
