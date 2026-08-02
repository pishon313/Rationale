export const locales = ["ko", "ja", "en", "fr", "it", "es"] as const;
export type Locale = (typeof locales)[number];
export type TranslatedLocale = Exclude<Locale, "ko">;
export type MessageCatalog = Record<TranslatedLocale, Record<string, string>>;

export const localeTags: Record<Locale, string> = {
  ko: "ko-KR",
  ja: "ja-JP",
  en: "en-US",
  fr: "fr-FR",
  it: "it-IT",
  es: "es-ES",
};

export const languageNames: Record<Locale, string> = {
  ko: "한국어",
  ja: "日本語",
  en: "English",
  fr: "Français",
  it: "Italiano",
  es: "Español",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}
