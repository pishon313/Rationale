# Portfolio Shell V1

> Historical six-route shell contract. The accepted replacement and phased reduction plan is [Portfolio Two-Screen V1 Contract](./portfolio-two-screen-v1.md).

## Scope

Portfolio Shell V1 provides the shared identity, navigation, state, formatting, and responsive layout contract for all portfolio routes. The existing Allocation worksheet remains at `/portfolio` and is rendered unchanged inside the shell.

The shell defines these stable routes:

| Destination | Route | V1 content |
| --- | --- | --- |
| Overview | `/portfolio/overview` | Placeholder |
| Allocation | `/portfolio` | Existing Portfolio Plan V1 worksheet |
| Holdings | `/portfolio/holdings` | Placeholder |
| Activity | `/portfolio/activity` | Placeholder |
| Rationale | `/portfolio/rationale` | Placeholder |
| Reports | `/portfolio/reports` | Placeholder |

Overview intentionally remains a placeholder so it can be implemented after the other portfolio views establish their data contracts.

## Shared contract

`PortfolioShell` owns a single shared session across child-route navigation. `usePortfolioShell()` exposes:

- a discriminated snapshot for `loading`, `error`, `noSelection`, and `ready` states;
- portfolio identity (`id`, localized `name`, `kind`, and `baseCurrency`);
- the latest valid `updatedAt` value across accounts, stocks, and trades as `asOf`;
- an empty-state flag based on active accounts, stocks, and trades;
- locale-aware money, ratio-percentage, and as-of date formatters.

The route metadata in `routes.ts` is the single source for route IDs, URLs, labels, icons, and implementation status. Exact `/portfolio` matching is reserved for Allocation; descendant paths use the corresponding child-route metadata.

## Data assumptions

- The current product has one implicit personal portfolio, identified as `default` and localized as “My Portfolio.” The switcher is present now so a future multi-portfolio source can replace this identity without changing child screens.
- Until a dedicated portfolio preference exists, the existing display-currency preference is also the portfolio base currency. Missing preferences fall back to KRW.
- Retrying a load error remounts only the portfolio shell data session and does not reload the page.
- A no-record notice is additive: it does not hide the Allocation worksheet or any child route.

## Non-goals

This phase does not implement Overview, Holdings, Activity, Rationale, or Reports content. It does not move or recreate Allocation, add investment recommendations, change persistence formats, or introduce a second portfolio entity.
