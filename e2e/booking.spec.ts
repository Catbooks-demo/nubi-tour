import { expect, type Page, test } from "@playwright/test";

const shot = (page: Page, name: string) => page.screenshot({ path: `screens/${name}.png`, fullPage: true });

/** 한국 날짜 기준 n일 뒤 (YYYY-MM-DD). */
function kstPlus(n: number): string {
  const d = new Date(Date.now() + 9 * 3_600_000 + n * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** 상품 상세 달력에서 from 이후 첫 예약 가능 날짜를 고른다. */
async function pickDateFrom(page: Page, from: string) {
  for (const tab of await page.getByRole("tab").all()) {
    await tab.click();
    const dates = await page.locator('[data-bookable="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-date") ?? ""));
    const hit = dates.find((d) => d >= from);
    if (hit) {
      await page.locator(`[data-date="${hit}"]`).click();
      return hit;
    }
  }
  throw new Error(`${from} 이후 예약 가능한 날짜가 없어요`);
}

async function fillBooking(page: Page, pin: string) {
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
  await page.locator("#pin").fill(pin);
  for (const box of await page.getByRole("checkbox").all()) await box.check();
}

const step = (page: Page) => page.locator('[aria-current="step"]');

test("비회원 예약 → 예약금 → 비회원 조회 → 잔금", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /일정은 저희가 꿰어 둘게요/ })).toBeVisible();
  await shot(page, "01-home");

  await page.goto("/tours?region=japan");
  await shot(page, "02-list");
  await page.getByRole("link", { name: /오사카·교토·나라 4일/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /오사카·교토·나라/ })).toBeVisible();

  await pickDateFrom(page, kstPlus(12)); // 8일 이상 남은 날 → 예약금
  await shot(page, "03-detail");
  await page.getByRole("link", { name: "이 날짜로 예약하기" }).click();
  await expect(page.getByRole("heading", { name: "예약하기" })).toBeVisible();
  await fillBooking(page, "4321");
  await shot(page, "04-book");
  await page.getByRole("button", { name: "예약하기", exact: true }).click();

  await expect(page.getByText("예약이 접수됐어요")).toBeVisible();
  const code = (await page.locator("text=/NB\\d{10}/").first().textContent())?.match(/NB\d{10}/)?.[0];
  expect(code).toBeTruthy();
  await expect(step(page)).toHaveText("예약 접수");
  await page.getByRole("button", { name: /예약금 .*모의 결제하기/ }).click();
  await expect(step(page)).toHaveText("예약금 완료");
  await shot(page, "05-booking");

  // 쿠키 없이 비회원 조회
  await page.context().clearCookies();
  await page.goto("/lookup");
  await page.locator("#code").fill(code!);
  await page.locator("#phone").fill("01023456789");
  await page.locator("#pin").fill("4321");
  await page.getByRole("button", { name: "예약 조회" }).click();
  await expect(step(page)).toHaveText("예약금 완료");
  await expect(page.getByRole("heading", { name: /잔금 .*남았어요/ })).toBeVisible();
  await page.getByRole("button", { name: /잔금 .*모의 결제하기/ }).click();
  await expect(step(page)).toHaveText("결제 완료");
});

test("출발이 7일 이내면 전액을 한 번에 결제한다", async ({ page }) => {
  await page.goto("/tours/NB-JP-FUK-03");
  await pickDateFrom(page, kstPlus(3));
  const date = await page.locator('[aria-pressed="true"]').getAttribute("data-date");
  test.skip(!date || date > kstPlus(7), "7일 이내 출발일이 없는 날");
  await page.getByRole("link", { name: "이 날짜로 예약하기" }).click();
  await expect(page.getByText(/출발이 7일 이내라 지금 전액/)).toBeVisible();
  await fillBooking(page, "9876");
  await page.getByRole("button", { name: "예약하기", exact: true }).click();
  await page.getByRole("button", { name: /여행 요금 .*모의 결제하기/ }).click();
  await expect(step(page)).toHaveText("결제 완료");
});

test("한 번에 9명을 넘게 고르면 예약 버튼이 막힌다", async ({ page }) => {
  await page.goto("/tours/NB-FJ-NAN-07");
  await page.getByRole("link", { name: "이 날짜로 예약하기" }).click();
  for (let i = 0; i < 8; i++) await page.getByRole("button", { name: "성인 늘리기" }).click();
  await expect(page.locator("p[role=alert]")).toHaveText("한 번에 9명까지 예약할 수 있어요.");
  await expect(page.getByRole("button", { name: "예약하기", exact: true })).toBeDisabled();
});
