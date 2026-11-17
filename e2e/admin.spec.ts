import { expect, test } from "@playwright/test";

const EMAIL = process.env.SEED_STAFF_EMAIL ?? "admin@nubi.test";
const PASSWORD = process.env.SEED_STAFF_PASSWORD ?? "e2e-admin-pass";

test("직원: 로그인 → 대시보드 → 출발일 마감·다시 열기 → API 키 발급", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.locator("#s-email").fill(EMAIL);
  await page.locator("#s-pw").fill(PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await expect(page.getByRole("heading", { name: "대시보드" })).toBeVisible();
  await page.screenshot({ path: "screens/10-admin-dashboard.png", fullPage: true });

  await page.goto("/admin/tours/NB-EU-SWI-08");
  await page.getByRole("button", { name: "마감" }).first().click();
  await expect(page.getByRole("status")).toContainText("예약을 마감했어요");
  await page.getByRole("button", { name: "다시 열기" }).first().click();
  await expect(page.getByRole("status")).toContainText("예약을 다시 열었어요");
  await page.screenshot({ path: "screens/11-admin-tour.png", fullPage: true });

  await page.goto("/admin/api-keys");
  await page.getByPlaceholder("어디에 쓰는 키인가요").fill("e2e 정산");
  await page.getByRole("button", { name: "키 만들기" }).click();
  const key = await page.locator("code").textContent();
  expect(key).toMatch(/^nbk_/);
  await page.screenshot({ path: "screens/12-admin-keys.png", fullPage: true });

  // 만든 키로 외부 API 읽기
  const res = await page.request.get("/api/v1/tours?limit=5", { headers: { authorization: `Bearer ${key}` } });
  expect(res.status()).toBe(200);
  expect((await res.json()).data).toHaveLength(5);

  await page.goto("/admin/bookings");
  await page.screenshot({ path: "screens/13-admin-bookings.png", fullPage: true });
});

test("직원 쿠키 없이 운영 화면·API에 들어갈 수 없다", async ({ page, request }) => {
  await page.goto("/admin/bookings");
  await expect(page).toHaveURL(/\/admin\/login/);
  expect((await request.get("/api/admin/auth/me")).status()).toBe(401);
  expect((await request.get("/api/v1/bookings")).status()).toBe(401);
});
