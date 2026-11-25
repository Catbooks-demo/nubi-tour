import type { Booking, Cancellation, Departure, Inquiry, Payment, Product, Region, Traveler } from "@prisma/client";

// ── 개인정보 가리기 (read 범위) ──
export function maskKo(name: string): string {
  if (name.length <= 1) return "*";
  if (name.length === 2) return `${name[0]}*`;
  return `${name[0]}${"*".repeat(name.length - 2)}${name.at(-1)}`;
}
export const maskEn = (name: string) =>
  name
    .split(" ")
    .map((w) => (w ? `${w[0]}${"*".repeat(Math.max(0, w.length - 1))}` : w))
    .join(" ");
export function maskPhone(p: string): string {
  const d = p.replace(/[^0-9]/g, "");
  return d.length >= 10 ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : "***";
}
export function maskEmail(e: string): string {
  const [u, dom] = e.split("@");
  return dom ? `${u[0] ?? ""}***@${dom}` : "***";
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export function tourV1(p: Product & { region: Region }) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    region: p.region.code,
    country: p.country,
    cities: p.cities,
    nights: p.nights,
    days: p.days,
    airline: p.airline,
    departure_airport: p.departure_airport,
    shopping_count: p.shopping_count,
    base_price: p.base_price,
    on_sale: p.on_sale,
    created_at: iso(p.created_at),
    updated_at: iso(p.updated_at),
  };
}

export function departureV1(d: Departure & { product?: Product }) {
  return {
    id: d.id,
    product_code: d.product?.code ?? null,
    depart_date: d.depart_date,
    return_date: d.return_date,
    capacity: d.capacity,
    seats_taken: d.seats_taken,
    seats_left: Math.max(0, d.capacity - d.seats_taken),
    min_pax: d.min_pax,
    price_adult: d.price_adult,
    price_child: d.price_child,
    price_infant: d.price_infant,
    single_supplement: d.single_supplement,
    deposit_per_person: d.deposit_per_person,
    status: d.status,
    updated_at: iso(d.updated_at),
  };
}

type RefundRow = Pick<Payment, "amount" | "status" | "kind" | "approved_at" | "created_at">;
type BookingRow = Booking & {
  departure: Departure & { product: Product };
  travelers: Traveler[];
  payments?: RefundRow[];
};

/** 승인된 환불의 합과 마지막 환불 시각. 결제 목록을 읽지 않은 응답이면 0·null (11/25 AXcellent 매출 분석). */
export function refundSummary(payments: RefundRow[] | undefined): { amount: number; at: string | null } {
  const done = (payments ?? []).filter((p) => p.kind === "refund" && p.status === "approved");
  if (done.length === 0) return { amount: 0, at: null };
  const last = done.map((p) => p.approved_at ?? p.created_at).reduce((a, b) => (b > a ? b : a));
  return { amount: done.reduce((n, p) => n + p.amount, 0), at: iso(last) };
}

/** 예약 읽기에 같이 싣는 결제(승인된 환불만). 두 예약 읽기 경로가 같은 include를 쓴다 */
export const BOOKING_REFUNDS = {
  where: { kind: "refund", status: "approved" },
  select: { amount: true, status: true, kind: true, approved_at: true, created_at: true },
} as const;

export function bookingV1(b: BookingRow, pii: boolean) {
  return {
    id: b.id,
    code: b.code,
    status: b.status,
    product_code: b.departure.product.code,
    departure_id: b.departure_id,
    depart_date: b.departure.depart_date,
    member: !!b.user_id,
    member_id: b.user_id,
    contact: pii
      ? { name: b.contact_name, phone: b.contact_phone, email: b.contact_email }
      : { name: maskKo(b.contact_name), phone: maskPhone(b.contact_phone), email: maskEmail(b.contact_email) },
    adults: b.adults,
    children: b.children,
    infants: b.infants,
    single_rooms: b.single_rooms,
    total_amount: b.total_amount,
    first_payment_amount: b.deposit_amount,
    paid_amount: b.paid_amount,
    // 환불하면 paid_amount가 줄어든다. 환불액·시각을 따로 실어 받는 쪽이 매출에서 기간 안 환불로 뺄 수 있게
    refunded_amount: refundSummary(b.payments).amount,
    refunded_at: refundSummary(b.payments).at,
    pay_mode: b.pay_mode,
    pay_deadline: iso(b.pay_deadline),
    balance_deadline: iso(b.balance_deadline),
    staff_memo: b.staff_memo,
    travelers: b.travelers.map((t) => ({
      type: t.type,
      name_ko: pii ? t.name_ko : maskKo(t.name_ko),
      name_en: pii ? t.name_en : maskEn(t.name_en),
      gender: t.gender,
      birth_date: pii ? t.birth_date : t.birth_date.slice(0, 4),
    })),
    created_at: iso(b.created_at),
    updated_at: iso(b.updated_at),
  };
}

export function paymentV1(p: Payment & { booking: Booking }) {
  return {
    id: p.id,
    booking_code: p.booking.code,
    kind: p.kind,
    method: p.method,
    amount: p.amount,
    status: p.status,
    refund_of: p.refund_of_id,
    approved_at: iso(p.approved_at),
    created_at: iso(p.created_at),
    updated_at: iso(p.updated_at),
  };
}

export function cancellationV1(c: Cancellation & { booking: Booking }) {
  return {
    id: c.id,
    booking_code: c.booking.code,
    requested_by: c.requested_by,
    reason: c.reason,
    days_before: c.days_before,
    fee_rate: c.fee_rate,
    fee: c.fee,
    paid: c.paid,
    refund: c.refund,
    status: c.status,
    decided_at: iso(c.decided_at),
    created_at: iso(c.created_at),
    updated_at: iso(c.updated_at),
  };
}

export function inquiryV1(q: Inquiry & { booking: Booking | null }, pii: boolean) {
  return {
    id: q.id,
    booking_code: q.booking?.code ?? null,
    member: !!q.user_id,
    name: pii ? q.name : maskKo(q.name),
    email: pii ? q.email : maskEmail(q.email),
    category: q.category,
    title: q.title,
    body: q.body,
    status: q.status,
    answer: q.answer,
    answered_at: iso(q.answered_at),
    created_at: iso(q.created_at),
    updated_at: iso(q.updated_at),
  };
}
