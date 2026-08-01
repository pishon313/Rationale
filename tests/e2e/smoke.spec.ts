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
