import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, defaultTheme, isThemeId, readStoredTheme, storeTheme, themeIds, themeStorageKey } from "./theme-preference";

describe("theme preference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => vi.restoreAllMocks());

  it("accepts only the two V1 theme IDs", () => {
    expect(themeIds).toEqual(["mint", "rose-purple"]);
    expect(isThemeId("mint")).toBe(true);
    expect(isThemeId("rose-purple")).toBe(true);
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
    applyTheme("rose-purple");
    expect(document.documentElement).toHaveAttribute("data-theme", "rose-purple");
    applyTheme("mint");
    expect(document.documentElement).toHaveAttribute("data-theme", "mint");
  });
});
