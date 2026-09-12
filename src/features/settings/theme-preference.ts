export const themeIds = ["mint", "rose-purple"] as const;
export type ThemeId = (typeof themeIds)[number];

export const defaultTheme: ThemeId = "mint";
export const themeStorageKey = "rationale.theme";
const themeChangeEvent = "rationale:theme-change";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (themeIds as readonly string[]).includes(value);
}

export function readStoredTheme(): ThemeId {
  if (typeof window === "undefined") return defaultTheme;
  try {
    const value = window.localStorage.getItem(themeStorageKey);
    return isThemeId(value) ? value : defaultTheme;
  } catch {
    return defaultTheme;
  }
}

export function storeTheme(theme: ThemeId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // A storage failure must not prevent the in-memory theme from changing.
  }
}

export function applyTheme(theme: ThemeId, root?: HTMLElement): void {
  const target = root ?? (typeof document === "undefined" ? null : document.documentElement);
  target?.setAttribute("data-theme", theme);
  if (typeof window !== "undefined" && typeof document !== "undefined" && target === document.documentElement) {
    window.dispatchEvent(new Event(themeChangeEvent));
  }
}

export function readAppliedTheme(): ThemeId {
  if (typeof document === "undefined") return defaultTheme;
  const value = document.documentElement.getAttribute("data-theme");
  return isThemeId(value) ? value : defaultTheme;
}

export function subscribeToTheme(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(themeChangeEvent, listener);
  return () => window.removeEventListener(themeChangeEvent, listener);
}

export const themeBootstrapScript = `(() => {
  const fallback = ${JSON.stringify(defaultTheme)};
  try {
    const stored = localStorage.getItem(${JSON.stringify(themeStorageKey)});
    document.documentElement.setAttribute("data-theme", stored === "rose-purple" ? stored : fallback);
  } catch {
    document.documentElement.setAttribute("data-theme", fallback);
  }
})();`;
