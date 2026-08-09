import { render, screen } from "@testing-library/react";
import { AppHeader } from "./app-header";

describe("AppHeader", () => {
  it("접근 가능한 전체 검색 필드를 보여준다", () => {
    render(<AppHeader />);
    expect(screen.getByRole("textbox", { name: "전체 검색" })).toBeInTheDocument();
    expect(screen.getByText("Why did I make this investment?")).toBeInTheDocument();
  });
});
