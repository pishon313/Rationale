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
});
