import type { MessageCatalog } from "../types";

const entries = [
  ["개요", "概要", "Overview", "Vue d’ensemble", "Panoramica", "Resumen"],
  ["배분", "配分", "Allocation", "Allocation", "Allocazione", "Asignación"],
  ["보유 자산", "保有資産", "Holdings", "Positions", "Posizioni", "Posiciones"],
  ["활동", "アクティビティ", "Activity", "Activité", "Attività", "Actividad"],
  ["투자 근거", "投資根拠", "Rationale", "Thèse", "Tesi", "Tesis"],
  ["보고서", "レポート", "Reports", "Rapports", "Report", "Informes"],
  ["내 포트폴리오", "マイポートフォリオ", "My Portfolio", "Mon portefeuille", "Il mio portafoglio", "Mi cartera"],
  ["포트폴리오 선택", "ポートフォリオを選択", "Select portfolio", "Sélectionner un portefeuille", "Seleziona portafoglio", "Seleccionar cartera"],
  ["유형", "種類", "Type", "Type", "Tipo", "Tipo"],
  ["개인 포트폴리오", "個人ポートフォリオ", "Personal portfolio", "Portefeuille personnel", "Portafoglio personale", "Cartera personal"],
  ["최근 기록", "最終記録", "Latest record", "Dernière mise à jour", "Ultimo aggiornamento", "Última actualización"],
  ["기록 없음", "記録なし", "No records", "Aucun enregistrement", "Nessun dato", "Sin registros"],
  ["포트폴리오 메뉴", "ポートフォリオメニュー", "Portfolio navigation", "Navigation du portefeuille", "Navigazione portafoglio", "Navegación de cartera"],
  ["포트폴리오 정보를 불러오는 중입니다.", "ポートフォリオ情報を読み込んでいます。", "Loading portfolio information.", "Chargement des informations du portefeuille.", "Caricamento delle informazioni del portafoglio.", "Cargando la información de la cartera."],
  ["선택한 포트폴리오의 공통 정보를 준비하고 있습니다.", "選択したポートフォリオの共通情報を準備しています。", "Preparing shared information for the selected portfolio.", "Préparation des informations communes du portefeuille sélectionné.", "Preparazione delle informazioni condivise del portafoglio selezionato.", "Preparando la información común de la cartera seleccionada."],
  ["포트폴리오 정보를 불러오지 못했습니다.", "ポートフォリオ情報を読み込めませんでした。", "Could not load portfolio information.", "Impossible de charger les informations du portefeuille.", "Impossibile caricare le informazioni del portafoglio.", "No se pudo cargar la información de la cartera."],
  ["저장된 기록을 확인한 뒤 다시 시도해 주세요.", "保存された記録を確認してから、もう一度お試しください。", "Check the saved records and try again.", "Vérifiez les données enregistrées, puis réessayez.", "Controlla i dati salvati e riprova.", "Comprueba los registros guardados e inténtalo de nuevo."],
  ["선택된 포트폴리오가 없습니다.", "ポートフォリオが選択されていません。", "No portfolio is selected.", "Aucun portefeuille n’est sélectionné.", "Nessun portafoglio selezionato.", "No hay ninguna cartera seleccionada."],
  ["포트폴리오를 선택하면 관련 기록을 확인할 수 있습니다.", "ポートフォリオを選択すると、関連する記録を確認できます。", "Select a portfolio to view its records.", "Sélectionnez un portefeuille pour consulter ses données.", "Seleziona un portafoglio per visualizzarne i dati.", "Selecciona una cartera para ver sus registros."],
  ["아직 포트폴리오 기록이 없습니다.", "ポートフォリオの記録はまだありません。", "There are no portfolio records yet.", "Il n’y a pas encore de données de portefeuille.", "Non ci sono ancora dati del portafoglio.", "Todavía no hay registros de cartera."],
  ["종목이나 매매 기록을 추가하면 이 포트폴리오에 반영됩니다.", "銘柄や取引記録を追加すると、このポートフォリオに反映されます。", "Stocks and trades you add will appear in this portfolio.", "Les titres et opérations ajoutés apparaîtront dans ce portefeuille.", "I titoli e le operazioni aggiunti appariranno in questo portafoglio.", "Los valores y operaciones que añadas aparecerán en esta cartera."],
  ["{name} 화면은 다음 단계에서 구현됩니다.", "{name}画面は次の段階で実装されます。", "The {name} screen will be implemented in a later phase.", "L’écran {name} sera réalisé lors d’une prochaine étape.", "La schermata {name} verrà realizzata in una fase successiva.", "La pantalla {name} se implementará en una fase posterior."],
] as const;

export const portfolioShellMessages: MessageCatalog = { ja: {}, en: {}, fr: {}, it: {}, es: {} };
for (const [ko, ja, en, fr, it, es] of entries) {
  Object.assign(portfolioShellMessages, {
    ja: { ...portfolioShellMessages.ja, [ko]: ja },
    en: { ...portfolioShellMessages.en, [ko]: en },
    fr: { ...portfolioShellMessages.fr, [ko]: fr },
    it: { ...portfolioShellMessages.it, [ko]: it },
    es: { ...portfolioShellMessages.es, [ko]: es },
  });
}
