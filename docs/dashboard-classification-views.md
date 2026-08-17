# Dashboard classification views

The dashboard presents one unchanged set of Stock market values through two independent allocation groupings.

## My category

My category is the single user-defined representative portfolio group backed by the legacy `Stock.sector` field. Display normalization follows the shared category rules, but the user's canonical label is preserved and never translated. Missing values appear in a localized unspecified group at the end of the allocation.

## Market sector

Market sector is an optional, fixed standard industry classification backed by `Stock.marketSector`. Group identity uses the stable internal sector ID while the visible label is localized. The list is intentionally practical rather than a complete universal taxonomy, so broad or multi-sector funds may remain unspecified.

## Tags

Tags remain overlapping metadata. Because one Stock can have multiple tags, tags are excluded from additive allocation grouping; otherwise a portfolio's grouped percentages could exceed 100%.

## Dashboard behavior

The grouping choice (`My category` or `Market sector`) is persisted separately from the chart choice (`bar` or `donut`). Switching either view does not recalculate Stock values, currency conversion, total market value, or full-portfolio percentages.

Group colors are selected deterministically from stable group IDs. A group's color therefore survives value-based reordering, bar/donut switching, and—in Market-sector mode—locale changes. Tiny positive allocations use a visible minimum bar width and a localized `<0.1%` label rather than appearing as `0.0%`.
