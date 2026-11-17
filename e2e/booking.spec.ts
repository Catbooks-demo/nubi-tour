import { expect, test } from "@playwright/test";

/** 비회원이 상품을 고르고 예약 → 모의 결제 → 비회원 조회까지. 토스 키 없이(모의 결제) 돈다. */
test("비회원 예약과 예약금 모의 결제, 비회원 조회", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /일정은 저희가 꿰어 둘게요/ })).toBeVisible();

  await page.goto("/tours?region=japan");
  await page.getByRole("link", { name: /오사카·교토·나라 4일/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /오사카·교토·나라/ })).toBeVisible();

  await page.getByRole("link", { name: "이 날짜로 예약하기" }).click();
  await expect(page.getByRole("heading", { name: "예약하기" })).toBeVisible();

  await page.locator("#c-name").fill("김누비");
  await page.locator("#c-phone").fill("010-2345-6789");
  await page.locator("#c-email").fill("nubi.e2e@example.com");
  const people = [
    { ko: "김누비", en: "KIM NUBI", g: "F", b: "1990-05-01" },
    { ko: "이여행", en: "LEE YEOHAENG", g: "M", b: "1988-09-12" },
  ];
  for (const [i, p] of people.entries()) {
    await page.locator(`#t${i}-ko`).fill(p.ko);
    await page.locator(`#t${i}-en`).fill(p.en);
    await page.locator(`#t${i}-g`).selectOption(p.g);
    await page.locator(`#t${i}-b`).fill(p.b);
  }
  await page.locator("#pin").fill("4321");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "예약하기" }).click();

  await expect(page.getByText("예약이 접수됐어요")).toBeVisible();
  const code = (await page.locator("text=/NB\\d{10}/").first().textContent())?.match(/NB\d{10}/)?.[0];
  expect(code).toBeTruthy();

  const pay = page.getByRole("button", { name: /모의 결제하기/ });
  await expect(pay).toBeVisible();
  await pay.click();
  await expect(page.locator('[aria-current="step"]')).toHaveText("예약금 완료");

  // 다른 브라우저(쿠키 없음)에서 비회원 조회
  await page.context().clearCookies();
  await page.goto("/lookup");
  await page.locator("#code").fill(code!);
  await page.locator("#phone").fill("01023456789");
  await page.locator("#pin").fill("4321");
  await page.getByRole("button", { name: "예약 조회" }).click();
  await expect(page.locator('[aria-current="step"]')).toHaveText("예약금 완료");
  await expect(page.getByRole("heading", { name: /잔금 .*남았어요/ })).toBeVisible();
});

test("남은 좌석보다 많이 고르면 예약 버튼이 막힌다", async ({ page }) => {
  await page.goto("/tours/NB-FJ-NAN-07");
  await page.getByRole("link", { name: "이 날짜로 예약하기" }).click();
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "성인 늘리기" }).click();
  await expect(page.getByRole("alert")).toContainText("명까지 예약할 수 있어요");
  await expect(page.getByRole("button", { name: "예약하기" })).toBeDisabled();
});
