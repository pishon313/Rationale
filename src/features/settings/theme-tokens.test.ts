import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "tokens.css"), "utf8");

function declarations(selector: string) {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  return css.slice(open + 1, close);
}

describe("theme token contracts", () => {
  it("keeps the frozen Mint light and dark anchors unchanged", () => {
    const mintLight = declarations(':root,\n:root[data-theme="mint"]');
    const mintDark = declarations(':root.dark,\n:root.dark[data-theme="mint"]');

    expect(mintLight).toContain("--color-paper: oklch(97.5% 0.012 170)");
    expect(mintLight).toContain("--color-accent: oklch(55% 0.145 168)");
    expect(mintLight).toContain("--color-workbench-background: oklch(16.5% 0.025 180)");
    expect(mintDark).toContain("--color-paper: oklch(14.5% 0.022 230)");
    expect(mintDark).toContain("--color-accent: oklch(76% 0.13 166)");
    expect(mintDark).toContain("--color-focus: oklch(80% 0.15 166)");
  });

  it("defines tuned Rose Purple light, dark, and workbench anchors", () => {
    const roseLight = declarations(':root[data-theme="rose-purple"]');
    const roseDark = declarations(':root.dark[data-theme="rose-purple"]');

    expect(roseLight).toContain("--color-paper: oklch(97.4% 0.009 340)");
    expect(roseLight).toContain("--color-accent: oklch(49% 0.19 356)");
    expect(roseLight).toContain("--color-workbench-background: oklch(14.5% 0.028 305)");
    expect(roseDark).toContain("--color-paper: oklch(13.5% 0.028 305)");
    expect(roseDark).toContain("--color-accent: oklch(73% 0.175 355)");
    expect(roseDark).toContain("--color-focus: oklch(80% 0.11 300)");
  });

  it("defines complete Midnight light, dark, and workbench anchors", () => {
    const light = declarations(':root[data-theme="midnight"]');
    const dark = declarations(':root.dark[data-theme="midnight"]');

    expect(light).toContain("--color-paper: oklch(97.3% 0.01 255)");
    expect(light).toContain("--color-accent: oklch(45% 0.17 268)");
    expect(light).toContain("--color-workbench-background: oklch(13.5% 0.04 255)");
    expect(dark).toContain("--color-paper: oklch(12.8% 0.035 255)");
    expect(dark).toContain("--color-accent: oklch(72% 0.16 270)");
    expect(dark).toContain("--color-focus: oklch(80% 0.14 285)");
    expectCompletePalette(light);
    expectCompletePalette(dark);
  });

  it("defines complete Lemon light, dark, and distinct warning anchors", () => {
    const light = declarations(':root[data-theme="lemon"]');
    const dark = declarations(':root.dark[data-theme="lemon"]');

    expect(light).toContain("--color-paper: oklch(98.2% 0.012 100)");
    expect(light).toContain("--color-accent: oklch(42% 0.13 92)");
    expect(light).toContain("--color-amber: oklch(65% 0.16 65)");
    expect(light).toContain("--color-workbench-background: oklch(15% 0.03 85)");
    expect(dark).toContain("--color-paper: oklch(14% 0.025 85)");
    expect(dark).toContain("--color-accent: oklch(82% 0.15 100)");
    expect(dark).toContain("--color-amber: oklch(79% 0.12 65)");
    expectCompletePalette(light);
    expectCompletePalette(dark);
  });

  it("keeps the secondary accent compatibility alias in every palette", () => {
    for (const selector of [
      ':root,\n:root[data-theme="mint"]',
      ':root.dark,\n:root.dark[data-theme="mint"]',
      ':root[data-theme="rose-purple"]',
      ':root.dark[data-theme="rose-purple"]',
      ':root[data-theme="midnight"]',
      ':root.dark[data-theme="midnight"]',
      ':root[data-theme="lemon"]',
      ':root.dark[data-theme="lemon"]',
    ]) {
      const block = declarations(selector);
      expect(block).toContain("--color-secondary-accent:");
      expect(block).toContain("--color-lilac: var(--color-secondary-accent)");
    }
  });

  it("resolves every required semantic token for all eight palette and appearance combinations", () => {
    const mintLight = declarations(':root,\n:root[data-theme="mint"]');
    const mintDark = declarations(':root.dark,\n:root.dark[data-theme="mint"]');

    for (const theme of ["mint", "rose-purple", "midnight", "lemon"] as const) {
      const paletteLight = theme === "mint" ? "" : declarations(`:root[data-theme="${theme}"]`);
      const paletteDark = theme === "mint" ? "" : declarations(`:root.dark[data-theme="${theme}"]`);
      expectCompletePalette(mintLight + paletteLight);
      expectCompletePalette(mintLight + mintDark + paletteLight + paletteDark);
    }
  });
});

const requiredPaletteTokens = [
  "paper", "paper-2", "paper-3", "surface", "ink", "ink-2", "muted", "rule", "rule-strong",
  "accent", "accent-hover", "accent-soft", "accent-ink", "focus", "secondary-accent", "lilac",
  "amber", "danger", "success", "workbench-border", "workbench-background", "workbench-ink",
  "workbench-brand-rule", "workbench-accent", "workbench-muted", "workbench-field-rule", "workbench-field",
  "workbench-nav", "workbench-nav-ink", "workbench-active-rule", "workbench-active", "workbench-active-ink",
  "workbench-hover", "workbench-active-hover",
];

function expectCompletePalette(block: string) {
  for (const token of requiredPaletteTokens) expect(block).toContain(`--color-${token}:`);
  for (const shadow of ["whisper", "floating", "workbench"]) expect(block).toContain(`--shadow-${shadow}:`);
}
