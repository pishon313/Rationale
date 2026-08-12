import { expect, test } from "@playwright/test";

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
