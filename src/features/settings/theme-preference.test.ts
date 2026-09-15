import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, defaultTheme, isThemeId, readStoredTheme, storeTheme, themeBootstrapScript, themeIds, themeStorageKey } from "./theme-preference";

describe("theme preference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => vi.restoreAllMocks());

  it("accepts only the four V2 theme IDs", () => {
    expect(themeIds).toEqual(["mint", "rose-purple", "midnight", "lemon"]);
    for (const theme of themeIds) expect(isThemeId(theme)).toBe(true);
    expect(isThemeId("unknown")).toBe(false);
  });

  it("uses Mint for missing or invalid storage without writing a default", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    expect(readStoredTheme()).toBe(defaultTheme);
    localStorage.setItem(themeStorageKey, "unknown");
    expect(readStoredTheme()).toBe(defaultTheme);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it.each(themeIds)("round-trips %s", (theme) => {
    storeTheme(theme);
    expect(readStoredTheme()).toBe(theme);
  });

  it("falls back without throwing when storage reads fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readStoredTheme()).toBe(defaultTheme);
  });

  it("does not throw when storage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => storeTheme("rose-purple")).not.toThrow();
  });

  it("applies and replaces the exact root attribute", () => {
    for (const theme of themeIds) {
      applyTheme(theme);
      expect(document.documentElement).toHaveAttribute("data-theme", theme);
    }
  });

  it.each(themeIds)("bootstraps stored %s before hydration", (theme) => {
    localStorage.setItem(themeStorageKey, theme);
    Function(themeBootstrapScript)();
    expect(document.documentElement).toHaveAttribute("data-theme", theme);
  });

  it("bootstraps Mint for invalid storage or read failures", () => {
    localStorage.setItem(themeStorageKey, "unknown");
    Function(themeBootstrapScript)();
    expect(document.documentElement).toHaveAttribute("data-theme", defaultTheme);

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    document.documentElement.removeAttribute("data-theme");
    Function(themeBootstrapScript)();
    expect(document.documentElement).toHaveAttribute("data-theme", defaultTheme);
  });
});
