"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocalCollection } from "@/lib/use-local-collection";
import { translate } from "./messages";
import { isLocale, localeTags, type Locale } from "./types";

export type LanguagePreference = { id: "language"; locale: Locale; updatedAt: string };
export const fallbackLanguagePreference: LanguagePreference = { id: "language", locale: "en", updatedAt: "" };

type Params = Record<string, string | number>;
type I18nValue = {
  ready: boolean;
  locale: Locale;
  localeTag: string;
  selectedLocale: Locale | null;
  t: (key: string, params?: Params) => string;
  setLocale: (locale: Locale | null) => Promise<void>;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const fallbackI18n: I18nValue = {
  ready: false,
  locale: "en",
  localeTag: "en-US",
  selectedLocale: null,
  t: (key, params) => !params ? key : Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), key),
  setLocale: async () => undefined,
  formatDate: (input, options) => new Intl.DateTimeFormat("en-US", stableDateOptions(options)).format(new Date(input)),
  formatNumber: (input, options) => new Intl.NumberFormat("en-US", options).format(input),
};

const I18nContext = createContext<I18nValue>(fallbackI18n);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const preferences = useLocalCollection<LanguagePreference>("language-preferences", []);
  const stored = preferences.items[0];
  const selectedLocale = stored && isLocale(stored.locale) ? stored.locale : null;
  const [systemState, setSystemState] = useState<{ locale: Locale; ready: boolean }>({ locale: "en", ready: false });
  const locale = selectedLocale ?? systemState.locale;
  const localeTag = localeTags[locale];
  useEffect(() => { const update = () => setSystemState({ locale: resolveSystemLocale(systemLanguages()), ready: true }); update(); window.addEventListener("languagechange", update); return () => window.removeEventListener("languagechange", update); }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const t = useCallback((key: string, params?: Params) => {
    const message = translate(locale, key);
    if (!params) return message;
    return Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), message);
  }, [locale]);
  const replacePreferences = preferences.replaceAsync;
  const value = useMemo<I18nValue>(() => ({
    ready: preferences.ready && systemState.ready,
    locale,
    localeTag,
    selectedLocale,
    t,
    setLocale: async (next) => { await replacePreferences(next ? [{ id: "language", locale: next, updatedAt: new Date().toISOString() }] : []); },
    formatDate: (input, options) => new Intl.DateTimeFormat(localeTag, stableDateOptions(options)).format(new Date(input)),
    formatNumber: (input, options) => new Intl.NumberFormat(localeTag, options).format(input),
  }), [locale, localeTag, preferences.ready, replacePreferences, selectedLocale, systemState.ready, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function resolveSystemLocale(languages: readonly string[]): Locale {
  for (const language of languages) { const base = language.trim().toLowerCase().split(/[-_]/)[0]; if (isLocale(base)) return base; }
  return "en";
}

function systemLanguages() { return [...(navigator.languages?.length ? navigator.languages : [navigator.language])]; }

export function useI18n() {
  return useContext(I18nContext);
}

function stableDateOptions(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions | undefined {
  if (!options || options.hourCycle || !(options.timeStyle || options.hour)) return options;
  return { ...options, hourCycle: "h23" };
}
