import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { PlanForm } from "./plan-form";

describe("PlanForm", () => {
  it("종목과 계획 조건 입력 화면을 제공한다", () => {
    render(<PlanForm onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByLabelText("종목")).toBeInTheDocument();
    expect(screen.getByText("조건 체크리스트")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("계획 제목"), { target: { value: "테스트 계획" } });
  });
});
