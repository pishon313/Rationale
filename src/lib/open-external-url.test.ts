import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openExternalUrl } from "./open-external-url";

const openUrlMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

describe("openExternalUrl", () => {
  beforeEach(() => {
    openUrlMock.mockReset();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("uses the Tauri opener in the desktop app", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });

    await openExternalUrl("https://twelvedata.com/");

    expect(openUrlMock).toHaveBeenCalledWith("https://twelvedata.com/");
  });

  it("uses a new browser tab outside Tauri", async () => {
    const browserOpen = vi.spyOn(window, "open").mockImplementation(() => null);

    await openExternalUrl("https://eodhd.com/");

    expect(browserOpen).toHaveBeenCalledWith("https://eodhd.com/", "_blank", "noopener,noreferrer");
    expect(openUrlMock).not.toHaveBeenCalled();
  });
});
