import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMigrationGate, resetAccountMigrationInitialization } from "./account-migration-gate";

const mocks = vi.hoisted(() => ({ load: vi.fn(), migrate: vi.fn() }));
vi.mock("@/lib/local-repository", () => ({ loadCollection: mocks.load }));
vi.mock("./migrate-accounts", () => ({ persistLegacyAccountMigration: mocks.migrate }));

beforeEach(() => {
  resetAccountMigrationInitialization();
  mocks.load.mockReset().mockResolvedValue([]);
  mocks.migrate.mockReset();
});

describe("AccountMigrationGate", () => {
  it("shows children after migration succeeds", async () => {
    mocks.migrate.mockResolvedValue({ changed: false });
    render(<AccountMigrationGate><p>앱 본문</p></AccountMigrationGate>);
    expect(await screen.findByText("앱 본문")).toBeInTheDocument();
  });

  it("blocks children on failure and retries the migration from storage", async () => {
    mocks.migrate.mockRejectedValueOnce(new Error("disk")).mockResolvedValueOnce({ changed: false });
    render(<AccountMigrationGate><p>앱 본문</p></AccountMigrationGate>);
    expect(await screen.findByRole("alert")).toHaveTextContent("기존 계좌 데이터를 준비하지 못했습니다");
    expect(screen.queryByText("앱 본문")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(mocks.migrate).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("앱 본문")).toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledTimes(4);
  });
});
