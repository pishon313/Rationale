# Design — Rationale

A locked design system for the Rationale app. Every page keeps the same visual
language: calm enough for long-horizon thinking, precise enough for decisions.

## Genre

modern-minimal

## Macrostructure family

- Marketing pages: Marquee Hero with restrained product proof
- App pages: Workbench with a clear decision-first reading order
- Content pages: Long Document with compact, readable measures

## Theme

- `--color-paper`   `oklch(97.5% 0.012 170)`
- `--color-paper-2` `oklch(95% 0.018 170)`
- `--color-ink`     `oklch(19% 0.025 245)`
- `--color-ink-2`   `oklch(34% 0.025 235)`
- `--color-rule`    `oklch(88% 0.018 175)`
- `--color-accent`  `oklch(55% 0.145 168)`
- `--color-focus`   `oklch(62% 0.18 166)`
- Supporting data colour: muted lilac, limited to charts and status marks

Dark mode uses deep blue-green ink surfaces with a brighter mint accent. Hue
does not change between modes.

## Typography

- Display: Geist, weight 700
- Body: Geist, weight 400
- Wordmark: Bricolage Grotesque, weight 700
- Display tracking: `-0.025em`
- Type scale anchor: `--text-display = clamp(2rem, 3vw + 1rem, 3.5rem)`

## Spacing

4-point named scale. Values live in `tokens.css`; components use named tokens
or Tailwind utilities that follow the same rhythm.

## Motion

- State changes only; no page-load reveal
- Hover and press use transform and opacity only
- Reduced-motion fallback is opacity-only and at most 150 ms

## Microinteractions stance

- Silent success; persistence status stays quiet
- Focus is immediate and visible
- Reversible actions should prefer Undo when their flow is revisited
- No celebratory motion and no hover-only controls

## CTA voice

- Primary: dark-ink fill in light mode, mint fill in dark mode; compact radius
- Secondary: surface fill with a visible rule
- Labels use concrete actions such as “관찰 기록” and “계획 추가”

## Per-page allowances

- Marketing pages may use one restrained CSS or SVG enrichment.
- App pages use no decorative enrichment; information is the visual material.
- Content pages are typography-first.

## What pages MUST share

- Rationale wordmark and mint decision mark
- Mint accent placement below 5% of a viewport
- Geist UI typography and Bricolage wordmark
- Button, input, card, table, focus and modal treatment
- Decision-first page hierarchy

## What pages MAY differ on

- Content width appropriate to tables, forms or reading
- Card composition and chart colour assignment
- Local status colours when paired with text or an icon

## Exports

The canonical CSS export is `/tokens.css`. Tailwind consumes the same variables
through `src/app/globals.css`; existing legacy variable names map to the locked
tokens so every current route inherits the system.
