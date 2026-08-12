import type { MessageCatalog } from "../types";

const entries = [
  ["관찰 대상", "観察対象", "Observation target", "Cible de l’observation", "Oggetto dell’osservazione", "Objetivo de la observación"],
  ["관찰 대상 필터", "観察対象フィルター", "Observation target filter", "Filtre de cible", "Filtro oggetto", "Filtro de objetivo"],
  ["시장 대상 필터", "市場対象フィルター", "Market target filter", "Filtre de marché", "Filtro mercato", "Filtro de mercado"],
  ["시장", "市場", "Market", "Marché", "Mercato", "Mercado"],
  ["시장 관찰", "市場観察", "Market observation", "Observation du marché", "Osservazione del mercato", "Observación del mercado"],
  ["시장 / 지수", "市場／指数", "Market / index", "Marché / indice", "Mercato / indice", "Mercado / índice"],
  ["시장 판단", "市場判断", "Market view", "Opinion sur le marché", "Valutazione del mercato", "Visión del mercado"],
  ["글로벌", "グローバル", "Global", "Monde", "Globale", "Global"],
  ["한국", "韓国", "Korea", "Corée", "Corea", "Corea"],
  ["미국", "米国", "United States", "États-Unis", "Stati Uniti", "Estados Unidos"],
  ["일본", "日本", "Japan", "Japon", "Giappone", "Japón"],
  ["유럽", "欧州", "Europe", "Europe", "Europa", "Europa"],
  ["매크로 / 기타", "マクロ／その他", "Macro / other", "Macro / autre", "Macro / altro", "Macro / otros"],
  ["전체 종목", "すべての銘柄", "All stocks", "Toutes les valeurs", "Tutti i titoli", "Todos los valores"],
  ["전체 시장 대상", "すべての市場対象", "All market targets", "Toutes les cibles de marché", "Tutti i mercati", "Todos los mercados"],
  ["전체 시장", "市場全体", "Global market", "Marché mondial", "Mercato globale", "Mercado global"],
  ["환율", "為替", "FX", "Devises", "Valute", "Divisas"],
  ["금리", "金利", "Rates", "Taux", "Tassi", "Tipos"],
  ["원자재", "コモディティ", "Commodities", "Matières premières", "Materie prime", "Materias primas"],
  ["가상자산", "暗号資産", "Crypto", "Cryptoactifs", "Criptoattività", "Criptoactivos"],
  ["기타", "その他", "Other", "Autre", "Altro", "Otros"],
  ["시장 또는 지수를 하나 이상 선택해 주세요.", "市場または指数を1つ以上選択してください。", "Select at least one market or index.", "Sélectionnez au moins un marché ou indice.", "Seleziona almeno un mercato o indice.", "Selecciona al menos un mercado o índice."],
  ["아직 시장 관찰 기록이 없습니다.", "市場観察はまだありません。", "No market observations yet.", "Aucune observation de marché.", "Nessuna osservazione di mercato.", "Aún no hay observaciones del mercado."],
  ["아직 종목 관찰 기록이 없습니다.", "銘柄観察はまだありません。", "No stock observations yet.", "Aucune observation de valeur.", "Nessuna osservazione di titoli.", "Aún no hay observaciones de valores."],
  ["조건에 맞는 관찰 기록이 없습니다.", "条件に一致する観察はありません。", "No observations match these filters.", "Aucune observation ne correspond aux filtres.", "Nessuna osservazione corrisponde ai filtri.", "Ninguna observación coincide con los filtros."],
] as const;

export const marketObservationMessages: MessageCatalog = { ja: {}, en: {}, fr: {}, it: {}, es: {} };
for (const [ko, ja, en, fr, it, es] of entries) { marketObservationMessages.ja[ko] = ja; marketObservationMessages.en[ko] = en; marketObservationMessages.fr[ko] = fr; marketObservationMessages.it[ko] = it; marketObservationMessages.es[ko] = es; }
