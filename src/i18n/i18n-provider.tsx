"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { translate } from "./messages";
import { isLocale, localeTags, type Locale } from "./types";

export type LanguagePreference = { id: "language"; locale: Locale; updatedAt: string };
export const fallbackLanguagePreference: LanguagePreference = { id: "language", locale: "en", updatedAt: "" };

type Params = Record<string, string | number>;
type I18nValue = {
  ready: boolean;
  locale: Locale;
  localeTag: string;
  t: (key: string, params?: Params) => string;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const fallbackI18n: I18nValue = {
  ready: false,
  locale: "en",
  localeTag: "en-US",
  t: (key, params) => !params ? key : Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), key),
  formatDate: (input, options) => new Intl.DateTimeFormat("en-US", stableDateOptions(options)).format(new Date(input)),
  formatNumber: (input, options) => new Intl.NumberFormat("en-US", options).format(input),
};

const I18nContext = createContext<I18nValue>(fallbackI18n);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ locale: Locale; ready: boolean }>({ locale: "en", ready: false });
  const locale = state.locale;
  const localeTag = localeTags[locale];
  useEffect(() => { const update = () => setState({ locale: resolveSystemLocale(systemLanguages()), ready: true }); update(); window.addEventListener("languagechange", update); return () => window.removeEventListener("languagechange", update); }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const t = useCallback((key: string, params?: Params) => {
    const message = translate(locale, key);
    if (!params) return message;
    return Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), message);
  }, [locale]);
  const value = useMemo<I18nValue>(() => ({
    ready: state.ready,
    locale,
    localeTag,
    t,
    formatDate: (input, options) => new Intl.DateTimeFormat(localeTag, stableDateOptions(options)).format(new Date(input)),
    formatNumber: (input, options) => new Intl.NumberFormat(localeTag, options).format(input),
  }), [locale, localeTag, state.ready, t]);
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
