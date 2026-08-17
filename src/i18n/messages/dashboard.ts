import type { MessageCatalog, TranslatedLocale } from "../types";

const rows = [
  ["총 손익", "総損益", "Total P&L", "Résultat total", "Profitto/perdita totale", "Ganancia/pérdida total"],
  ["계획 매매", "計画取引", "Planned trades", "Transactions planifiées", "Operazioni pianificate", "Operaciones planificadas"],
  ["전체 매매", "全取引", "All trades", "Toutes les transactions", "Tutte le operazioni", "Todas las operaciones"],
  ["자산 그룹 기준", "資産のグループ基準", "Asset grouping", "Regroupement des actifs", "Raggruppamento degli asset", "Agrupación de activos"],
  ["차트", "チャート", "Chart", "Graphique", "Grafico", "Gráfico"],
  ["내가 정한 대표 포트폴리오 그룹", "自分で設定した代表ポートフォリオグループ", "Your primary portfolio groups", "Vos principaux groupes de portefeuille", "I tuoi gruppi principali di portafoglio", "Tus grupos principales de cartera"],
  ["표준 산업 분류", "標準業種分類", "Standard industry classification", "Classification sectorielle standard", "Classificazione industriale standard", "Clasificación industrial estándar"],
  ["시장 섹터 미지정", "市場セクター未指定", "Market sector unset", "Secteur de marché non défini", "Settore di mercato non specificato", "Sector de mercado sin especificar"],
  ["종목에서 내 분류 설정", "銘柄でマイカテゴリーを設定", "Set My category in Stocks", "Définir Ma catégorie dans Titres", "Imposta La mia categoria in Titoli", "Configurar Mi categoría en Valores"],
  ["종목에서 시장 섹터 설정", "銘柄で市場セクターを設定", "Set Market sector in Stocks", "Définir le secteur de marché dans Titres", "Imposta il settore di mercato in Titoli", "Configurar el sector de mercado en Valores"],
  ["자산 배분 도넛 차트: {count}개 그룹", "資産配分ドーナツチャート：{count}グループ", "Asset-allocation donut chart: {count} groups", "Graphique en anneau de l’allocation d’actifs : {count} groupes", "Grafico ad anello dell’allocazione degli asset: {count} gruppi", "Gráfico de anillo de asignación de activos: {count} grupos"],
] as const;

function buildCatalog(index: 1 | 2 | 3 | 4 | 5): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row[0], row[index]]));
}

export const dashboardMessages: MessageCatalog = Object.fromEntries(
  (["ja", "en", "fr", "it", "es"] as TranslatedLocale[]).map((locale, index) => [locale, buildCatalog((index + 1) as 1 | 2 | 3 | 4 | 5)]),
) as MessageCatalog;
