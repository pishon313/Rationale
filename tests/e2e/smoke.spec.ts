import { expect, test } from "@playwright/test";
import * as XLSX from "@e965/xlsx";

const e2eAccount = (id: string, name: string, isDefault = true) => ({ id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault, archivedAt: null, memo: "", createdAt: "2026-08-08T00:00:00.000Z", updatedAt: "2026-08-08T00:00:00.000Z" });
const e2eStock = (id: string, name: string, sector = "", overrides: Record<string, unknown> = {}) => ({
  id,
  ticker: id.toUpperCase(),
  name,
  market: "미국",
  currency: "USD",
  assetType: "주식",
  sector,
  status: "관찰",
  investmentType: "관찰 전용",
  currentPrice: 100,
  targetPrice: null,
  averagePrice: 0,
  quantity: 0,
  thesisSummary: "",
  currentView: "판단 보류",
  currentViewMemo: "",
  nextReviewDate: null,
  reviewNote: "",
  nextEarningsDate: null,
  ledgerInitializedAt: "2026-08-01T00:00:00.000Z",
  tags: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

test("대시보드 앱 셸을 표시한다", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByLabel("대시보드 표시 통화")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();
});

test("포트폴리오 셸이 Overview, Allocation, Plan 세 경로를 공유한다", async ({ page }) => {
  await page.goto("/portfolio");
  const nav = page.getByRole("navigation", { name: "포트폴리오 메뉴" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link")).toHaveCount(3);
  await expect(nav.getByRole("link", { name: "개요" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "현재 자산과 다음 저축 계획을 한눈에 보세요." })).toBeVisible();

  await nav.getByRole("link", { name: "배분" }).click();
  await expect(page).toHaveURL(/\/portfolio\/allocation$/);
  await expect(page.getByRole("heading", { name: "전체 자산의 목표 비중을 정하세요." })).toBeVisible();
  await expect(nav.getByRole("link", { name: "배분" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "계획" }).click();
  await expect(page).toHaveURL(/\/portfolio\/plan$/);
  await expect(page.getByRole("heading", { name: "월 저축액을 적금·주식·채권으로 나눠보세요." })).toBeVisible();
  await expect(nav.getByRole("link", { name: "계획" })).toHaveAttribute("aria-current", "page");

  await nav.getByRole("link", { name: "개요" }).click();
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(page.getByRole("heading", { name: "현재 자산과 다음 저축 계획을 한눈에 보세요." })).toBeVisible();
});

test("포트폴리오 셸은 320px에서 세 탭과 핵심 메타데이터를 가로 스크롤 없이 표시한다", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/portfolio/plan");
  const nav = page.getByRole("navigation", { name: "포트폴리오 메뉴" });
  await expect(nav.getByRole("link")).toHaveCount(3);
  await expect(nav.getByRole("link", { name: "계획" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("포트폴리오 선택")).toHaveValue("default");
  await expect(page.getByText("기준 통화", { exact: true })).toBeVisible();
  await expect(page.getByText("활성 Plan", { exact: true })).toBeVisible();
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});

test("Allocation 저장이 Plan 계산과 Overview에 반영되고 새로고침 후 유지된다", async ({ page }) => {
  const now = "2026-09-01T00:00:00.000Z";
  const equity = e2eStock("allocation-equity", "Allocation Equity", "Core", { ticker: "EQT", market: "한국", currency: "KRW", status: "보유", quantity: 100_000, averagePrice: 100, currentPrice: 100, ledgerInitializedAt: null, assetClass: "equity" });
  const bond = e2eStock("allocation-bond", "Allocation Bond", "Bond", { ticker: "BND", market: "한국", currency: "KRW", assetType: "ETF", assetClass: "bond", currentPrice: 100, ledgerInitializedAt: null });
  const state = { id: "default", activeRevisionId: "r1", contributionAmountMinor: 1_000_000, contributionCurrency: "KRW", updatedAt: now, repairDraft: null, balancePolicy: null };
  const revision = { id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now };
  const groups = [
    { id: "savings", revisionId: "r1", name: "Savings", targetWeightBps: 3000, sortOrder: 0, updatedAt: now },
    { id: "stocks", revisionId: "r1", name: "Stocks", targetWeightBps: 6000, sortOrder: 1, updatedAt: now },
    { id: "bonds", revisionId: "r1", name: "Bonds", targetWeightBps: 1000, sortOrder: 2, updatedAt: now },
  ];
  const targets = [
    { id: "cash", revisionId: "r1", groupId: "savings", accountId: null, targetType: "cash", stockId: null, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now },
    { id: "equity", revisionId: "r1", groupId: "stocks", accountId: null, targetType: "stock", stockId: equity.id, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now },
    { id: "bond", revisionId: "r1", groupId: "bonds", accountId: null, targetType: "stock", stockId: bond.id, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now },
  ];
  await page.addInitScript(({ state, revision, groups, targets, stocks }) => {
    if (localStorage.getItem("tradejournal.portfolio-plan-state.v1")) return;
    localStorage.setItem("tradejournal.accounts.v1", "[]");
    localStorage.setItem("tradejournal.stocks.v1", JSON.stringify(stocks));
    localStorage.setItem("tradejournal.trades.v1", "[]");
    localStorage.setItem("tradejournal.portfolio-plan-state.v1", JSON.stringify([state]));
    localStorage.setItem("tradejournal.portfolio-plan-revisions.v1", JSON.stringify([revision]));
    localStorage.setItem("tradejournal.portfolio-allocation-groups.v1", JSON.stringify(groups));
    localStorage.setItem("tradejournal.portfolio-allocation-targets.v1", JSON.stringify(targets));
  }, { state, revision, groups, targets, stocks: [equity, bond] });

  await page.goto("/portfolio/allocation");
  await page.getByLabel("현금성 자산 전체 목표 (%)").fill("20");
  await page.getByLabel("주식 투자 전체 목표 (%)").fill("70");
  await page.getByRole("button", { name: "Allocation 저장" }).click();
  await expect(page.getByRole("status")).toContainText("Allocation을 저장했습니다.");

  const nav = page.getByRole("navigation", { name: "포트폴리오 메뉴" });
  await nav.getByRole("link", { name: "계획" }).click();
  const weights = page.getByLabel("전체 저축액 중 비율 (%)");
  await expect(weights.nth(0)).toHaveValue("66.67");
  await expect(weights.nth(1)).toHaveValue("0");
  await expect(weights.nth(2)).toHaveValue("33.33");

  await nav.getByRole("link", { name: "개요" }).click();
  const nextContribution = page.getByRole("region", { name: "다음 저축 계획" });
  await expect(nextContribution).toContainText("₩666,700");
  await expect(nextContribution).toContainText("₩333,300");

  await nav.getByRole("link", { name: "배분" }).click();
  await expect(page).toHaveURL(/\/portfolio\/allocation$/);
  await page.reload();
  await expect(page.getByLabel("현금성 자산 전체 목표 (%)")).toHaveValue("20");
  await expect(page.getByLabel("주식 투자 전체 목표 (%)")).toHaveValue("70");
});

test("대시보드 자산을 내 분류와 시장 섹터로 전환하고 보기·색상·비중을 안정적으로 유지한다", async ({ page }) => {
  const stocks = [
    e2eStock("core-tech", "코어 기술", "Core", { marketSector: "information-technology", status: "보유", quantity: 6, averagePrice: 80, currentPrice: 100, ledgerInitializedAt: null }),
    e2eStock("core-energy", "코어 에너지", " core ", { marketSector: "energy", status: "보유", quantity: 3, averagePrice: 80, currentPrice: 100, ledgerInitializedAt: null }),
    e2eStock("satellite-tech", "위성 기술", "Satellite", { marketSector: "information-technology", status: "보유", quantity: 1, averagePrice: 80, currentPrice: 100, ledgerInitializedAt: null }),
    e2eStock("tiny-unset", "아주 작은 미지정", "", { marketSector: null, status: "보유", quantity: 0.000001, averagePrice: 1, currentPrice: 1, ledgerInitializedAt: null }),
  ];
  await page.addInitScript((values) => {
    if (localStorage.getItem("tradejournal.stocks.v1") === null) localStorage.setItem("tradejournal.stocks.v1", JSON.stringify(values));
    if (localStorage.getItem("tradejournal.trades.v1") === null) localStorage.setItem("tradejournal.trades.v1", "[]");
  }, stocks);

  await page.goto("/dashboard");
  const myCategory = page.getByRole("button", { name: "내 분류", exact: true });
  const marketSector = page.getByRole("button", { name: "시장 섹터", exact: true });
  await expect(myCategory).toHaveAttribute("aria-pressed", "true");
  const core = page.locator('[data-group-id="portfolio-category:core"]');
  await expect(core).toContainText("코어 기술");
  await expect(core).toContainText("코어 에너지");
  await expect(page.locator('[data-group-id="portfolio-category:satellite"]')).toContainText("위성 기술");
  await expect(page.locator('[data-group-id="portfolio-category:__unspecified__"]')).toContainText("<0.1%");
  const categoryTotal = await page.locator('[data-group-id^="portfolio-category:"]').evaluateAll((groups) => groups.reduce((sum, group) => sum + Number((group as HTMLElement).dataset.groupShare), 0));
  expect(categoryTotal).toBeCloseTo(100, 7);

  await marketSector.click();
  await expect(marketSector).toHaveAttribute("aria-pressed", "true");
  const technology = page.locator('[data-group-id="market-sector:information-technology"]');
  await expect(technology).toContainText("코어 기술");
  await expect(technology).toContainText("위성 기술");
  await expect(page.locator('[data-group-id="market-sector:energy"]')).toContainText("코어 에너지");
  await expect(page.locator('[data-group-id="market-sector:__unspecified__"]')).toContainText("<0.1%");
  const marketTotal = await page.locator('[data-group-id^="market-sector:"]').evaluateAll((groups) => groups.reduce((sum, group) => sum + Number((group as HTMLElement).dataset.groupShare), 0));
  expect(marketTotal).toBeCloseTo(100, 7);
  const technologyColor = await technology.getAttribute("data-group-color");

  await page.reload();
  await expect(marketSector).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "[]");
    for (const stock of stored) {
      if (stock.id === "core-tech" || stock.id === "satellite-tech") stock.currentPrice = 1;
      if (stock.id === "core-energy") stock.currentPrice = 1000;
    }
    localStorage.setItem("tradejournal.stocks.v1", JSON.stringify(stored));
  });
  await page.reload();
  const marketGroups = page.locator('[data-group-id^="market-sector:"]');
  await expect(marketGroups.first()).toHaveAttribute("data-group-id", "market-sector:energy");
  await expect(page.locator('[data-group-id="market-sector:information-technology"]')).toHaveAttribute("data-group-color", technologyColor ?? "");

  await page.getByRole("button", { name: "도넛형" }).click();
  const chart = page.getByTestId("asset-allocation-donut-chart");
  const legend = page.getByTestId("asset-allocation-donut-legend");
  await expect(chart).toHaveAttribute("role", "img");
  const [chartBox, legendBox] = await Promise.all([chart.boundingBox(), legend.boundingBox()]);
  expect(chartBox).not.toBeNull();
  expect(legendBox).not.toBeNull();
  expect(Math.abs((chartBox?.y ?? 0) - (legendBox?.y ?? 0))).toBeLessThanOrEqual(2);
  await page.setViewportSize({ width: 390, height: 844 });
  const [mobileChartBox, mobileLegendBox, widths] = await Promise.all([
    chart.boundingBox(),
    legend.boundingBox(),
    page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth })),
  ]);
  expect((mobileLegendBox?.y ?? 0)).toBeGreaterThan(mobileChartBox?.y ?? 0);
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});

test("대시보드 분류가 모두 비어 있으면 미지정 그룹과 설정 안내를 표시한다", async ({ page }) => {
  const stock = e2eStock("unset", "분류 미지정 종목", "", { marketSector: null, status: "보유", quantity: 2, averagePrice: 80, currentPrice: 100, ledgerInitializedAt: null });
  await page.addInitScript((value) => {
    localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([value]));
    localStorage.setItem("tradejournal.trades.v1", "[]");
  }, stock);

  await page.goto("/dashboard");
  await expect(page.locator('[data-group-id="portfolio-category:__unspecified__"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "종목에서 내 분류 설정" })).toHaveAttribute("href", "/stocks");
  await page.getByRole("button", { name: "시장 섹터", exact: true }).click();
  await expect(page.locator('[data-group-id="market-sector:__unspecified__"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "종목에서 시장 섹터 설정" })).toHaveAttribute("href", "/stocks");
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

test("설정의 API 키 발급 사이트를 외부 창으로 연다", async ({ page }) => {
  await page.addInitScript(() => {
    window.open = ((url: string | URL | undefined, target?: string, features?: string) => {
      window.sessionStorage.setItem("e2e:last-external-open", JSON.stringify([String(url), target, features]));
      return null;
    }) as typeof window.open;
  });
  await page.goto("/settings");

  const links = page.getByRole("button", { name: "키 발급 사이트" });
  await expect(links).toHaveCount(2);
  await links.nth(0).click();
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("e2e:last-external-open"))).toBe('["https://twelvedata.com/","_blank","noopener,noreferrer"]');
  await links.nth(1).click();
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("e2e:last-external-open"))).toBe('["https://eodhd.com/","_blank","noopener,noreferrer"]');
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

test("많은 등록 종목에서 Trade·Observation·Review·Plan을 정확한 ID로 검색해 저장한다", async ({ page }) => {
  test.setTimeout(90_000);
  const target = e2eStock("picker-target", "검색 선택 종목", "테스트", { ticker: "PICKME" });
  const stocks = [
    ...Array.from({ length: 125 }, (_, index) => e2eStock(
      `synthetic-${index}`,
      `합성 종목 ${String(index).padStart(3, "0")}`,
      "테스트",
      { ticker: `SYN${String(index).padStart(3, "0")}` },
    )),
    target,
  ];
  const account = e2eAccount("picker-account", "검색 선택 계좌");
  await page.addInitScript(({ account, stocks }) => {
    if (localStorage.getItem("tradejournal.accounts.v1") === null) localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account]));
    if (localStorage.getItem("tradejournal.stocks.v1") === null) localStorage.setItem("tradejournal.stocks.v1", JSON.stringify(stocks));
    for (const collection of ["trades", "observations", "reviews", "plans"]) {
      const key = `tradejournal.${collection}.v1`;
      if (localStorage.getItem(key) === null) localStorage.setItem(key, "[]");
    }
  }, { account, stocks });

  await page.goto("/trades");
  await page.getByRole("button", { name: "원장 기록" }).click();
  let form = page.getByRole("dialog", { name: "새 원장 기록" });
  let picker = form.getByRole("combobox", { name: "종목" });
  await picker.focus();
  await picker.pressSequentially("pickme");
  await picker.press("Enter");
  await expect(picker).toHaveValue("PICKME · 검색 선택 종목");
  await form.getByLabel("계좌").selectOption(account.id);
  await form.getByLabel("수량").fill("2");
  await form.getByLabel("체결 가격").fill("100");
  await form.getByRole("button", { name: "기록 저장" }).click();
  const tradeRow = page.getByRole("row").filter({ hasText: target.name });
  await expect(tradeRow).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]")[0]?.stockId)).toBe(target.id);
  await tradeRow.getByRole("button", { name: "기록 수정" }).click();
  form = page.getByRole("dialog", { name: "기록 수정" });
  await expect(form.getByRole("combobox", { name: "종목" })).toHaveValue("PICKME · 검색 선택 종목");
  await form.getByRole("button", { name: "닫기" }).click();

  await page.goto("/observations");
  await page.getByRole("button", { name: "새 기록" }).click();
  form = page.locator("form");
  picker = form.getByRole("combobox", { name: "종목" });
  await picker.fill("pickme");
  await form.getByRole("option", { name: "PICKME · 검색 선택 종목" }).click();
  await form.getByLabel("제목").fill("검색 선택 관찰");
  await form.getByLabel("내용").fill("정확한 등록 종목 ID로 저장한다.");
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "검색 선택 관찰" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.observations.v1") ?? "[]")[0]?.stockId)).toBe(target.id);
  await page.getByLabel("검색 선택 관찰 수정").click();
  form = page.locator("form");
  await expect(form.getByRole("combobox", { name: "종목" })).toHaveValue("PICKME · 검색 선택 종목");
  await form.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByLabel("관찰 대상 필터").getByRole("button", { name: "종목", exact: true }).click();
  picker = page.getByRole("combobox", { name: "관찰 종목 필터" });
  await picker.fill("pickme");
  await picker.press("Enter");
  await expect(page.getByRole("heading", { name: "검색 선택 관찰" })).toBeVisible();

  await page.goto("/reviews");
  await page.getByRole("button", { name: "회고 작성" }).click();
  form = page.locator("form");
  picker = form.getByRole("combobox", { name: "연결할 종목 (선택)" });
  await picker.fill("pickme");
  await form.getByRole("option", { name: "PICKME · 검색 선택 종목" }).click();
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("검색 선택 종목", { exact: false }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.reviews.v1") ?? "[]")[0]?.stockId)).toBe(target.id);
  await page.getByRole("button", { name: "회고 수정" }).first().click();
  form = page.locator("form");
  await expect(form.getByRole("combobox", { name: "연결할 종목 (선택)" })).toHaveValue("PICKME · 검색 선택 종목");
  await form.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("button", { name: "회고 작성" }).click();
  form = page.locator("form");
  await form.getByPlaceholder("예: NVIDIA · 매수하지 않은 결정").fill("등록하지 않은 회고 대상");
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("등록하지 않은 회고 대상", { exact: false }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.reviews.v1") ?? "[]")[0]?.stockId)).toBeNull();

  await page.goto("/plans");
  await page.getByRole("button", { name: "계획 추가" }).click();
  form = page.getByRole("dialog");
  picker = form.getByRole("combobox", { name: "종목" });
  await picker.fill("pickme");
  await form.getByRole("option", { name: "PICKME · 검색 선택 종목" }).click();
  await form.getByLabel("계획 제목").fill("검색 선택 계획");
  await form.getByLabel("무효화 조건").fill("전제가 훼손되면 취소한다.");
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "검색 선택 계획" })).toContainText("PICKME");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.plans.v1") ?? "[]")[0]?.stockId)).toBe(target.id);
  await page.getByRole("button", { name: "검색 선택 계획 수정" }).click();
  form = page.getByRole("dialog");
  await expect(form.getByRole("combobox", { name: "종목" })).toHaveValue("PICKME · 검색 선택 종목");
  await form.getByRole("button", { name: "취소", exact: true }).click();

  const identities = await page.evaluate(() => ({
    trade: JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]")[0]?.stockId,
    observation: JSON.parse(localStorage.getItem("tradejournal.observations.v1") ?? "[]")[0]?.stockId,
    review: JSON.parse(localStorage.getItem("tradejournal.reviews.v1") ?? "[]").find((item: { stockId: string | null }) => item.stockId)?.stockId,
    plan: JSON.parse(localStorage.getItem("tradejournal.plans.v1") ?? "[]")[0]?.stockId,
  }));
  expect(identities).toEqual({ trade: target.id, observation: target.id, review: target.id, plan: target.id });
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

test("시장 섹터, 내 분류, 태그를 독립적으로 저장하고 다시 연다", async ({ page }) => {
  const stocks = [
    e2eStock("classification", "분류 대상"),
    e2eStock("category-source", "기존 분류 종목", "Long-term Core"),
  ];
  await page.addInitScript((values) => localStorage.setItem("tradejournal.stocks.v1", JSON.stringify(values)), stocks);
  await page.goto("/stocks");

  await page.getByRole("button", { name: "분류 대상 수정" }).click();
  let dialog = page.getByRole("dialog", { name: "종목 수정" });
  await dialog.getByLabel("시장 섹터").selectOption("information-technology");
  await dialog.getByLabel("내 분류").fill(" long-term core ");
  await dialog.getByLabel("태그").fill("AI, 성장, 클라우드");
  await dialog.getByRole("button", { name: "변경 저장" }).click();

  await page.getByRole("button", { name: "분류 대상 수정" }).click();
  dialog = page.getByRole("dialog", { name: "종목 수정" });
  await expect(dialog.getByLabel("시장 섹터")).toHaveValue("information-technology");
  await expect(dialog.getByLabel("내 분류")).toHaveValue("Long-term Core");
  await expect(dialog.getByLabel("태그")).toHaveValue("AI, 성장, 클라우드");
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "[]").find((stock: { id: string }) => stock.id === "classification"));
  expect(persisted).toMatchObject({ marketSector: "information-technology", sector: "Long-term Core", tags: ["AI", "성장", "클라우드"] });
});

test("새 내 분류를 다른 종목에서 재사용한다", async ({ page }) => {
  const stocks = [e2eStock("custom-a", "사용자 분류 A"), e2eStock("custom-b", "사용자 분류 B")];
  await page.addInitScript((values) => localStorage.setItem("tradejournal.stocks.v1", JSON.stringify(values)), stocks);
  await page.goto("/stocks");

  await page.getByRole("button", { name: "사용자 분류 A 수정" }).click();
  await page.getByRole("dialog", { name: "종목 수정" }).getByLabel("내 분류").fill("  신규   분류  ");
  await page.getByRole("dialog", { name: "종목 수정" }).getByRole("button", { name: "변경 저장" }).click();

  await page.getByRole("button", { name: "사용자 분류 B 수정" }).click();
  const dialog = page.getByRole("dialog", { name: "종목 수정" });
  await expect(dialog.locator('#portfolio-category-options option[value="신규 분류"]')).toHaveCount(1);
  await dialog.getByLabel("내 분류").fill("신규 분류");
  await dialog.getByRole("button", { name: "변경 저장" }).click();

  const categories = await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "[]").map((stock: { sector: string }) => stock.sector));
  expect(categories).toEqual(["신규 분류", "신규 분류"]);
});

test("내 분류를 정규화해 이름 변경, 병합, 해제하고 재실행 후 유지한다", async ({ page }) => {
  const stocks = [
    e2eStock("energy-a", "에너지 A", "Energy"),
    e2eStock("energy-b", "에너지 B", " energy "),
    e2eStock("semi", "반도체", "반도체"),
    e2eStock("semi-it", "반도체 IT", "반도체, IT"),
  ];
  await page.addInitScript((values) => {
    if (sessionStorage.getItem("e2e:portfolio-categories-seeded")) return;
    localStorage.setItem("tradejournal.stocks.v1", JSON.stringify(values));
    sessionStorage.setItem("e2e:portfolio-categories-seeded", "yes");
  }, stocks);
  await page.goto("/stocks");

  const trigger = page.getByRole("button", { name: "내 분류 관리" });
  await trigger.click();
  const manager = page.getByRole("dialog", { name: "내 분류 관리" });
  const energy = manager.getByRole("listitem").filter({ hasText: "Energy" });
  await expect(energy).toContainText("2개 활성 종목 · 2개 전체 종목");
  await expect(manager.getByRole("listitem")).toHaveCount(3);

  await energy.getByRole("button", { name: "이름 변경" }).click();
  await energy.getByLabel("새 분류 이름").fill("Energy Theme");
  await energy.getByRole("button", { name: "이름 저장" }).click();
  await expect(manager.getByText("Energy Theme", { exact: true })).toBeVisible();

  const source = manager.getByRole("listitem").filter({ hasText: "반도체, IT" });
  await source.getByRole("button", { name: "병합" }).click();
  await source.getByLabel("합칠 대상").selectOption({ label: "반도체" });
  await source.getByRole("button", { name: "병합 계속" }).click();
  let confirmation = page.getByRole("alertdialog", { name: "분류를 병합할까요?" });
  await expect(confirmation).toContainText("반도체, IT 분류의 종목 1개를 반도체(으)로 변경합니다.");
  await confirmation.getByRole("button", { name: "분류 병합" }).click();
  await expect(manager.getByText("반도체, IT", { exact: true })).toHaveCount(0);

  const renamed = manager.getByRole("listitem").filter({ hasText: "Energy Theme" });
  await renamed.getByRole("button", { name: "분류 해제" }).click();
  confirmation = page.getByRole("alertdialog", { name: "분류를 해제할까요?" });
  await expect(confirmation).toContainText("종목 2개에서 내 분류를 비웁니다. 종목은 삭제되지 않습니다.");
  await confirmation.getByRole("button", { name: "분류 해제" }).click();
  await expect(manager.getByText("Energy Theme", { exact: true })).toHaveCount(0);

  await manager.getByRole("button", { name: "닫기" }).click();
  await expect(trigger).toBeFocused();
  await page.reload();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "[]"));
  expect(persisted).toHaveLength(4);
  expect(persisted.filter((stock: { id: string }) => stock.id.startsWith("energy")).map((stock: { sector: string }) => stock.sector)).toEqual(["", ""]);
  expect(persisted.filter((stock: { id: string }) => stock.id.startsWith("semi")).map((stock: { sector: string }) => stock.sector)).toEqual(["반도체", "반도체"]);
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

test("매수 계획에서 온라인 종목을 확인한 뒤 Stock과 Plan을 함께 저장하고 취소 시 orphan을 남기지 않는다", async ({ page }) => {
  const initialStock = e2eStock("local-stock", "등록 종목", "테스트", { ticker: "LOCAL" });
  const remote = {
    provider: "eodhd", providerSymbol: "CRWD.US", ticker: "CRWD", name: "CrowdStrike Holdings", countryCode: "US", countryName: "USA",
    exchangeCode: "US", exchangeMic: "XNAS", exchangeName: "NASDAQ", currency: "USD", assetType: "Common Stock", isin: "US22788C1053",
    previousClose: 430.25, previousCloseDate: "2026-08-17", isPrimary: true,
  };
  await page.addInitScript((stock) => {
    if (localStorage.getItem("tradejournal.stocks.v1") === null) {
      localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock]));
    }
    if (localStorage.getItem("tradejournal.plans.v1") === null) {
      localStorage.setItem("tradejournal.plans.v1", "[]");
    }
  }, initialStock);
  await page.goto("/plans");
  await page.getByRole("button", { name: "계획 추가" }).click();
  const picker = page.getByRole("combobox", { name: "종목" });
  await picker.fill("CRWD");
  await page.evaluate((result) => {
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__ = {
      invoke: async (command) => command === "search_instruments" ? [result] : undefined,
    };
  }, remote);
  await page.getByRole("button", { name: "온라인에서 ‘CRWD’ 검색" }).click();
  await page.getByRole("button", { name: /CRWD · CrowdStrike Holdings/ }).click();
  await page.getByRole("alertdialog", { name: "종목 추가 확인" }).getByRole("button", { name: "추가하고 계획 만들기" }).click();
  await page.evaluate(() => { delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });
  await page.getByLabel("계획 제목").fill("CRWD 진입 계획");
  await page.getByLabel("무효화 조건").fill("보안 성장률 훼손");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("CRWD 진입 계획")).toBeVisible();

  const persisted = await page.evaluate(() => ({
    stocks: JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "[]"),
    plans: JSON.parse(localStorage.getItem("tradejournal.plans.v1") ?? "[]"),
  }));
  const created = persisted.stocks.find((stock: { ticker: string }) => stock.ticker === "CRWD");
  expect(created).toMatchObject({ status: "관찰", investmentType: "관찰 전용", providerRefs: [{ provider: "eodhd", symbol: "CRWD.US", exchangeCode: "US" }] });
  expect(persisted.plans).toEqual([expect.objectContaining({ stockId: created.id, stockName: "CrowdStrike Holdings", ticker: "CRWD" })]);
  await page.reload();
  await expect(page.getByText("CRWD 진입 계획")).toBeVisible();

  await page.getByRole("button", { name: "계획 추가" }).click();
  const secondPicker = page.getByRole("combobox", { name: "종목" });
  await secondPicker.fill("NET");
  const secondRemote = { ...remote, providerSymbol: "NET.US", ticker: "NET", name: "Cloudflare", isin: "US18915M1071" };
  await page.evaluate((result) => {
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: (command: string) => Promise<unknown> } }).__TAURI_INTERNALS__ = { invoke: async () => [result] };
  }, secondRemote);
  await page.getByRole("button", { name: "온라인에서 ‘NET’ 검색" }).click();
  await page.getByRole("button", { name: /NET · Cloudflare/ }).click();
  await page.getByRole("alertdialog", { name: "종목 추가 확인" }).getByRole("button", { name: "추가하고 계획 만들기" }).click();
  await page.evaluate(() => { delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "[]").length)).toBe(2);
});

test("Stock+Plan 원자 저장 실패는 draft Stock과 Plan을 모두 롤백한다", async ({ page }) => {
  const initialStock = e2eStock("local-stock", "등록 종목", "테스트", { ticker: "LOCAL" });
  const remote = {
    provider: "eodhd", providerSymbol: "FAIL.US", ticker: "FAIL", name: "Failure Test", countryCode: "US", countryName: "USA",
    exchangeCode: "US", exchangeMic: "XNAS", exchangeName: "NASDAQ", currency: "USD", assetType: "Common Stock", isin: "US0000000001",
    previousClose: null, previousCloseDate: null, isPrimary: true,
  };
  await page.addInitScript((stock) => { localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock])); localStorage.setItem("tradejournal.plans.v1", "[]"); }, initialStock);
  await page.goto("/plans");
  await page.getByRole("button", { name: "계획 추가" }).click();
  await page.getByRole("combobox", { name: "종목" }).fill("FAIL");
  await page.evaluate((result) => {
    (window as typeof window & { __TAURI_INTERNALS__?: { invoke: () => Promise<unknown> } }).__TAURI_INTERNALS__ = { invoke: async () => [result] };
  }, remote);
  await page.getByRole("button", { name: "온라인에서 ‘FAIL’ 검색" }).click();
  await page.getByRole("button", { name: /FAIL · Failure Test/ }).click();
  await page.getByRole("alertdialog", { name: "종목 추가 확인" }).getByRole("button", { name: "추가하고 계획 만들기" }).click();
  await page.evaluate(() => {
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const original = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function (key, value) {
      if (key === "tradejournal.plans.v1" && !failed) { failed = true; throw new Error("simulated plan failure"); }
      return original.call(this, key, value);
    };
  });
  await page.getByLabel("계획 제목").fill("실패 계획");
  await page.getByLabel("무효화 조건").fill("실패 조건");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("종목과 매수 계획을 저장하지 못했습니다. 다시 시도해 주세요.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => ({ stocks: JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "[]"), plans: JSON.parse(localStorage.getItem("tradejournal.plans.v1") ?? "[]") }))).toEqual({ stocks: [initialStock], plans: [] });
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

test("Backup V5 복원 후 포트폴리오 분류를 그대로 유지한다", async ({ page }) => {
  const classified = e2eStock("backup-classified", "백업 분류 종목", "장기 핵심", {
    marketSector: "information-technology",
    tags: ["AI", "클라우드"],
  });
  const backup = {
    version: 5,
    exportedAt: "2026-08-17T00:00:00.000Z",
    accounts: [],
    stocks: [classified],
    plans: [],
    trades: [],
    observations: [],
    reviews: [],
    rules: [],
    notes: [],
    language: "ko",
    dashboardNotes: [{ id: "dashboard-note", content: "", updatedAt: "2026-08-17T00:00:00.000Z" }],
    earningsEvents: [],
    displayCurrency: "KRW",
  };
  await page.goto("/settings");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "백업 복원" }).click();
  await (await chooser).setFiles({ name: "classification-v5.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  const confirmation = page.getByRole("alertdialog", { name: "복원할 백업 확인" });
  await expect(confirmation).toContainText("종목");
  await confirmation.getByRole("button", { name: "확인 후 복원" }).click();
  await expect(page.getByText("복원했습니다. 화면을 새로고침해 주세요.")).toBeVisible();

  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "[]")[0]);
  expect(restored).toMatchObject({ id: "backup-classified", marketSector: "information-technology", sector: "장기 핵심", tags: ["AI", "클라우드"] });
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

test("미래에셋 계좌 활동 원장을 명시적으로 적용해 체결 행만 가져온다", async ({ page }) => {
  const account = e2eAccount("mirae-ledger-account", "합성 원장 계좌");
  const baseStock = { market: "한국", currency: "KRW", assetType: "주식", sector: "테스트", status: "보유", investmentType: "장기 코어", currentPrice: 50000, targetPrice: null, averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null, ledgerInitializedAt: "2026-08-01T00:00:00.000Z", tags: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null };
  const stocks = [{ ...baseStock, id: "synthetic-alpha", ticker: "SALP", name: "합성 알파" }, { ...baseStock, id: "synthetic-beta", ticker: "SBET", name: "합성 베타" }];
  await page.addInitScript(({ account, stocks }) => { localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.stocks.v1", JSON.stringify(stocks)); localStorage.setItem("tradejournal.trades.v1", "[]"); }, { account, stocks });
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["거래일자", "거래종류", "종목명", "거래수량", "거래금액", "외화거래금액", "수수료", "예수금잔고"],
    ["2026-08-16", "주식매수입고", "합성 알파", 2, 100000, 0, 10, 0],
    ["2026-08-16", "주식매수입고", "합성 베타", 1, 50000, 0, 20, 0],
    ["2026-08-16", "주식매수출금", "", 0, 150000, 0, 30, 0],
    ["2026-08-16", "이체송금", "", "", "", "", "", 0],
    ["2026-08-16", "배당세출금", "", "", "", "", "", 0],
    ["2026-08-16", "펀드정기자동매수", "합성 펀드", 1, 1000, 0, 0, 0],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "거래내역");
  const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));

  await page.goto("/trades");
  await page.getByRole("button", { name: "파일 가져오기" }).click();
  const dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "synthetic-account-ledger.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await expect(dialog.getByText("미래에셋 계좌 활동 원장 형식으로 보입니다.")).toBeVisible();
  await expect(dialog.getByLabel("거래금액 열 매핑", { exact: true })).toHaveValue("grossAmount");
  await expect(dialog.getByLabel("거래금액 열 매핑", { exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "미래에셋 규칙 적용" }).click();
  await expect(dialog.getByText("미래에셋 규칙이 적용되었습니다. 어댑터가 소유한 열 연결은 읽기 전용이며, 정산·비매매 행은 원장에 저장되지 않습니다.")).toBeVisible();
  await expect(dialog.getByLabel("거래금액 열 매핑", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await expect(dialog.getByText("추가 가능 2")).toBeVisible();
  await expect(dialog.getByText("정산 대응 행 1")).toBeVisible();
  await expect(dialog.getByText("비매매 계좌 활동 2")).toBeVisible();
  await expect(dialog.getByText("지원하지 않는 거래 1")).toBeVisible();
  await expect(dialog.getByText("총액 100,000 ÷ 수량 2 = 단가 50,000")).toBeVisible();
  await expect(dialog.getByText("매수/매도 구분을 확인해 주세요.")).toHaveCount(0);
  await expect(dialog.getByText("연결할 종목을 찾을 수 없습니다.")).toHaveCount(0);
  await dialog.getByRole("button", { name: "2건 추가 · 0건 복원" }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]").length)).toBe(2);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]"));
  expect(stored.map((trade: { price: number }) => trade.price)).toEqual([50000, 50000]);
  expect(stored.map((trade: { feeMode: string }) => trade.feeMode)).toEqual(["sourceProvided", "sourceProvided"]);
  expect(stored.every((trade: { feeCalculation: unknown }) => trade.feeCalculation === null)).toBe(true);
  expect(stored.every((trade: Record<string, unknown>) => !("grossAmount" in trade) && !("priceEvidence" in trade))).toBe(true);
});

test("미래에셋 정산 불일치 그룹은 저장하지 않는다", async ({ page }) => {
  const account = e2eAccount("mirae-mismatch-account", "합성 불일치 계좌");
  const stock = { id: "mismatch-stock", ticker: "MSYN", name: "합성 불일치", market: "한국", currency: "KRW", assetType: "주식", sector: "테스트", status: "보유", investmentType: "장기 코어", currentPrice: 50000, targetPrice: null, averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null, ledgerInitializedAt: "2026-08-01T00:00:00.000Z", tags: [], createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null };
  await page.addInitScript(({ account, stock }) => { localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock])); localStorage.setItem("tradejournal.trades.v1", "[]"); }, { account, stock });
  const source = [
    "거래일자,거래종류,종목명,거래수량,거래금액,외화거래금액,수수료,예수금잔고",
    "2026-08-16,주식매수입고,합성 불일치,2,100000,0,10,0",
    "2026-08-16,주식매수출금,,0,99999,0,10,0",
  ].join("\n");
  await page.goto("/trades"); await page.getByRole("button", { name: "파일 가져오기" }).click();
  const dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "synthetic-mismatch.csv", mimeType: "text/csv", buffer: Buffer.from(source) });
  await dialog.getByRole("button", { name: "미래에셋 규칙 적용" }).click();
  await dialog.getByRole("button", { name: "거래 후보 검토" }).click();
  await expect(dialog.getByText("제외됨 1")).toBeVisible();
  await expect(dialog.getByText("정산 대응 행 1")).toBeVisible();
  await expect(dialog.getByText("주식 체결 금액과 대응 정산 행이 일치하지 않아 관련 매매를 가져올 수 없습니다.").first()).toBeVisible();
  await expect(dialog.getByRole("button", { name: "0건 추가 · 0건 복원" })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]"))).toHaveLength(0);
});

test("범용 총 거래금액을 단가로 잘못 연결하면 검토를 차단한다", async ({ page }) => {
  const account = e2eAccount("gross-guard-account", "합성 총액 계좌");
  await page.addInitScript((account) => { localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.stocks.v1", "[]"); localStorage.setItem("tradejournal.trades.v1", "[]"); }, account);
  await page.goto("/trades"); await page.getByRole("button", { name: "파일 가져오기" }).click();
  const dialog = page.getByRole("dialog", { name: "증권사 거래 내역 가져오기" });
  await dialog.locator('input[type="file"]').setInputFiles({ name: "synthetic-gross.csv", mimeType: "text/csv", buffer: Buffer.from("거래일,구분,수량,거래금액,종목명\n2026-08-16,매수,2,100000,합성 종목") });
  await expect(dialog.getByLabel("거래금액 열 매핑")).toHaveValue("grossAmount");
  await dialog.getByLabel("거래금액 열 매핑").selectOption("price");
  await expect(dialog.getByText("총 거래금액 열을 체결 단가로 연결할 수 없습니다. 총 거래금액으로 연결해 주세요.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "거래 후보 검토" })).toBeDisabled();
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

test("계좌 수수료 규칙을 생성·미리보기·복제·삭제하고 기존 거래 수수료를 보존한다", async ({ page }) => {
  const account = e2eAccount("fee-account", "수수료 계좌");
  const historicalTrade = {
    id: "historical-fee", stockId: null, stockName: "", planId: null, tradeType: "입금", tradedAt: "2026-01-01T09:00:00+09:00",
    quantity: 0, price: 0, amount: 1000, currency: "KRW", exchangeRate: 1, fee: 7, tax: 0, accountId: account.id, accountName: account.name,
    memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, ruleViolations: [], createdAt: "2026-01-01T09:00:00+09:00", updatedAt: "2026-01-01T09:00:00+09:00", deletedAt: null,
  };
  await page.addInitScript(({ account, trade }) => { localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account])); localStorage.setItem("tradejournal.trades.v1", JSON.stringify([trade])); localStorage.setItem("tradejournal.stocks.v1", "[]"); }, { account, trade: historicalTrade });
  await page.goto("/accounts");
  await page.locator("article").filter({ hasText: "수수료 계좌" }).getByRole("button", { name: "수정" }).click();
  await page.getByRole("checkbox", { name: "수수료 정책 사용" }).check();
  await page.getByRole("button", { name: "수수료 규칙 추가" }).click();
  let ruleDialog = page.getByRole("dialog", { name: "수수료 규칙 추가" });
  await ruleDialog.getByLabel("규칙 이름").fill("KRW 기본");
  await ruleDialog.getByLabel("수수료율 (%)").fill("+00.1500");
  await ruleDialog.getByLabel("예상 거래금액").fill("10000");
  await expect(ruleDialog).toContainText("15 KRW");
  await ruleDialog.getByRole("button", { name: "규칙 저장" }).click();

  await page.getByRole("button", { name: "수수료 규칙 추가" }).click();
  ruleDialog = page.getByRole("dialog", { name: "수수료 규칙 추가" });
  await ruleDialog.getByLabel("규칙 이름").fill("미국 기본");
  await ruleDialog.getByLabel("시장").selectOption("미국");
  await ruleDialog.getByLabel("통화").selectOption("USD");
  await ruleDialog.getByLabel("수수료율 (%)").fill("0.2");
  await ruleDialog.getByLabel("반올림 방식").selectOption("round");
  await ruleDialog.getByLabel("반올림 단위").fill("0.01");
  await ruleDialog.getByRole("button", { name: "규칙 저장" }).click();

  await page.getByRole("button", { name: "KRW 기본 복제" }).click();
  ruleDialog = page.getByRole("dialog", { name: "수수료 규칙 복제" });
  await ruleDialog.getByRole("button", { name: "규칙 저장" }).click();
  await expect(ruleDialog.getByRole("alert")).toContainText("적용 범위가 겹칩니다");
  await ruleDialog.getByLabel("시장").selectOption("한국");
  await ruleDialog.getByRole("button", { name: "규칙 저장" }).click();

  const copiedDelete = page.getByRole("button", { name: "KRW 기본 복사본 삭제" });
  await copiedDelete.click();
  let confirmation = page.getByRole("alertdialog", { name: "수수료 규칙을 삭제할까요?" });
  await confirmation.getByRole("button", { name: "취소" }).click();
  await expect(page.getByText("KRW 기본 복사본", { exact: true })).toBeVisible();
  await copiedDelete.click();
  confirmation = page.getByRole("alertdialog", { name: "수수료 규칙을 삭제할까요?" });
  await confirmation.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByText("KRW 기본 복사본", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "저장", exact: true }).click();
  const accountCard = page.locator("article").filter({ hasText: "수수료 계좌" });
  await expect(accountCard).toContainText("수수료 자동 계산 · 2개 규칙");

  await accountCard.getByRole("button", { name: "수정" }).click();
  await expect(page.getByText("미국 기본", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "미국 기본 수정" }).click();
  ruleDialog = page.getByRole("dialog", { name: "수수료 규칙 수정" });
  await expect(ruleDialog.getByLabel("시장")).toHaveValue("미국");
  await expect(ruleDialog.getByLabel("통화")).toHaveValue("USD");
  await expect(ruleDialog.getByLabel("수수료율 (%)")).toHaveValue("0.2");
  await ruleDialog.getByRole("button", { name: "취소" }).click();
  await page.getByRole("dialog", { name: "계좌 수정" }).getByRole("button", { name: "취소" }).click();

  const persisted = await page.evaluate(() => ({ account: JSON.parse(localStorage.getItem("tradejournal.accounts.v1") ?? "[]")[0], trade: JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]")[0] }));
  expect(persisted.account.feePolicy).toMatchObject({ version: 1, enabled: true, rules: [{ name: "KRW 기본", ratePercent: "0.15", fixedFee: "0", currency: "KRW" }, { name: "미국 기본", ratePercent: "0.2", currency: "USD", market: "미국", roundingUnit: "0.01" }] });
  expect(persisted.trade.fee).toBe(7);
});

test("새 매매 수수료를 계좌 정책으로 계산하고 직접 입력 전환의 출처를 보존한다", async ({ page }) => {
  const account = {
    ...e2eAccount("automatic-fee-account", "자동 수수료 계좌"),
    baseCurrency: "USD",
    feePolicy: {
      version: 1,
      enabled: true,
      rules: [{ id: "automatic-usd", name: "미국 자동", market: "미국", currency: "USD", side: "both", ratePercent: "0.1", fixedFee: "0.25", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2020-01-01", effectiveTo: null, roundingMode: "round", roundingUnit: "0.01" }],
    },
  };
  const stock = e2eStock("automatic-fee-stock", "자동 수수료 종목");
  await page.addInitScript(({ account, stock }) => {
    localStorage.setItem("tradejournal.accounts.v1", JSON.stringify([account]));
    localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([stock]));
    localStorage.setItem("tradejournal.trades.v1", "[]");
  }, { account, stock });

  await page.goto("/trades");
  await page.getByRole("button", { name: "원장 기록" }).click();
  let dialog = page.getByRole("dialog", { name: "새 원장 기록" });
  await dialog.getByRole("combobox", { name: "종목" }).fill(stock.ticker);
  await dialog.getByRole("option", { name: `${stock.ticker} · ${stock.name}` }).click();
  await dialog.getByLabel("계좌").selectOption(account.id);
  await dialog.getByLabel("수량").fill("10");
  await dialog.getByLabel("체결 가격").fill("100");
  await expect(dialog.getByRole("button", { name: "자동 계산" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("spinbutton", { name: "수수료", exact: true })).toHaveValue("1.25");
  await dialog.getByLabel("수량").fill("20");
  await expect(dialog.getByRole("spinbutton", { name: "수수료", exact: true })).toHaveValue("2.25");
  await dialog.getByLabel("세금").fill("4");
  await dialog.getByRole("button", { name: "기록 저장" }).click();

  const automatic = await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]")[0]);
  expect(automatic).toMatchObject({ fee: 2.25, tax: 4, feeMode: "accountPolicy", feeCalculation: { version: 1, policyAccountId: "automatic-fee-account", ruleId: "automatic-usd", quantity: "20", price: "100", grossAmount: "2000", calculatedFee: "2.25" } });

  const row = page.getByRole("row").filter({ hasText: "자동 수수료 종목" });
  await row.getByRole("button", { name: "기록 수정", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "기록 수정" });
  await expect(dialog.getByRole("spinbutton", { name: "수수료", exact: true })).toHaveValue("2.25");
  await dialog.getByRole("button", { name: "직접 입력" }).click();
  await dialog.getByRole("spinbutton", { name: "수수료", exact: true }).fill("7");
  await dialog.getByRole("button", { name: "변경 저장" }).click();

  const manual = await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]")[0]);
  expect(manual).toMatchObject({ fee: 7, tax: 4, feeMode: "manual", feeCalculation: null });
});

test("계좌 병합은 대상 정책을 유지하고 원본 정책과 기존 거래 수수료를 보존한다", async ({ page }) => {
  const rule = (id: string, ratePercent: string) => ({ version: 1, enabled: true, rules: [{ id, name: id, market: "all", currency: "KRW", side: "both", ratePercent, fixedFee: "0", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "floor", roundingUnit: "1" }] });
  const source = { ...e2eAccount("merge-source", "병합 원본"), feePolicy: rule("source-rule", "0.1") };
  const target = { ...e2eAccount("merge-target", "병합 대상", false), feePolicy: rule("target-rule", "0.2") };
  await page.addInitScript((accounts) => { if (localStorage.getItem("tradejournal.accounts.v1") === null) localStorage.setItem("tradejournal.accounts.v1", JSON.stringify(accounts)); if (localStorage.getItem("tradejournal.trades.v1") === null) localStorage.setItem("tradejournal.trades.v1", "[]"); if (localStorage.getItem("tradejournal.stocks.v1") === null) localStorage.setItem("tradejournal.stocks.v1", "[]"); }, [source, target]);
  await page.goto("/accounts");
  const sourceCard = page.locator("article").filter({ hasText: "병합 원본" });
  await sourceCard.getByRole("button", { name: "다른 계좌로 병합" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), sourceCard.getByLabel("병합 대상 계좌").selectOption("merge-target")]);
  const accounts = await page.evaluate(() => JSON.parse(localStorage.getItem("tradejournal.accounts.v1") ?? "[]"));
  expect(accounts.find((item: { id: string }) => item.id === "merge-source")).toMatchObject({ feePolicy: source.feePolicy, archivedAt: expect.any(String) });
  expect(accounts.find((item: { id: string }) => item.id === "merge-target")).toMatchObject({ feePolicy: target.feePolicy });
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
  await expect(dialog.getByRole("combobox", { name: "종목" })).toHaveValue("OPEN · 기존 보유 종목");
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
  await expect(dialog.getByRole("combobox", { name: "종목" })).toBeDisabled();
  await expect(dialog.getByRole("combobox", { name: "종목" })).toHaveValue("DETAIL · 상세 종목");
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
    id: "currency-stock", ticker: "NVDA", name: "엔비디아", market: "미국", currency: "KRW", assetType: "주식", marketSector: "information-technology", sector: "반도체",
    status: "보유", investmentType: "장기 코어", currentPrice: 223.96, targetPrice: 300, averagePrice: 188, quantity: 2,
    thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, reviewNote: "", nextEarningsDate: null,
    ledgerInitializedAt: "2026-08-09T00:00:00.000Z", tags: ["AI", "GPU"], createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z", deletedAt: null,
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
  expect(persisted.stock).toMatchObject({ currency: "USD", currentPrice: 223.96, averagePrice: 188, quantity: 2, marketSector: "information-technology", sector: "반도체", tags: ["AI", "GPU"] });
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

test("설정에서 전체 매매 원장을 soft-delete하고 최근 1회를 같은 ID로 되돌린다", async ({ page }) => {
  const timestamp = "2026-08-20T00:00:00.000Z";
  const accounts = [e2eAccount("reset-a1", "초기화 계좌", true), e2eAccount("reset-a2", "이체 계좌", false)];
  const stock = e2eStock("reset-stock", "초기화 종목", "Core", { ticker: "RST", status: "보유", currency: "USD", quantity: 0, averagePrice: 0, currentPrice: 150, ledgerInitializedAt: timestamp });
  const baseTrade = {
    stockId: stock.id, stockName: stock.name, planId: null, tradeType: "매수", tradedAt: "2026-08-20T09:00:00.000Z",
    quantity: 10, price: 100, currency: "USD", exchangeRate: 1300, fee: 0, tax: 0, accountId: accounts[0].id, accountName: accounts[0].name,
    memo: "synthetic", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 4, ruleViolations: [],
    journalStatus: "recorded", origin: { kind: "manual" }, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
  const cash = (id: string, tradeType: "입금" | "출금" | "배당", amount: number, overrides: Record<string, unknown> = {}) => ({ ...baseTrade, id, stockId: tradeType === "배당" ? stock.id : null, stockName: tradeType === "배당" ? stock.name : "", tradeType, quantity: 0, price: 0, amount, tradedAt: `2026-08-20T${id === "deposit" ? "08:00" : "12:00"}:00.000Z`, ...overrides });
  const transferCommon = { cashFlowKind: "transfer", transferId: "reset-transfer", tradedAt: "2026-08-20T14:00:00.000Z", amount: 200 };
  const trades = [
    cash("deposit", "입금", 2_000),
    { ...baseTrade, id: "buy" },
    { ...baseTrade, id: "sell", tradeType: "매도", quantity: 2, price: 120, tradedAt: "2026-08-20T10:00:00.000Z" },
    cash("dividend", "배당", 50, { tradedAt: "2026-08-20T11:00:00.000Z" }),
    cash("withdrawal", "출금", 100, { tradedAt: "2026-08-20T12:00:00.000Z" }),
    cash("reconciliation", "입금", 500, { cashFlowKind: "reconciliation", tradedAt: "2026-08-20T13:00:00.000Z" }),
    cash("transfer-out", "출금", 200, { ...transferCommon, accountId: accounts[0].id, accountName: accounts[0].name }),
    cash("transfer-in", "입금", 200, { ...transferCommon, accountId: accounts[1].id, accountName: accounts[1].name }),
    { ...baseTrade, id: "imported", quantity: 1, price: 110, tradedAt: "2026-08-20T15:00:00.000Z", journalStatus: "unreviewed", origin: { kind: "fileImport", sourceKey: "file:v2:reset", provider: "synthetic", externalExecutionId: "reset-exec", importBatchId: "batch-reset", importedAt: timestamp, sourceRow: 2, timePrecision: "second" } },
  ];
  const plan = { id: "reset-plan", stockId: stock.id, stockName: stock.name, ticker: stock.ticker, title: "보존 계획", scenarioType: "눌림목", conditionType: "가격 범위 진입", conditionDescription: "synthetic", targetPrice: 130, stopLossPrice: null, takeProfitPrice: null, priceRangeMin: 90, priceRangeMax: 100, plannedAmount: 1000, plannedQuantity: 10, plannedPortfolioPercent: 20, priority: 1, status: "관찰 중", invalidationCondition: "none", expectedHoldingPeriod: "long", memo: "keep", conditions: [], createdAt: timestamp, updatedAt: timestamp, executedAt: null, deletedAt: null };
  const observation = { id: "reset-observation", stockId: stock.id, stockName: stock.name, observedAt: timestamp, title: "보존 관찰", content: "keep", marketCondition: "synthetic", stockView: "중립", tags: [], attachmentUrls: [], createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
  const review = { id: "reset-review", stockId: stock.id, stockName: stock.name, tradeId: "buy", reviewedAt: "2026-08-20", result: "keep", decisionQuality: "keep", executionQuality: "keep", planCompliance: true, emotionState: "평온", strengths: "keep", mistakes: "none", nextAction: "keep", lessons: "keep", evaluation: "좋은 판단, 좋은 결과", resultScore: 4, processScore: 4, createdAt: timestamp, updatedAt: timestamp, deletedAt: null };
  await page.addInitScript((seed) => {
    for (const [collection, values] of Object.entries(seed)) {
      const storageKey = `tradejournal.${collection}.v1`;
      if (localStorage.getItem(storageKey) === null) localStorage.setItem(storageKey, JSON.stringify(values));
    }
  }, {
    accounts,
    stocks: [stock],
    trades,
    plans: [plan],
    observations: [observation],
    reviews: [review],
    "trade-ledger-reset-snapshots": [],
    "language-preferences": [{ id: "language", locale: "ko", updatedAt: "" }],
  });

  await page.goto("/settings");
  await expect(page.getByText("현재 활성 원장 기록: 9건")).toBeVisible();
  await page.getByRole("button", { name: "매매 기록 전체 삭제" }).click();
  const resetDialog = page.getByRole("alertdialog", { name: "매매 기록 9건을 모두 삭제할까요?" });
  await expect(resetDialog).toContainText("매수·매도");
  await expect(resetDialog).toContainText("종목");
  await expect(resetDialog).toContainText("계획과 회고는 삭제된 매매 기록을 참조하더라도 변경되지 않습니다.");
  await resetDialog.getByRole("checkbox", { name: "삭제 범위와 영향을 확인했습니다." }).check();
  await resetDialog.getByRole("button", { name: "매매 기록 9건 삭제" }).click();
  await expect(page.getByRole("status")).toContainText("매매 기록 9건을 삭제하고 원장을 초기화했습니다.");

  const afterReset = await page.evaluate(() => ({
    trades: JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]"),
    stocks: JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "[]"),
    accounts: JSON.parse(localStorage.getItem("tradejournal.accounts.v1") ?? "[]"),
    plans: JSON.parse(localStorage.getItem("tradejournal.plans.v1") ?? "[]"),
    observations: JSON.parse(localStorage.getItem("tradejournal.observations.v1") ?? "[]"),
    reviews: JSON.parse(localStorage.getItem("tradejournal.reviews.v1") ?? "[]"),
    snapshots: JSON.parse(localStorage.getItem("tradejournal.trade-ledger-reset-snapshots.v1") ?? "[]"),
  }));
  expect(new Set(afterReset.trades.map((item: { deletedAt: string }) => item.deletedAt)).size).toBe(1);
  expect(afterReset.trades.every((item: { deletedAt: string; updatedAt: string }) => item.deletedAt && item.deletedAt === item.updatedAt)).toBe(true);
  expect(afterReset.snapshots[0].tradeIds).toEqual(trades.map((item) => item.id));
  expect(afterReset.stocks).toEqual([stock]);
  expect(afterReset.accounts).toEqual(accounts);
  expect(afterReset.plans).toEqual([plan]);
  expect(afterReset.observations).toEqual([observation]);
  expect(afterReset.reviews).toEqual([review]);

  await page.reload();
  await page.goto("/trades");
  await expect(page.getByText("아직 원장 기록이 없습니다.")).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "열린 포지션" })).toContainText("0개");
  await expect(page.getByText("입출금 또는 매매 기록이 없습니다.")).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: "마지막 매매 기록 삭제 되돌리기" }).click();
  const undoDialog = page.getByRole("alertdialog", { name: "마지막 매매 기록 삭제를 되돌릴까요?" });
  await undoDialog.getByRole("button", { name: "기록 복원" }).click();
  await expect(page.getByRole("status")).toContainText("매매 기록 9건을 복원했습니다.");
  await page.reload();

  const afterUndo = await page.evaluate(() => ({
    trades: JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "[]"),
    snapshots: JSON.parse(localStorage.getItem("tradejournal.trade-ledger-reset-snapshots.v1") ?? "[]"),
  }));
  expect(afterUndo.trades.map((item: { id: string }) => item.id)).toEqual(trades.map((item) => item.id));
  expect(afterUndo.trades.every((item: { deletedAt: null }) => item.deletedAt === null)).toBe(true);
  expect(afterUndo.trades.map((item: { id: string; quantity: number; price: number; amount?: number }) => [item.id, item.quantity, item.price, item.amount]))
    .toEqual(trades.map((item) => [item.id, item.quantity, item.price, "amount" in item ? item.amount : undefined]));
  expect(afterUndo.snapshots).toEqual([]);

  await page.goto("/trades");
  await expect(page.locator("article").filter({ hasText: "열린 포지션" })).toContainText("1개");
  await expect(page.getByRole("row").filter({ hasText: "초기화 종목" })).toHaveCount(4);
});
