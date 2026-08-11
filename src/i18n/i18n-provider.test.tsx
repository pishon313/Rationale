import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("ignores a legacy saved preference", async () => {
    localStorage.setItem("tradejournal.language-preferences.v1", JSON.stringify([{ id: "language", locale: "ko", updatedAt: "" }]));
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    render(<I18nProvider><Probe /></I18nProvider>);

    await screen.findByText("Tableau de bord");
    expect(document.documentElement.lang).toBe("fr");
  });
});

function Probe() {
  const { t } = useI18n();
  return <span>{t("대시보드")}</span>;
}
