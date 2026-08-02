import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "./i18n-provider";

describe("I18nProvider", () => {
  beforeEach(() => localStorage.clear());

  it("changes language immediately and restores the saved preference", async () => {
    const first = render(<I18nProvider><Probe /></I18nProvider>);
    expect(screen.getByText("대시보드")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await screen.findByText("Dashboard");
    expect(document.documentElement.lang).toBe("en");
    expect(JSON.parse(localStorage.getItem("tradejournal.language-preferences.v1") ?? "[]")[0].locale).toBe("en");

    first.unmount();
    render(<I18nProvider><Probe /></I18nProvider>);
    await screen.findByText("Dashboard");
  });

  it("falls back safely when an old or damaged preference has an unknown locale", async () => {
    localStorage.setItem("tradejournal.language-preferences.v1", JSON.stringify([{ id: "language", locale: "xx", updatedAt: "" }]));
    render(<I18nProvider><Probe /></I18nProvider>);
    await waitFor(() => expect(screen.getByText("대시보드")).toBeInTheDocument());
    expect(document.documentElement.lang).toBe("ko");
  });
});

function Probe() {
  const { t, setLocale } = useI18n();
  return <><span>{t("대시보드")}</span><button onClick={() => void setLocale("en")}>English</button></>;
}
