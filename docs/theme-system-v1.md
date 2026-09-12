# Theme System V1

Rationale Theme System V1 keeps color palette separate from light/dark appearance.

## Contract

- Palette IDs: `mint`, `rose-purple`
- Default palette: `mint`
- Appearance remains managed independently as `light`, `dark`, or `system`
- Root DOM: `<html data-theme="mint">` or `<html data-theme="rose-purple">`
- Dark appearance remains the existing `.dark` class and can coexist with either palette

## Persistence

The selected palette is stored in browser/device `localStorage` under `rationale.theme`. Missing, unknown, corrupted, or inaccessible storage falls back to Mint without blocking startup. The preference is presentation-only and is not written to SQLite collections, Backup, Sync, financial models, or migrations.

An inline bootstrap in the root layout applies the stored palette before the application body renders where practical. The server-rendered default is Mint, and hydration warnings on the root are suppressed because the bootstrap may update only `data-theme` before hydration.

## Tokens

Shared typography, spacing, motion, and shape tokens remain global. Light and dark color tokens are defined independently for Mint and Rose Purple. Mint values remain the existing visual baseline. The Rose Purple light accent is darker than the initial design starting point so normal-size accent text clears contrast checks. Semantic danger, success, and warning tokens retain their financial/status meanings and do not follow the palette accent.

Palette preview swatches use preview-specific variables and never mutate the document theme.

## Phase 2 visual tuning

Rose Purple now uses a warm-neutral, faintly rose page with near-white reading surfaces in light mode. Its deeper raspberry primary accent remains readable for normal-size text, while lilac is reserved for secondary brand moments and focus support. Muted surfaces and borders use restrained rose-gray and mauve-gray rather than turning every card pink.

Dark mode is the stronger expression: a deep charcoal-plum page, progressively lifted plum surfaces and fields, warm off-white text, bright rose actions, and a restrained lilac secondary accent. The Portfolio workbench uses the same deep foundation with distinct navigation, field, hover, and active layers.

Danger/loss remains red, success/profit remains green, and warning remains amber in both appearances. The palette does not replace those meanings. No exact third-party palette or brand asset was copied, and gradients were intentionally omitted so dense financial screens stay calm and scan-friendly.

Phase 2 introduced no new semantic tokens. The existing palette, appearance, persistence, Backup/Sync, and financial-domain contracts remain unchanged. Further work is optional visual refinement based on user review.
