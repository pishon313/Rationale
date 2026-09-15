# Theme Palettes V2

Theme Palettes V2 extends the existing palette and appearance system without changing its storage model or appearance behavior.

## Canonical palettes

- `mint` — existing default, unchanged
- `rose-purple` — existing alternative, unchanged
- `midnight` — cool navy and indigo with a violet secondary accent
- `lemon` — warm ivory, charcoal, golden olive, lemon, and sage

The selected palette is stored locally on the device under `rationale.theme`; it is not synced. Missing, invalid, or unreadable values fall back to `mint`. The early document bootstrap validates the stored value against the canonical palette list so all four palettes are applied before hydration.

## Palette and appearance

Palette and appearance remain independent dimensions. Each palette supports both Light and Dark appearances, and changing a palette does not add or remove the root `dark` class.

## Midnight

Midnight Light uses frosted blue-gray page layers, near-white surfaces, deep navy text, a controlled indigo action color, and a cool violet secondary accent. Midnight Dark moves those roles onto navy-charcoal and blue-black surfaces while keeping text warm-neutral and indigo actions clear rather than neon. Its workbench uses the same navy/indigo identity with restrained violet detail, avoiding gaming or cyberpunk styling.

## Lemon

Lemon Light uses warm ivory page layers, cream-white surfaces, charcoal text, a deep golden-olive action color, soft lemon highlights, and a sage secondary accent. Bright lemon is reserved for previews and highlights because it is not suitable for ordinary text on light surfaces. Lemon Dark uses olive-charcoal and graphite-olive surfaces, where a brighter lemon action color has sufficient contrast. Its workbench carries the same olive/lemon/sage identity on a dark, focused surface.

## Semantic color rules

Palette action colors never replace financial or warning semantics:

- loss and destructive actions remain red through `--color-danger`;
- profit and healthy states remain green through `--color-success`;
- warnings remain amber through `--color-amber`;
- Lemon action colors remain visually distinct from warning amber;
- bright lemon is used as an action color only on dark surfaces, not as ordinary text on ivory or white.

`--color-secondary-accent` is the semantic secondary accent token. `--color-lilac` remains as a compatibility alias.

The palettes are original to Rationale and do not copy a third-party product palette.

## Settings

Settings presents the four palettes as accessible radio cards with localized names and descriptions. The layout remains two columns at suitable widths and never expands to four columns.

Phase 1 establishes the initial palettes and contracts. Any further Midnight or Lemon color tuning is deferred to Phase 2 after user visual review.
