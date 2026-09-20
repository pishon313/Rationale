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

  it("keeps secondary accent text readable on muted badge backgrounds", () => {
    for (const [name, selector] of [
      ["Mint Light", ':root,\n:root[data-theme="mint"]'],
      ["Mint Dark", ':root.dark,\n:root.dark[data-theme="mint"]'],
      ["Rose Purple Light", ':root[data-theme="rose-purple"]'],
      ["Rose Purple Dark", ':root.dark[data-theme="rose-purple"]'],
      ["Midnight Light", ':root[data-theme="midnight"]'],
      ["Midnight Dark", ':root.dark[data-theme="midnight"]'],
      ["Lemon Light", ':root[data-theme="lemon"]'],
      ["Lemon Dark", ':root.dark[data-theme="lemon"]'],
    ] as const) {
      const block = declarations(selector);
      const foreground = colorToken(block, "secondary-accent-text");
      const background = colorToken(block, "paper-2");
      expect(contrastRatio(foreground, background), name).toBeGreaterThanOrEqual(4.5);
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
  "accent", "accent-hover", "accent-soft", "accent-ink", "focus", "secondary-accent", "secondary-accent-text", "lilac",
  "amber", "danger", "success", "workbench-border", "workbench-background", "workbench-ink",
  "workbench-brand-rule", "workbench-accent", "workbench-muted", "workbench-field-rule", "workbench-field",
  "workbench-nav", "workbench-nav-ink", "workbench-active-rule", "workbench-active", "workbench-active-ink",
  "workbench-hover", "workbench-active-hover",
];

function expectCompletePalette(block: string) {
  for (const token of requiredPaletteTokens) expect(block).toContain(`--color-${token}:`);
  for (const shadow of ["whisper", "floating", "workbench"]) expect(block).toContain(`--shadow-${shadow}:`);
}

type Oklch = { lightness: number; chroma: number; hue: number };

function colorToken(block: string, name: string): Oklch {
  const value = block.match(new RegExp(`--color-${name}:\\s*oklch\\(([^)]+)\\)`))?.[1];
  if (!value) throw new Error(`Missing OKLCH token: --color-${name}`);
  const [lightness, chroma, hue] = value.split(/\s+/).map(Number.parseFloat);
  return { lightness: lightness / 100, chroma, hue };
}

function contrastRatio(first: Oklch, second: Oklch) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance({ lightness, chroma, hue }: Oklch) {
  const radians = hue * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}
