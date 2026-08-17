import type { MessageCatalog } from "../types";

const entries = [
  ["종목명 또는 티커 검색", "銘柄名またはティッカーを検索", "Search by stock name or ticker", "Rechercher par nom ou symbole", "Cerca per nome o ticker", "Buscar por nombre o ticker"],
  ["등록된 종목에서 찾을 수 없습니다.", "登録済みの銘柄に見つかりません。", "No matching registered stock was found.", "Aucun titre enregistré ne correspond.", "Nessun titolo registrato corrisponde alla ricerca.", "No se encontró ningún valor registrado coincidente."],
  ["종목 메뉴에서 먼저 추가해 주세요.", "先に銘柄メニューで追加してください。", "Add it from the Stocks menu first.", "Ajoutez-le d’abord depuis le menu Titres.", "Aggiungilo prima dal menu Titoli.", "Añádelo primero desde el menú Valores."],
  ["온라인 종목 검색은 다음 단계에서 지원합니다.", "オンライン銘柄検索は次の段階で対応します。", "Online stock search will be supported in the next phase.", "La recherche de titres en ligne sera disponible à la prochaine phase.", "La ricerca online dei titoli sarà disponibile nella prossima fase.", "La búsqueda de valores en línea estará disponible en la siguiente fase."],
  ["종목 목록 열기", "銘柄一覧を開く", "Open stock list", "Ouvrir la liste des titres", "Apri l’elenco dei titoli", "Abrir la lista de valores"],
] as const;

export const registeredStockPickerMessages: MessageCatalog = { ja: {}, en: {}, fr: {}, it: {}, es: {} };
for (const [ko, ja, en, fr, it, es] of entries) {
  registeredStockPickerMessages.ja[ko] = ja;
  registeredStockPickerMessages.en[ko] = en;
  registeredStockPickerMessages.fr[ko] = fr;
  registeredStockPickerMessages.it[ko] = it;
  registeredStockPickerMessages.es[ko] = es;
}
