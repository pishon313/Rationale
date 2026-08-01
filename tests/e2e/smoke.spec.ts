import { expect, test } from "@playwright/test";

test("대시보드 앱 셸을 표시한다", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("오늘의 판단");
  await expect(page.getByRole("navigation", { name: "주요 메뉴" })).toBeVisible();
});

test("종목 목록에서 샘플 종목 상세로 이동한다", async ({ page }) => {
  await page.goto("/stocks");
  await expect(page.getByRole("heading", { name: "종목", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /삼성전자/ }).first().click();
  await expect(page.getByRole("heading", { name: "삼성전자" })).toBeVisible();
});

test("매수 계획의 테이블과 칸반 보기를 전환한다", async ({ page }) => {
  await page.goto("/plans");
  await expect(page.getByRole("heading", { name: "매수 계획" })).toBeVisible();
  await page.getByRole("button", { name: "칸반 보기" }).click();
  await expect(page.getByRole("heading", { name: "아이디어" })).toBeVisible();
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
