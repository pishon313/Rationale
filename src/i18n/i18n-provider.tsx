"use client";

import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { useLocalCollection } from "@/lib/use-local-collection";
import { translate } from "./messages";
import { isLocale, localeTags, type Locale } from "./types";

export type LanguagePreference = { id: "language"; locale: Locale; updatedAt: string };
export const fallbackLanguagePreference: LanguagePreference = { id: "language", locale: "ko", updatedAt: "" };

type Params = Record<string, string | number>;
type I18nValue = {
  ready: boolean;
  locale: Locale;
  localeTag: string;
  t: (key: string, params?: Params) => string;
  setLocale: (locale: Locale) => Promise<void>;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const fallbackI18n: I18nValue = {
  ready: false,
  locale: "ko",
  localeTag: "ko-KR",
  t: (key, params) => !params ? key : Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), key),
  setLocale: async () => undefined,
  formatDate: (input, options) => new Intl.DateTimeFormat("ko-KR", stableDateOptions(options)).format(new Date(input)),
  formatNumber: (input, options) => new Intl.NumberFormat("ko-KR", options).format(input),
};

const I18nContext = createContext<I18nValue>(fallbackI18n);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const store = useLocalCollection<LanguagePreference>("language-preferences", [fallbackLanguagePreference]);
  const stored = store.items[0];
  const locale = stored && isLocale(stored.locale) ? stored.locale : "ko";
  const localeTag = localeTags[locale];
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const t = useCallback((key: string, params?: Params) => {
    const message = translate(locale, key);
    if (!params) return message;
    return Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), message);
  }, [locale]);
  const replaceAsync = store.replaceAsync;
  const value = useMemo<I18nValue>(() => ({
    ready: store.ready,
    locale,
    localeTag,
    t,
    setLocale: async (next) => { await replaceAsync([{ id: "language", locale: next, updatedAt: new Date().toISOString() }]); },
    formatDate: (input, options) => new Intl.DateTimeFormat(localeTag, stableDateOptions(options)).format(new Date(input)),
    formatNumber: (input, options) => new Intl.NumberFormat(localeTag, options).format(input),
  }), [locale, localeTag, replaceAsync, store.ready, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

function stableDateOptions(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions | undefined {
  if (!options || options.hourCycle || !(options.timeStyle || options.hour)) return options;
  return { ...options, hourCycle: "h23" };
}
