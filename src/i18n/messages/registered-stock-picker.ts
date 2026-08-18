import type { MessageCatalog } from "../types";

const entries = [
  ["종목명 또는 티커 검색", "銘柄名またはティッカーを検索", "Search by stock name or ticker", "Rechercher par nom ou symbole", "Cerca per nome o ticker", "Buscar por nombre o ticker"],
  ["등록된 종목에서 찾을 수 없습니다.", "登録済みの銘柄に見つかりません。", "No matching registered stock was found.", "Aucun titre enregistré ne correspond.", "Nessun titolo registrato corrisponde alla ricerca.", "No se encontró ningún valor registrado coincidente."],
  ["종목 메뉴에서 먼저 추가해 주세요.", "先に銘柄メニューで追加してください。", "Add it from the Stocks menu first.", "Ajoutez-le d’abord depuis le menu Titres.", "Aggiungilo prima dal menu Titoli.", "Añádelo primero desde el menú Valores."],
  ["온라인 종목 검색은 다음 단계에서 지원합니다.", "オンライン銘柄検索は次の段階で対応します。", "Online stock search will be supported in the next phase.", "La recherche de titres en ligne sera disponible à la prochaine phase.", "La ricerca online dei titoli sarà disponibile nella prossima fase.", "La búsqueda de valores en línea estará disponible en la siguiente fase."],
  ["종목 목록 열기", "銘柄一覧を開く", "Open stock list", "Ouvrir la liste des titres", "Apri l’elenco dei titoli", "Abrir la lista de valores"],
  ["온라인에서 ‘{query}’ 검색", "オンラインで「{query}」を検索", "Search online for “{query}”", "Rechercher « {query} » en ligne", "Cerca “{query}” online", "Buscar «{query}» en línea"],
  ["온라인 검색 중...", "オンライン検索中...", "Searching online...", "Recherche en ligne...", "Ricerca online...", "Buscando en línea..."],
  ["온라인 검색 결과", "オンライン検索結果", "Online search results", "Résultats de recherche en ligne", "Risultati della ricerca online", "Resultados de búsqueda en línea"],
  ["온라인 검색 결과가 없습니다.", "オンライン検索結果がありません。", "No online results were found.", "Aucun résultat en ligne.", "Nessun risultato online.", "No se encontraron resultados en línea."],
  ["온라인 검색에 실패했습니다. 연결 상태와 API 키를 확인해 주세요.", "オンライン検索に失敗しました。接続とAPIキーを確認してください。", "Online search failed. Check your connection and API key.", "La recherche en ligne a échoué. Vérifiez la connexion et la clé API.", "La ricerca online non è riuscita. Controlla la connessione e la chiave API.", "La búsqueda en línea falló. Comprueba la conexión y la clave API."],
  ["온라인 종목 검색은 Mac 앱에서만 사용할 수 있습니다.", "オンライン銘柄検索はMacアプリでのみ利用できます。", "Online stock search is available only in the Mac app.", "La recherche de titres en ligne est disponible uniquement dans l’app Mac.", "La ricerca online dei titoli è disponibile solo nell’app Mac.", "La búsqueda de valores en línea solo está disponible en la app para Mac."],
  ["온라인 검색 결과를 사용할 수 없습니다.", "このオンライン検索結果は使用できません。", "This online result cannot be used.", "Ce résultat en ligne ne peut pas être utilisé.", "Questo risultato online non può essere utilizzato.", "Este resultado en línea no se puede utilizar."],
  ["지원하지 않는 통화입니다.", "サポートされていない通貨です。", "Unsupported currency.", "Devise non prise en charge.", "Valuta non supportata.", "Moneda no compatible."],
  ["이미 등록된 종목을 선택했습니다.", "登録済みの銘柄を選択しました。", "The existing registered stock was selected.", "Le titre déjà enregistré a été sélectionné.", "È stato selezionato il titolo già registrato.", "Se seleccionó el valor ya registrado."],
  ["같은 식별 정보의 종목이 여러 개 있어 자동으로 선택할 수 없습니다.", "同じ識別情報を持つ銘柄が複数あるため、自動選択できません。", "Multiple stocks share this identity, so none was selected automatically.", "Plusieurs titres partagent cette identité ; aucune sélection automatique n’est possible.", "Più titoli condividono questa identità, quindi non è possibile selezionarne uno automaticamente.", "Varios valores comparten esta identidad, por lo que no se seleccionó ninguno automáticamente."],
  ["계획을 저장할 때 이 종목을 관찰 상태로 함께 추가합니다.", "計画の保存時に、この銘柄を観察状態で追加します。", "This stock will be added with Watch status when the plan is saved.", "Ce titre sera ajouté avec le statut Observation lors de l’enregistrement du plan.", "Il titolo verrà aggiunto con stato Osservazione quando salvi il piano.", "Este valor se añadirá con estado Observación al guardar el plan."],
  ["계획을 저장할 때 삭제된 종목을 함께 복원합니다.", "計画の保存時に、削除済みの銘柄を復元します。", "The deleted stock will be restored when the plan is saved.", "Le titre supprimé sera restauré lors de l’enregistrement du plan.", "Il titolo eliminato verrà ripristinato quando salvi il piano.", "El valor eliminado se restaurará al guardar el plan."],
  ["종목 추가 확인", "銘柄追加の確認", "Confirm stock addition", "Confirmer l’ajout du titre", "Conferma aggiunta titolo", "Confirmar adición del valor"],
  ["삭제된 종목 복원", "削除済み銘柄の復元", "Restore deleted stock", "Restaurer le titre supprimé", "Ripristina titolo eliminato", "Restaurar valor eliminado"],
  ["이 종목은 아직 Rationale에 등록되어 있지 않습니다. 계획을 저장할 때 종목 목록에 관찰 상태로 함께 추가합니다.", "この銘柄はまだRationaleに登録されていません。計画の保存時に観察状態で銘柄一覧へ追加します。", "This stock is not registered in Rationale yet. It will be added to Stocks with Watch status when the plan is saved.", "Ce titre n’est pas encore enregistré dans Rationale. Il sera ajouté avec le statut Observation lors de l’enregistrement du plan.", "Questo titolo non è ancora registrato in Rationale. Verrà aggiunto con stato Osservazione quando salvi il piano.", "Este valor aún no está registrado en Rationale. Se añadirá con estado Observación al guardar el plan."],
  ["이 종목은 이전에 삭제된 종목과 일치합니다. 계획을 저장할 때 기존 종목을 복원합니다.", "この銘柄は以前削除した銘柄と一致します。計画の保存時に既存の銘柄を復元します。", "This matches a previously deleted stock. The existing stock will be restored when the plan is saved.", "Ce résultat correspond à un titre précédemment supprimé. Le titre existant sera restauré lors de l’enregistrement du plan.", "Corrisponde a un titolo eliminato in precedenza. Il titolo esistente verrà ripristinato quando salvi il piano.", "Coincide con un valor eliminado anteriormente. El valor existente se restaurará al guardar el plan."],
  ["추가하고 계획 만들기", "追加して計画を作成", "Add and create plan", "Ajouter et créer le plan", "Aggiungi e crea piano", "Añadir y crear plan"],
  ["종목 복원 후 계획 만들기", "銘柄を復元して計画を作成", "Restore stock and create plan", "Restaurer le titre et créer le plan", "Ripristina titolo e crea piano", "Restaurar valor y crear plan"],
  ["종목과 매수 계획을 저장하지 못했습니다. 다시 시도해 주세요.", "銘柄と買付計画を保存できませんでした。もう一度お試しください。", "The stock and buy plan could not be saved. Try again.", "Le titre et le plan d’achat n’ont pas pu être enregistrés. Réessayez.", "Impossibile salvare il titolo e il piano di acquisto. Riprova.", "No se pudieron guardar el valor y el plan de compra. Inténtalo de nuevo."],
] as const;

export const registeredStockPickerMessages: MessageCatalog = { ja: {}, en: {}, fr: {}, it: {}, es: {} };
for (const [ko, ja, en, fr, it, es] of entries) {
  registeredStockPickerMessages.ja[ko] = ja;
  registeredStockPickerMessages.en[ko] = en;
  registeredStockPickerMessages.fr[ko] = fr;
  registeredStockPickerMessages.it[ko] = it;
  registeredStockPickerMessages.es[ko] = es;
}
