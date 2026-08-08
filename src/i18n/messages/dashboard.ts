import type { MessageCatalog, TranslatedLocale } from "../types";

const rows = [
  ["총 손익", "総損益", "Total P&L", "Résultat total", "Profitto/perdita totale", "Ganancia/pérdida total"],
  ["계획 매매", "計画取引", "Planned trades", "Transactions planifiées", "Operazioni pianificate", "Operaciones planificadas"],
  ["전체 매매", "全取引", "All trades", "Toutes les transactions", "Tutte le operazioni", "Todas las operaciones"],
] as const;

function buildCatalog(index: 1 | 2 | 3 | 4 | 5): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row[0], row[index]]));
}

export const dashboardMessages: MessageCatalog = Object.fromEntries(
  (["ja", "en", "fr", "it", "es"] as TranslatedLocale[]).map((locale, index) => [locale, buildCatalog((index + 1) as 1 | 2 | 3 | 4 | 5)]),
) as MessageCatalog;
