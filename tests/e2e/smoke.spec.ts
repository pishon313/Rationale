import { expect, test } from "@playwright/test";
import * as XLSX from "@e965/xlsx";

const e2eAccount = (id: string, name: string, isDefault = true) => ({ id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault, archivedAt: null, memo: "", createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z" });

test("대시보드 앱 셸을 표시한다", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByLabel("대시보드 표시 통화")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();
});

test("Mac 설정 언어를 따르다가 선택한 언어를 저장한다", async ({ page }) => {
  await page.goto("/settings");
  const language = page.getByLabel("표시 언어");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByRole("heading", { name: "설정", exact: true })).toBeVisible();
  await expect(language).toHaveValue("system");

  await language.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Display language")).toHaveValue("en");

  await page.getByLabel("Display language").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

test("지원하지 않는 Mac 언어는 English로 표시한다", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN"] });
    Object.defineProperty(navigator, "language", { get: () => "zh-CN" });
  });
  await page.goto("/settings");

  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
});

test("시장 관찰을 작성하고 종목 관찰과 같은 타임라인에서 필터링한다", async ({ page }) => {
  await page.goto("/observations");
  await page.getByRole("button", { name: "새 기록" }).click();
  const form = page.locator("form");
  await expect(form.getByRole("button", { name: "종목", exact: true })).toHaveAttribute("aria-pressed", "true");
  await form.getByRole("button", { name: "시장", exact: true }).click();
  await expect(page.locator('select option[value=""]')).toHaveCount(0);
  await form.getByRole("button", { name: "NASDAQ", exact: true }).click();
  await form.getByRole("button", { name: "KOSPI", exact: true }).click();
  await form.getByRole("button", { name: "종목", exact: true }).click();
  await expect(form.getByRole("combobox", { name: "종목" })).toBeVisible();
  await form.getByRole("button", { name: "시장", exact: true }).click();
  await expect(form.getByRole("button", { name: "NASDAQ", exact: true })).toHaveAttribute("aria-pressed", "false");
  await form.getByRole("button", { name: "NASDAQ", exact: true }).click();
  await form.getByRole("button", { name: "KOSPI", exact: true }).click();
  await page.getByLabel("제목").fill("지정학적 위험으로 시장 급락");
  await page.getByLabel("내용").fill("시장 전체의 위험 회피 흐름을 기록한다.");
  await page.getByLabel("시장 상황").fill("변동성 확대");
  await page.getByLabel("시장 판단").selectOption("약세");
  await page.getByRole("button", { name: "저장", exact: true }).click();

  await expect(page.getByText("시장 관찰")).toBeVisible();
  await expect(page.getByText("NASDAQ · KOSPI")).toBeVisible();
  await page.getByLabel("지정학적 위험으로 시장 급락 수정").click();
  await expect(page.getByRole("heading", { name: "관찰 기록 수정" })).toBeVisible();
  await expect(page.getByRole("button", { name: "NASDAQ", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("button", { name: "시장", exact: true }).click();
  await page.getByLabel("시장 대상 필터").selectOption("nasdaq");
  await expect(page.getByRole("heading", { name: "지정학적 위험으로 시장 급락" })).toBeVisible();
  await page.getByLabel("시장 대상 필터").selectOption("dow");
  await expect(page.getByText("조건에 맞는 관찰 기록이 없습니다.")).toBeVisible();
});

test("일본과 유럽 시장 관찰을 지역별 선택하고 필터링한다", async ({ page }) => {
  await page.goto("/observations");
  await page.getByRole("button", { name: "새 기록" }).click();
  let form = page.locator("form");
  await form.getByRole("button", { name: "시장", exact: true }).click();
  for (const heading of ["글로벌", "미국", "유럽", "일본", "한국", "매크로 / 기타"]) await expect(form.getByText(heading, { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "TOPIX", exact: true }).click();
  await form.getByRole("button", { name: "Nikkei 225", exact: true }).click();
  await page.getByLabel("제목").fill("일본은행 정책 변화");
  await page.getByLabel("내용").fill("일본 주요 지수의 동반 약세를 기록한다.");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("Nikkei 225 · TOPIX")).toBeVisible();

  await page.getByRole("button", { name: "새 기록" }).click();
  form = page.locator("form");
  await form.getByRole("button", { name: "시장", exact: true }).click();
  for (const target of ["DAX", "CAC 40", "STOXX Europe 600"]) await form.getByRole("button", { name: target, exact: true }).click();
  await page.getByLabel("제목").fill("유럽 경기 우려 확대");
  await page.getByLabel("내용").fill("유럽 대표 지수의 하락을 기록한다.");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("STOXX Europe 600 · DAX · CAC 40")).toBeVisible();

  await page.getByRole("button", { name: "시장", exact: true }).click();
  const filter = page.getByLabel("시장 대상 필터");
  await expect(filter.locator('optgroup[label="일본"]')).toHaveCount(1);
  await expect(filter.locator('optgroup[label="유럽"]')).toHaveCount(1);
  await filter.selectOption("nikkei225");
  await expect(page.getByRole("heading", { name: "일본은행 정책 변화" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "유럽 경기 우려 확대" })).toHaveCount(0);
  await filter.selectOption("dax");
  await expect(page.getByRole("heading", { name: "유럽 경기 우려 확대" })).toBeVisible();
});

test("빈 종목 목록에서 새 종목을 등록하고 상세로 이동한다", async ({ page }) => {
  await page.goto("/stocks");
  await expect(page.getByRole("heading", { name: "종목", exact: true })).toBeVisible();
  await expect(page.getByText("조건에 맞는 종목이 없습니다")).toBeVisible();
  await page.getByRole("button", { name: "종목 추가" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "직접 입력" }).click();
  await dialog.getByLabel("티커").fill("TEST");
  await dialog.getByLabel("종목명").fill("테스트 종목");
  await dialog.getByRole("button", { name: "종목 추가" }).click();
  await page.getByRole("link", { name: /테스트 종목/ }).first().click();
  await expect(page.getByRole("heading", { name: "테스트 종목", exact: true })).toBeVisible();
});

test("매수 계획의 테이블과 칸반 보기를 전환한다", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([{
    id: "e2e-stock", ticker: "E2E", name: "E2E 종목", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트",
    status: "관찰", investmentType: "관찰 전용", currentPrice: 0, targetPrice: null, averagePrice: 0, quantity: 0,
    thesisSummary: "", currentView: "판단 보류", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null,
    ledgerInitializedAt: "2026-08-03T00:00:00.000Z", tags: [], createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z", deletedAt: null,
  }])));
  await page.goto("/plans");
  await expect(page.getByRole("heading", { name: "매수 계획" })).toBeVisible();
  await page.getByRole("button", { name: "칸반 보기" }).click();
  await expect(page.getByRole("heading", { name: "아이디어" })).toBeVisible();
});

test("백업 복원 전에 기록 수와 덮어쓰기 안내를 보여준다", async ({ page }) => {
  await page.goto("/settings");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "백업 복원" }).click();
  await (await chooser).setFiles({
    name: "safe-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({
      version: 4,
      exportedAt: "2026-08-03T00:00:00.000Z",
      stocks: [], plans: [], trades: [], observations: [], reviews: [], rules: [], notes: [],
      language: "ko", dashboardNotes: [], earningsEvents: [], displayCurrency: "KRW",
    })),
  });
  await expect(page.getByRole("heading", { name: "복원할 백업 확인" })).toBeVisible();
  await expect(page.getByText("기존 기록은 안전 사본으로 보관한 뒤 이 백업으로 교체됩니다.")).toBeVisible();
  await page.getByRole("button", { name: "취소" }).click();
});

test("매매 원장에서 현금 입금 기록 화면을 연다", async ({ page }) => {
  await page.goto("/trades");
  await expect(page.getByRole("heading", { name: "매매 원장" })).toBeVisible();
  await page.getByRole("button", { name: "원장 기록" }).click();
  await page.getByRole("button", { name: "입금", exact: true }).click();
  await expect(page.getByLabel("입금 금액")).toBeVisible();
  await expect(page.getByLabel("계좌")).toBeVisible();
});

test("거래 파일 후보를 검토하고 원자적으로 가져온 뒤 재가져오기 중복을 차단한다", async ({ page }) => {
  const account = e2eAccount("import-account", "가져오기 계좌");
  const stock = {
    id: "import-stock", ticker: "IMPT", name: "가져오기 종목", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트",
    status: "보유", investmentType: "장기 코어", currentPrice: 1000, targetPrice: null, averagePrice: 0, quantity: 0,
    thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null,
    ledgerInitializedAt: "2026-08-01T00:00:00.000Z", tags: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null,
  };
  const manual = {
    id: "manual-import-match", stockId: stock.id, stockName: stock.name, planId: null, tradeType: "매수", tradedAt: "2026-08-12T10:00:01",
    quantity: 1, price: 1000, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountId: account.id, accountName: account.name,
    memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, ruleViolations: [], journalStatus: "recorded", origin: { kind: "manual" },
    createdAt: "2026-08-12T10:00:01", updatedAt: "2026-08-12T10:00:01", deletedAt: null,
  };
  await page.addInitScript(({ account, stock, manual }) => {
    if (localStorage.getItem("tradejournal.accounts.v1") === null) {
      localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account]));
    }
    if (localStorage.getItem("tradejournal.stocks.v1") === null) {
      localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock]));
    }
    if (localStorage.getItem("tradejournal.trades.v1") === null) {
      localStorage.setItem("tradejournal.trades.v1", JSON.stringify([manual]));
    }
  }, { account, stock, manual });

  await page.goto("/trades");
  await page.getByRole("button", { name: "파일 가져오기" }).click();
  let dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "synthetic-broker.csv", mimeType: "text/csv",
    buffer: Buffer.from("거래일시,종목코드,구분,수량,가격,수수료,세금\n2026-08-12T10:00:01,IMPT,매수,1,1000,0,0\n2026-08-12T10:00:02,IMPT,매수,1,1000,0,0"),
  });
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await expect(dialog.getByText("중복 가능성 1")).toBeVisible();
  await expect(dialog.getByText("추가 가능 1")).toBeVisible();
  const possible = dialog.getByLabel("행 2 선택");
  await expect(possible).not.toBeChecked();
  await possible.check();
  await expect(dialog.getByRole("button", { name: "2건 추가 · 0건 복원" })).toBeEnabled();
  await possible.uncheck();
  await dialog.getByRole("button", { name: "1건 추가 · 0건 복원" }).click();
  await expect(page.getByText("1건의 거래 내역을 추가하고 0건을 복원했습니다.")).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]").length)).toBe(2);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]"))).toHaveLength(2);

  await page.getByRole("button", { name: "파일 가져오기" }).click();
  dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "synthetic-broker-reimport.csv", mimeType: "text/csv",
    buffer: Buffer.from("거래일시,종목코드,구분,수량,가격,수수료,세금\n2026-08-12T10:00:02,IMPT,매수,1,1000,0,0"),
  });
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await expect(dialog.getByText("정확한 중복 1")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "0건 추가 · 0건 복원" })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]"))).toHaveLength(2);
});

test("Excel의 typed date serial을 표시 문자열과 무관하게 거래일로 검토한다", async ({ page }) => {
  const account = e2eAccount("typed-date-account", "Typed Date 계좌");
  const stock = { id: "typed-date-stock", ticker: "XDAT", name: "Typed Date 종목", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트", status: "보유", investmentType: "장기 코어", currentPrice: 1000, targetPrice: null, averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null, ledgerInitializedAt: "2026-07-01T00:00:00.000Z", tags: [], createdAt: "2026-07-01T00:00:00.000Z", updatedAt: "2026-07-01T00:00:00.000Z", deletedAt: null };
  await page.addInitScript(({ account, stock }) => { localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock])); localStorage.setItem("tradejournal.trades.v1", "[]"); }, { account, stock });
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["거래일자", "종목코드", "매매구분", "체결수량", "체결가"], [null, "XDAT", "매수", 1, 1000]]);
  sheet.A2 = { t: "n", v: 46232, z: "mm-dd-yy" };
  XLSX.utils.book_append_sheet(workbook, sheet, "거래내역");
  const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));

  await page.goto("/trades");
  await page.getByRole("button", { name: "파일 가져오기" }).click();
  const dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "typed-date.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();

  await expect(dialog.getByText("추가 가능 1")).toBeVisible();
  await expect(dialog.getByText("2026-07-29T09:00:00")).toBeVisible();
  await expect(dialog.getByText("거래일 형식을 확인해 주세요.")).toHaveCount(0);
});

test("원본 열 중심으로 수동 연결하고 예시 값을 유지해 가져온다", async ({ page }) => {
  const account = e2eAccount("source-first-account", "원본 열 계좌");
  const stock = { id: "source-first-stock", ticker: "005930", name: "삼성전자", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트", status: "보유", investmentType: "장기 코어", currentPrice: 70000, targetPrice: null, averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null, ledgerInitializedAt: "2026-08-01T00:00:00.000Z", tags: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null };
  await page.addInitScript(({ account, stock }) => { localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock])); localStorage.setItem("tradejournal.trades.v1", "[]"); }, { account, stock });
  await page.goto("/trades");
  await page.getByRole("button", { name: "파일 가져오기" }).click();
  const dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  const headers = ["ord_dt", "ord_tmd", "pdno", "prdt_name", "sll_buy_dvsn_cd_name", "tot_ccld_qty", "avg_prvs", "fee_raw", "tax_raw", "crcy_cd", "acct_raw", "exec_id", "odno", "ord_channel"];
  const values = ["2026-08-12", "10:00:01", "005930", "삼성전자", "매수", "1", "70000", "10", "2", "KRW", "원본 열 계좌", "exec-source-first", "order-1", "MOBILE"];
  await dialog.locator('input[type="file"]').setInputFiles({ name: "raw-headers.csv", mimeType: "text/csv", buffer: Buffer.from(`${headers.join(",")}\n${values.join(",")}`) });
  for (const header of headers) await expect(dialog.getByLabel(`${header} 열 매핑`)).toBeVisible();
  await expect(dialog.getByText("005930", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("ord_channel 열 매핑")).toHaveValue("ignore");
  await expect(dialog.getByText("필수 0/5")).toBeVisible();
  await expect(dialog.getByText("수수료 열이 없으면 수수료를 0으로 계산합니다.")).toBeVisible();
  await expect(dialog.getByText("계좌 열이 없으면 모든 행을 선택한 대상 계좌로 가져옵니다.")).toBeVisible();
  const targets: Record<string, string> = { ord_dt: "tradedAt", ord_tmd: "time", pdno: "ticker", prdt_name: "stockName", sll_buy_dvsn_cd_name: "tradeType", tot_ccld_qty: "quantity", avg_prvs: "price", fee_raw: "fee", tax_raw: "tax", crcy_cd: "currency", acct_raw: "accountName", exec_id: "externalExecutionId", odno: "orderId" };
  for (const [header, target] of Object.entries(targets)) await dialog.getByLabel(`${header} 열 매핑`).selectOption(target);
  await expect(dialog.getByText("필수 5/5")).toBeVisible();
  await expect(dialog.getByText("수수료 열이 없으면 수수료를 0으로 계산합니다.")).toHaveCount(0);
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await expect(dialog.getByText("추가 가능 1")).toBeVisible();
  await dialog.getByRole("button", { name: "열 연결로 돌아가기" }).click();
  await expect(dialog.getByLabel("pdno 열 매핑")).toHaveValue("ticker");
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await dialog.getByRole("button", { name: "1건 추가 · 0건 복원" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]").length)).toBe(1);
});

test("원본 열 매핑에서 같은 대상 필드의 중복 소유를 막는다", async ({ page }) => {
  const account = e2eAccount("mapping-collision-account", "매핑 충돌 계좌");
  await page.addInitScript((account) => { localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.stocks.v1", "[]"); localStorage.setItem("tradejournal.trades.v1", "[]"); }, account);
  await page.goto("/trades");
  await page.getByRole("button", { name: "파일 가져오기" }).click();
  const dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "collision.csv", mimeType: "text/csv", buffer: Buffer.from("qty_a,qty_b\n1,2") });
  const first = dialog.getByLabel("qty_a 열 매핑"); const second = dialog.getByLabel("qty_b 열 매핑");
  await first.selectOption("quantity");
  await expect(second.locator('option[value="quantity"]')).toBeDisabled();
  await first.selectOption("ignore");
  await expect(second.locator('option[value="quantity"]')).toBeEnabled();
  await second.selectOption("quantity");
  await expect(second).toHaveValue("quantity");
});

test("중복 헤더를 occurrence별로 표시하고 하나만 체결가로 연결한다", async ({ page }) => {
  const account = e2eAccount("duplicate-header-account", "중복 헤더 계좌");
  await page.addInitScript((account) => { localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.stocks.v1", "[]"); localStorage.setItem("tradejournal.trades.v1", "[]"); }, account);
  await page.goto("/trades");
  await page.getByRole("button", { name: "파일 가져오기" }).click();
  const dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "duplicate-price.csv", mimeType: "text/csv", buffer: Buffer.from("거래일,종목코드,구분,수량,가격,가격\n2026-08-12,005930,매수,1,70000,71000") });
  const first = dialog.getByLabel("가격 (1) 열 매핑"); const second = dialog.getByLabel("가격 (2) 열 매핑");
  await expect(first).toHaveValue("ignore"); await expect(second).toHaveValue("ignore");
  await expect(dialog.getByText("확인 필요", { exact: true })).toHaveCount(2);
  await first.selectOption("price");
  await expect(first).toHaveValue("price"); await expect(second).toHaveValue("ignore");
  await expect(second.locator('option[value="price"]')).toBeDisabled();
});

test("source-first 프로필을 재정렬 파일에 적용하고 dirty 상태를 유지한다", async ({ page }) => {
  const account = e2eAccount("profile-source-account", "프로필 계좌");
  await page.addInitScript((account) => { localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.stocks.v1", "[]"); localStorage.setItem("tradejournal.trades.v1", "[]"); localStorage.setItem("tradejournal.import-mapping-profiles.v1", "[]"); }, account);
  await page.goto("/trades"); await page.getByRole("button", { name: "파일 가져오기" }).click();
  const dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  const first = "raw_date,raw_side,raw_qty,raw_price,raw_ticker,extra\n2026-08-12,매수,1,100,005930,x";
  await dialog.locator('input[type="file"]').setInputFiles({ name: "profile-first.csv", mimeType: "text/csv", buffer: Buffer.from(first) });
  const targets: Record<string, string> = { raw_date: "tradedAt", raw_side: "tradeType", raw_qty: "quantity", raw_price: "price", raw_ticker: "ticker" };
  for (const [header, target] of Object.entries(targets)) await dialog.getByLabel(`${header} 열 매핑`).selectOption(target);
  await dialog.getByLabel("프로필 이름").fill("Raw Broker");
  await dialog.getByRole("button", { name: "새 프로필로 저장" }).click();
  await expect(dialog.getByText("프로필", { exact: true })).toHaveCount(5);
  const reordered = "extra,raw_ticker,raw_price,raw_qty,raw_side,raw_date\nx,005930,100,1,매수,2026-08-12";
  await dialog.locator('input[type="file"]').setInputFiles({ name: "profile-reordered.csv", mimeType: "text/csv", buffer: Buffer.from(reordered) });
  await expect(dialog.getByLabel("raw_ticker 열 매핑")).toHaveValue("ticker");
  await expect(dialog.getByLabel("raw_date 열 매핑")).toHaveValue("tradedAt");
  await expect(dialog.getByText("프로필", { exact: true })).toHaveCount(5);
  await dialog.getByLabel("extra 열 매핑").selectOption("stockName");
  await expect(dialog.getByText("저장되지 않은 변경")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "프로필 업데이트" })).toBeEnabled();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: "프로필 삭제" }).click();
  await expect(dialog.getByLabel("매핑 프로필")).toHaveValue("");
  await expect(dialog.getByText("직접 연결", { exact: true })).toHaveCount(6);
  await expect(dialog.getByLabel("raw_ticker 열 매핑")).toHaveValue("ticker");
  await expect(dialog.getByLabel("raw_date 열 매핑")).toHaveValue("tradedAt");
  await expect(dialog.getByLabel("extra 열 매핑")).toHaveValue("stockName");
  await expect(dialog.getByRole("button", { name: "프로필 업데이트" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "프로필 삭제" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "새 프로필로 저장" })).toBeEnabled();
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await expect(dialog.getByText("가져오기 후보")).toBeVisible();
});

test("같은 체결 ID의 동일 행은 독립적으로 표시하고 한 건만 가져온다", async ({ page }) => {
  const account = e2eAccount("trusted-same-account", "동일 체결 계좌");
  const stock = { id: "trusted-same-stock", ticker: "TSAM", name: "동일 체결 종목", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트", status: "보유", investmentType: "장기 코어", currentPrice: 1000, targetPrice: null, averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null, ledgerInitializedAt: "2026-08-01T00:00:00.000Z", tags: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null };
  await page.addInitScript(({ account, stock }) => {
    if (localStorage.getItem("tradejournal.accounts.v1") === null) localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account]));
    if (localStorage.getItem("tradejournal.stocks.v1") === null) localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock]));
    if (localStorage.getItem("tradejournal.trades.v1") === null) localStorage.setItem("tradejournal.trades.v1", "[]");
  }, { account, stock });
  const duplicateKeyErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error" && /same key|unique.*key/i.test(message.text())) duplicateKeyErrors.push(message.text()); });
  const csv = "거래일시,종목코드,구분,수량,가격,체결 ID\n2026-08-12T10:00:01,TSAM,매수,1,1000,same-exec\n2026-08-12T10:00:01,TSAM,매수,1,1000,same-exec";
  await page.goto("/trades");
  await page.getByRole("button", { name: "파일 가져오기" }).click();
  let dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "same.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await expect(dialog.getByText("추가 가능 1")).toBeVisible();
  await expect(dialog.getByText("정확한 중복 1")).toBeVisible();
  await expect(dialog.getByLabel("행 2 선택")).toBeEnabled();
  await expect(dialog.getByLabel("행 3 선택")).toBeDisabled();
  await expect(dialog.getByText("대표 행: 2")).toBeVisible();
  await dialog.getByRole("button", { name: "1건 추가 · 0건 복원" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]").length)).toBe(1);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]"))).toHaveLength(1);
  await page.getByRole("button", { name: "파일 가져오기" }).click();
  dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "same-again.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await expect(dialog.getByRole("button", { name: "0건 추가 · 0건 복원" })).toBeDisabled();
  expect(duplicateKeyErrors).toEqual([]);
});

test("같은 체결 ID의 충돌 행은 첫 행을 포함해 모두 차단한다", async ({ page }) => {
  const account = e2eAccount("trusted-conflict-account", "충돌 체결 계좌");
  const stock = { id: "trusted-conflict-stock", ticker: "TCNF", name: "충돌 체결 종목", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트", status: "보유", investmentType: "장기 코어", currentPrice: 1000, targetPrice: null, averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null, ledgerInitializedAt: "2026-08-01T00:00:00.000Z", tags: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null };
  await page.addInitScript(({ account, stock }) => { localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock])); localStorage.setItem("tradejournal.trades.v1", "[]"); }, { account, stock });
  await page.goto("/trades");
  for (const [name, quantities] of [["two", [1, 2]], ["three", [1, 1, 2]]] as const) {
    await page.getByRole("button", { name: "파일 가져오기" }).click();
    const dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
    const rows = quantities.map((quantity) => `2026-08-12T10:00:01,TCNF,매수,${quantity},1000,conflict-exec`);
    await dialog.locator('input[type="file"]').setInputFiles({ name: `${name}.csv`, mimeType: "text/csv", buffer: Buffer.from(["거래일시,종목코드,구분,수량,가격,체결 ID", ...rows].join("\n")) });
    await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
    await expect(dialog.getByText(`원본 충돌 ${quantities.length}`)).toBeVisible();
    for (let row = 2; row < quantities.length + 2; row += 1) await expect(dialog.getByLabel(`행 ${row} 선택`)).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "0건 추가 · 0건 복원" })).toBeDisabled();
    await dialog.getByRole("button", { name: "취소" }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]"))).toHaveLength(0);
  }
  await page.reload();
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("tradejournal.corrupt.trades.")))).toHaveLength(0);
});

test("삭제한 가져오기 거래를 중복 ID 없이 명시적으로 복원한다", async ({ page }) => {
  const account = e2eAccount("restore-account", "복원 계좌");
  const stock = { id: "restore-stock", ticker: "RSTR", name: "복원 종목", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트", status: "보유", investmentType: "장기 코어", currentPrice: 1000, targetPrice: null, averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null, ledgerInitializedAt: "2026-08-01T00:00:00.000Z", tags: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null };
  await page.addInitScript(({ account, stock }) => {
    if (localStorage.getItem("tradejournal.accounts.v1") === null) localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account]));
    if (localStorage.getItem("tradejournal.stocks.v1") === null) localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock]));
    if (localStorage.getItem("tradejournal.trades.v1") === null) localStorage.setItem("tradejournal.trades.v1", "[]");
  }, { account, stock });
  const csv = "거래일시,종목코드,구분,수량,가격,체결 ID\n2026-08-12T10:00:01,RSTR,매수,1,1000,restore-exec";

  await page.goto("/trades");
  await page.getByRole("button", { name: "파일 가져오기" }).click();
  let dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "restore.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await dialog.getByRole("button", { name: "1건 추가 · 0건 복원" }).click();
  await expect(page.getByText("1건의 거래 내역을 추가하고 0건을 복원했습니다.")).toBeVisible();
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]")[0]);

  page.once("dialog", (confirmation) => confirmation.accept());
  await page.getByRole("row").filter({ hasText: "복원 종목" }).getByRole("button", { name: "기록 삭제" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]")[0]?.deletedAt)).not.toBeNull();

  await page.getByRole("button", { name: "파일 가져오기" }).click();
  dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "restore-again.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await expect(dialog.getByText("삭제된 기록 1")).toBeVisible();
  const restoreSelection = dialog.getByLabel("행 2 선택");
  await expect(restoreSelection).not.toBeChecked();
  await restoreSelection.check();
  await dialog.getByRole("button", { name: "0건 추가 · 1건 복원" }).click();
  await page.reload();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]"));
  expect(restored).toHaveLength(1);
  expect(restored[0]).toMatchObject({ id: original.id, createdAt: original.createdAt, origin: original.origin, journalStatus: original.journalStatus, deletedAt: null });
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("tradejournal.corrupt.trades.")))).toHaveLength(0);
});

test("101개 후보를 페이지별로 검토하고 숨겨진 행을 자동 선택하지 않는다", async ({ page }) => {
  const account = e2eAccount("large-account", "대량 계좌");
  const stock = { id: "large-stock", ticker: "LARG", name: "대량 종목", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트", status: "보유", investmentType: "장기 코어", currentPrice: 1000, targetPrice: null, averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null, ledgerInitializedAt: "2026-08-01T00:00:00.000Z", tags: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null };
  await page.addInitScript(({ account, stock }) => {
    localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock])); localStorage.setItem("tradejournal.trades.v1", "[]");
  }, { account, stock });
  const rows = Array.from({ length: 101 }, (_, index) => `2026-08-${String(1 + Math.floor(index / 24)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00,LARG,매수,1,${1000 + index},bulk-${index + 1}`);
  const csv = ["거래일시,종목코드,구분,수량,가격,체결 ID", ...rows].join("\n");
  await page.goto("/trades");
  await page.getByRole("button", { name: "파일 가져오기" }).click();
  const dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "large.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await expect(dialog.getByText("현재 페이지 1 / 2")).toBeVisible();
  await expect(dialog.getByText("전체 선택 100건")).toBeVisible();
  await dialog.getByRole("button", { name: "다음" }).click();
  await expect(dialog.getByText("현재 페이지 2 / 2")).toBeVisible();
  await expect(dialog.getByText("다른 페이지 선택 100건")).toBeVisible();
  await expect(dialog.getByLabel("행 102 선택")).not.toBeChecked();
  await dialog.getByRole("button", { name: "이 페이지의 추가 가능 항목 선택" }).click();
  await expect(dialog.getByText("전체 선택 101건")).toBeVisible();
  await dialog.getByRole("button", { name: "이 페이지 선택 해제" }).click();
  await expect(dialog.getByText("전체 선택 100건")).toBeVisible();
  await dialog.getByRole("button", { name: "전체 선택 해제" }).click();
  await expect(dialog.getByRole("button", { name: "0건 추가 · 0건 복원" })).toBeDisabled();
  await dialog.getByRole("button", { name: "모든 추가 가능 항목 선택" }).click();
  await expect(dialog.getByRole("button", { name: "101건 추가 · 0건 복원" })).toBeEnabled();
});

test("현금 기록을 저장하고 다시 열어 수정·삭제한다", async ({ page }) => {
  await page.addInitScript((account) => localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])), e2eAccount("e2e-account", "E2E 계좌"));
  await page.goto("/trades");
  await page.getByRole("button", { name: "원장 기록" }).click();
  await page.getByRole("button", { name: "입금", exact: true }).click();
  await page.getByLabel("입금 금액").fill("100000");
  await page.getByLabel("계좌").selectOption("e2e-account");
  await page.getByRole("button", { name: "기록 저장" }).click();

  let row = page.getByRole("row").filter({ hasText: "E2E 계좌" });
  await expect(row).toBeVisible();
  await page.reload();
  row = page.getByRole("row").filter({ hasText: "E2E 계좌" });
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "기록 수정" }).click();
  await page.getByLabel("입금 금액").fill("120000");
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E 계좌" })).toContainText("120,000");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row").filter({ hasText: "E2E 계좌" }).getByRole("button", { name: "기록 삭제" }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E 계좌" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: "E2E 계좌" })).toHaveCount(0);
});

test("새 계좌를 등록하면서 실제 현금 잔액으로 조정한다", async ({ page }) => {
  await page.goto("/accounts");
  await page.getByRole("button", { name: "계좌 추가" }).click();
  await page.getByLabel("계좌명").fill("장기 계좌");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("link", { name: "장기 계좌" })).toBeVisible();
  await page.goto("/trades");
  await page.getByRole("button", { name: "계좌 등록·잔액 조정" }).click();
  const adjustment = page.locator('h2:has-text("계좌 잔액 조정")').locator("..");
  await adjustment.locator("select").first().selectOption({ label: "장기 계좌" });
  await adjustment.locator('input[type="number"]').fill("250000");
  await adjustment.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "장기 계좌" })).toContainText("250,000");
});

test("분석에서 장기 계좌 성과와 계좌별 결과를 표시한다", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tradejournal.trades.v1", JSON.stringify([{
    id: "long-term-deposit", stockId: null, stockName: "", planId: null, tradeType: "입금", tradedAt: "2025-01-01T09:00:00+09:00",
    quantity: 0, price: 0, amount: 100000, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountName: "장기 계좌",
    memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 5, ruleViolations: [],
    createdAt: "2025-01-01T09:00:00+09:00", updatedAt: "2025-01-01T09:00:00+09:00", deletedAt: null,
  }])));
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "장기 계좌 성과" })).toBeVisible();
  const accountRow = page.getByRole("row").filter({ hasText: "장기 계좌" });
  await expect(accountRow).toContainText("₩100,000");
  await expect(accountRow).toContainText("0.0%");
});

test("계좌 이름 변경 후에도 기존 거래 identity를 유지한다", async ({ page }) => {
  const base = (id: string, accountId: string, accountName: string, amount: number) => ({
    id, stockId: null, stockName: "", planId: null, tradeType: "입금", tradedAt: `2025-01-0${id === "a" ? "1" : "2"}T09:00:00+09:00`,
    quantity: 0, price: 0, amount, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountId, accountName,
    memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 5, ruleViolations: [],
    createdAt: "2025-01-01T09:00:00+09:00", updatedAt: "2025-01-01T09:00:00+09:00", deletedAt: null,
  });
  await page.addInitScript(({records,accounts}) => { localStorage.setItem("tradejournal.trades.v1", JSON.stringify(records)); localStorage.setItem("tradejournal.accounts.v1", JSON.stringify(accounts)); }, {records: [base("a", "pension", "연금", 100000), base("b", "general", "일반", 200000)], accounts:[e2eAccount("pension","연금"),e2eAccount("general","일반",false)]});
  await page.goto("/accounts");
  const source = page.locator("article").filter({ hasText: "연금" });
  await expect(source).toContainText("100,000");
  await source.getByRole("button", { name: "수정" }).click();
  await page.getByLabel("계좌명").fill("연금 변경");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("link", { name: "연금 변경" })).toBeVisible();
  await page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name: "매매" }).click();
  await expect(page.getByRole("row").filter({ hasText: "연금 변경" })).toHaveCount(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]")[0].accountName)).toBe("연금");
});

test("현금 흐름 없이 기존 보유 종목의 기초 포지션을 등록한다", async ({ page }) => {
  await page.addInitScript((account) => localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])), e2eAccount("opening-account", "기본 계좌"));
  await page.addInitScript(() => localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([{
    id: "opening-stock", ticker: "OPEN", name: "기존 보유 종목", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트",
    status: "보유", investmentType: "장기 코어", currentPrice: 55000, targetPrice: null, averagePrice: 0, quantity: 0,
    thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null,
    ledgerInitializedAt: "2026-08-01T00:00:00.000Z", tags: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null,
  }])));
  await page.goto("/trades?openingStockId=opening-stock");
  const dialog = page.getByRole("dialog", { name: "기초 포지션 등록" });
  await expect(dialog.getByLabel("종목")).toHaveValue("opening-stock");
  await dialog.getByLabel("수량").fill("12");
  await dialog.getByLabel("평균단가").fill("45000");
  await dialog.getByRole("button", { name: "기초 포지션 저장" }).click();
  await expect(page.getByText("기초 포지션을 등록하고 보유 수량과 평균단가를 계산했습니다.")).toBeVisible();
  await page.goto("/stocks");
  const row = page.getByRole("row").filter({ hasText: "기존 보유 종목" });
  await expect(row).toContainText("₩45,000");
  await expect(row).toContainText("12");
});

test("종목 상세에서 매매를 추가하고 수정한 뒤 삭제한다", async ({ page }) => {
  await page.addInitScript(({ account, stock }) => {
    localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account]));
    localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock]));
  }, {
    account: e2eAccount("detail-account", "상세 계좌"),
    stock: {
      id: "detail-stock", ticker: "DETAIL", name: "상세 종목", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트",
      status: "관찰", investmentType: "관찰 전용", currentPrice: 150, targetPrice: null, averagePrice: 0, quantity: 0,
      thesisSummary: "", currentView: "판단 보류", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null,
      ledgerInitializedAt: "2026-08-09T00:00:00.000Z", tags: [], createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z", deletedAt: null,
    },
  });
  await page.goto("/stocks/detail?id=detail-stock");
  await page.getByRole("button", { name: "매매 추가" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("종목")).toBeDisabled();
  await expect(dialog.getByLabel("종목")).toHaveValue("detail-stock");
  await dialog.getByLabel("수량").fill("2");
  await dialog.getByLabel("체결 가격").fill("100");
  await dialog.getByRole("button", { name: "기록 저장" }).click();
  await expect(page.getByText("매매 기록을 추가했습니다.")).toBeVisible();
  let row = page.getByRole("row").filter({ hasText: "상세 계좌" });
  await expect(row).toContainText("2");

  const holdingCard = page.locator("article").filter({ hasText: "상세 계좌" });
  await holdingCard.getByRole("button", { name: "매도", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("계좌")).toBeDisabled();
  await expect(page.getByRole("dialog").getByLabel("계좌")).toHaveValue("detail-account");
  await expect(page.getByRole("dialog").getByRole("button", { name: "매도", exact: true })).toHaveClass(/text-\[var\(--accent\)\]/);
  await page.getByRole("dialog").getByRole("button", { name: "닫기" }).click();

  await row.getByRole("button", { name: "매수 기록 수정" }).click();
  await page.getByRole("dialog").getByLabel("수량").fill("3");
  await page.getByRole("dialog").getByLabel("체결 가격").fill("120");
  await page.getByRole("dialog").getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByText("매매 기록을 변경했습니다.")).toBeVisible();
  row = page.getByRole("row").filter({ hasText: "상세 계좌" });
  await expect(row).toContainText("3");

  page.once("dialog", (confirmation) => confirmation.accept());
  await row.getByRole("button", { name: "매수 기록 삭제" }).click();
  await expect(page.getByText("매매 기록을 삭제했습니다.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "상세 계좌" })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]")[0].deletedAt)).toBeTruthy();
});

test("종목 통화를 정정하면 매수 기록과 거래일 환율을 원자적으로 갱신한다", async ({ page }) => {
  const stock = {
    id: "currency-stock", ticker: "NVDA", name: "엔비디아", market: "미국", currency: "KRW", assetType: "주식", sector: "반도체",
    status: "보유", investmentType: "장기 코어", currentPrice: 223.96, targetPrice: 300, averagePrice: 188, quantity: 2,
    thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null,
    ledgerInitializedAt: "2026-08-09T00:00:00.000Z", tags: [], createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z", deletedAt: null,
  };
  const trade = {
    id: "currency-buy", stockId: stock.id, stockName: stock.name, planId: null, tradeType: "매수", tradedAt: "2026-08-01T10:00:00.000Z",
    quantity: 2, price: 188, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountId: "currency-account", accountName: "통화 계좌",
    memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z", deletedAt: null,
  };
  await page.route("https://api.frankfurter.dev/v2/rate/USD/KRW?date=2026-08-01", async (route) => route.fulfill({ json: { date: "2026-08-01", rate: 1400 } }));
  await page.addInitScript(({ account, stock, trade }) => {
    localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account]));
    localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock]));
    localStorage.setItem("tradejournal.trades.v1", JSON.stringify([trade]));
  }, { account: e2eAccount("currency-account", "통화 계좌"), stock, trade });

  await page.goto("/stocks/detail?id=currency-stock");
  await expect(page.getByText("₩224", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "기본 정보 수정" }).click();
  await page.getByRole("dialog", { name: "종목 수정" }).getByLabel("통화").selectOption("USD");
  await page.getByRole("dialog", { name: "종목 수정" }).getByRole("button", { name: "변경 저장" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "종목 통화를 변경할까요?" });
  await expect(confirmation).toContainText("KRW → USD");
  await expect(confirmation).toContainText("1건");
  await confirmation.getByRole("button", { name: "통화 변경" }).click();

  await expect(page.getByRole("dialog", { name: "종목 수정" })).toHaveCount(0);
  await expect(page.getByText("US$223.96", { exact: true })).toBeVisible();
  await expect(page.getByText("US$188.00", { exact: true }).first()).toBeVisible();
  const persisted = await page.evaluate(() => ({
    stock: JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "[]")[0],
    trade: JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]")[0],
  }));
  expect(persisted.stock).toMatchObject({ currency: "USD", currentPrice: 223.96, averagePrice: 188, quantity: 2 });
  expect(persisted.trade).toMatchObject({ id: "currency-buy", currency: "USD", exchangeRate: 1400, price: 188, quantity: 2, accountId: "currency-account" });
});

test("계좌가 없으면 종목 상세에서 계좌 추가를 안내한다", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([{
    id: "no-account-stock", ticker: "NONE", name: "계좌 없는 종목", market: "한국", currency: "KRW", assetType: "주식", sector: "",
    status: "관찰", investmentType: "관찰 전용", currentPrice: 0, targetPrice: null, averagePrice: 0, quantity: 0,
    thesisSummary: "", currentView: "판단 보류", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null,
    ledgerInitializedAt: "2026-08-09T00:00:00.000Z", tags: [], createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z", deletedAt: null,
  }])));
  await page.goto("/stocks/detail?id=no-account-stock");
  await page.getByRole("button", { name: "매매 추가" }).click();
  await expect(page.getByText("먼저 계좌를 추가해 주세요.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "계좌 추가" })).toHaveAttribute("href", "/accounts");
});
