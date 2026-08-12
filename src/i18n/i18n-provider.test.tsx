import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, resolveSystemLocale, useI18n } from "./i18n-provider";

describe("resolveSystemLocale", () => {
  it("uses the first supported base language", () => {
    expect(resolveSystemLocale(["zh-Hans", "fr-CA", "en-US"])).toBe("fr");
    expect(resolveSystemLocale(["xx", "ko_KR"])).toBe("ko");
  });

  it("falls back to English when no language is supported", () => {
    expect(resolveSystemLocale(["zh-Hans", "de-DE"])).toBe("en");
    expect(resolveSystemLocale([])).toBe("en");
  });
});

describe("I18nProvider", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("follows the Mac language and reacts to language changes", async () => {
    const languages = vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ja-JP"]);
    render(<I18nProvider><Probe /></I18nProvider>);

    await screen.findByText("ダッシュボード");
    expect(document.documentElement.lang).toBe("ja");

    languages.mockReturnValue(["de-DE"]);
    window.dispatchEvent(new Event("languagechange"));

    await screen.findByText("Dashboard");
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps a saved manual language instead of the Mac language", async () => {
    localStorage.setItem("tradejournal.language-preferences.v1", JSON.stringify([{ id: "language", locale: "ko", updatedAt: "" }]));
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    render(<I18nProvider><Probe /></I18nProvider>);

    await screen.findByText("대시보드");
    expect(document.documentElement.lang).toBe("ko");
  });

  it("saves a manual language and can return to the Mac language", async () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ja-JP"]);
    render(<I18nProvider><Probe /></I18nProvider>);

    await screen.findByText("ダッシュボード");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await screen.findByText("Dashboard");
    await waitFor(() => expect(JSON.parse(localStorage.getItem("tradejournal.language-preferences.v1") ?? "[]")[0]?.locale).toBe("en"));

    fireEvent.click(screen.getByRole("button", { name: "System" }));
    await screen.findByText("ダッシュボード");
    await waitFor(() => expect(localStorage.getItem("tradejournal.language-preferences.v1")).toBe("[]"));
  });
});

function Probe() {
  const { setLocale, t } = useI18n();
  return <><span>{t("대시보드")}</span><button onClick={() => void setLocale("en")}>English</button><button onClick={() => void setLocale(null)}>System</button></>;
}
