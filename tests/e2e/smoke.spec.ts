import { expect, test } from "@playwright/test";

test("대시보드 앱 셸을 표시한다", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("오늘의 판단");
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();
});

test("지원하는 여섯 언어를 즉시 전환하고 저장한다", async ({ page }) => {
  await page.goto("/settings");
  const language = page.locator('select:has(option[value="ko"])');
  const headings = {
    ko: "설정",
    ja: "設定",
    en: "Settings",
    fr: "Paramètres",
    it: "Impostazioni",
    es: "Configuración",
  } as const;

  for (const [locale, heading] of Object.entries(headings)) {
    await language.selectOption(locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  }

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(language).toHaveValue("es");

  await language.selectOption("ko");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
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
  await expect(page.getByRole("heading", { name: "테스트 종목" })).toBeVisible();
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
  await page.goto("/trades");
  await page.getByRole("button", { name: "원장 기록" }).click();
  await page.getByRole("button", { name: "입금", exact: true }).click();
  await page.getByLabel("입금 금액").fill("100000");
  await page.getByLabel("계좌").fill("E2E 계좌");
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
  await page.goto("/trades");
  await page.getByRole("button", { name: "계좌 등록·잔액 조정" }).click();
  await page.getByLabel("계좌", { exact: true }).fill("장기 계좌");
  await page.getByLabel("실제 현금 잔액").fill("250000");
  await page.getByRole("button", { name: "저장", exact: true }).click();
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

test("계좌 이름을 기존 계좌로 병합한다", async ({ page }) => {
  const base = (id: string, accountName: string, amount: number) => ({
    id, stockId: null, stockName: "", planId: null, tradeType: "입금", tradedAt: `2025-01-0${id === "a" ? "1" : "2"}T09:00:00+09:00`,
    quantity: 0, price: 0, amount, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountName,
    memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 5, ruleViolations: [],
    createdAt: "2025-01-01T09:00:00+09:00", updatedAt: "2025-01-01T09:00:00+09:00", deletedAt: null,
  });
  await page.addInitScript((records) => localStorage.setItem("tradejournal.trades.v1", JSON.stringify(records)), [base("a", "연금", 100000), base("b", "일반", 200000)]);
  await page.goto("/trades");
  await page.getByRole("button", { name: "계좌 관리" }).click();
  await page.getByLabel("변경할 계좌").selectOption("연금");
  await page.getByLabel("새 계좌명 또는 병합할 계좌명").fill("일반");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "변경", exact: true }).click();
  await expect(page.getByText("계좌를 병합하고 전체 원장을 다시 계산했습니다.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "일반" })).toHaveCount(2);
  await expect(page.getByRole("row").filter({ hasText: "연금" })).toHaveCount(0);
});
