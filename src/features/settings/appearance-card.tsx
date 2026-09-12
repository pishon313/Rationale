"use client";

import { Check, Palette } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { applyTheme, defaultTheme, readAppliedTheme, storeTheme, subscribeToTheme, themeIds, type ThemeId } from "./theme-preference";

const themeCopy: Record<ThemeId, { label: string; description: string }> = {
  mint: { label: "민트", description: "차분하고 집중된" },
  "rose-purple": { label: "로즈 퍼플", description: "따뜻하고 현대적인" },
};

export function AppearanceCard() {
  const { t } = useI18n();
  const theme = useSyncExternalStore(subscribeToTheme, readAppliedTheme, () => defaultTheme);

  function selectTheme(next: ThemeId) {
    applyTheme(next);
    storeTheme(next);
  }

  return <section className="rounded-xl border bg-[var(--surface)] p-5" aria-labelledby="appearance-title">
    <div className="flex items-center gap-2"><Palette size={19} className="text-[var(--accent)]" /><h2 id="appearance-title" className="font-semibold">{t("외관")}</h2></div>
    <fieldset className="mt-4">
      <legend className="text-sm font-medium">{t("색상 테마")}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {themeIds.map((id) => {
          const copy = themeCopy[id];
          const selected = theme === id;
          const descriptionId = `theme-${id}-description`;
          return <label key={id} className="theme-option" data-selected={selected}>
            <input
              className="sr-only"
              type="radio"
              name="color-theme"
              value={id}
              checked={selected}
              onChange={() => selectTheme(id)}
              aria-label={t(copy.label)}
              aria-describedby={descriptionId}
            />
            <span className="theme-preview" data-theme-preview={id} aria-hidden="true"><i /><i /><i /></span>
            <span className="min-w-0 flex-1"><b className="block text-sm">{t(copy.label)}</b><small id={descriptionId} className="mt-0.5 block text-xs text-[var(--muted)]">{t(copy.description)}</small></span>
            {selected && <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)]"><Check size={14} aria-hidden="true" />{t("현재 테마")}</span>}
          </label>;
        })}
      </div>
    </fieldset>
  </section>;
}
