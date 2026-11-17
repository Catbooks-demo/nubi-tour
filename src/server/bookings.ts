import type { Booking, Prisma } from "@prisma/client";
import { z } from "zod";
import { cancellationFee, refundAmount } from "@/rules/cancellation";
import { quote, travelerType, validBirthDate, validatePax } from "@/rules/pricing";
import { paymentPlan } from "@/rules/schedule";
import { type BookingStatus, canTransition } from "@/rules/status";
import { daysBefore, kstDate } from "@/rules/time";
import { hashPassword, verifyPassword } from "./auth/password";
import { phoneSchema } from "./auth/users";
import { nextBookingCode } from "./codes";
import { db } from "./db";
import { lockDeparture, refreshDepartureStatus } from "./departures";
import { HttpError } from "./http";
import { recordMessage, won } from "./messages";
import type { Tx } from "./tx";

// ── 입력 ──
export const travelerSchema = z.object({
  name_ko: z.string().trim().min(1, "여행자 한글 이름을 넣어 주세요.").max(30),
  name_en: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase().replace(/\s+/g, " "))
    .refine((s) => /^[A-Z][A-Z ]{1,49}$/.test(s), "여권 영문 이름은 영문 대문자로 넣어 주세요."),
  gender: z.enum(["F", "M"], { message: "성별을 골라 주세요." }),
  birth_date: z.string(),
  passport_last4: z.string().regex(/^[0-9A-Z]{4}$/).optional(),
});
export type TravelerInput = z.infer<typeof travelerSchema>;

export const createBookingSchema = z.object({
  departure_id: z.string().min(1),
  pax: z.object({
    adults: z.number().int(),
    children: z.number().int().default(0),
    infants: z.number().int().default(0),
    single_rooms: z.number().int().default(0),
  }),
  contact: z.object({
    name: z.string().trim().min(1, "예약자 이름을 넣어 주세요.").max(30),
    phone: phoneSchema,
    email: z.string().trim().toLowerCase().email("예약자 이메일을 확인해 주세요."),
  }),
  travelers: z.array(travelerSchema).min(1).max(9),
  guest_pin: z.string().regex(/^[0-9]{4,6}$/, "조회 비밀번호는 숫자 4~6자리예요.").optional(),
  agree_terms: z.literal(true, { message: "여행약관과 취소 규정에 동의해 주세요." }),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

const notFound = () => new HttpError(404, "NOT_FOUND", "예약을 찾지 못했어요.");

// ── 예약 만들기 ──
export async function createBooking(
  input: Omit<CreateBookingInput, "agree_terms"> & { userId?: string | null },
  now: Date = new Date(),
): Promise<Booking> {
  if (!input.userId && !input.guest_pin) {
    throw new HttpError(400, "PIN_REQUIRED", "비회원 예약은 조회 비밀번호(숫자 4~6자리)가 필요해요.");
  }
  const paxErr = validatePax(input.pax);
  if (paxErr) throw new HttpError(400, "BAD_PAX", paxErr);
  const pinHash = input.userId ? null : await hashPassword(input.guest_pin as string);

  return db.$transaction(async (tx) => {
    await lockDeparture(tx, input.departure_id);
    const dep = await tx.departure.findUnique({ where: { id: input.departure_id }, include: { product: true } });
    if (!dep || !dep.product.on_sale) throw new HttpError(404, "NOT_FOUND", "상품을 찾지 못했어요.");
    if (dep.status === "cancelled" || dep.status === "departed" || dep.manual_closed) {
      throw new HttpError(409, "CLOSED", dep.manual_closed ? "예약이 마감된 출발일이에요." : "예약할 수 없는 출발일이에요.");
    }

    checkTravelers(input.travelers, input.pax, dep.depart_date, kstDate(now));

    const q = quote(dep, input.pax);
    const plan = paymentPlan(dep.depart_date, now, q.total, q.seats, dep.deposit_per_person);
    if (plan.mode === "closed") {
      throw new HttpError(409, "CLOSED", "출발 2일 이내 상품은 온라인으로 예약할 수 없어요. 전화로 문의해 주세요.");
    }
    if (dep.capacity - dep.seats_taken < q.seats) {
      throw new HttpError(409, "SOLD_OUT", `남은 좌석이 ${Math.max(0, dep.capacity - dep.seats_taken)}석이에요.`);
    }

    await tx.departure.update({ where: { id: dep.id }, data: { seats_taken: { increment: q.seats } } });
    const code = await nextBookingCode(tx, now);
    const status: BookingStatus = plan.mode === "deposit" ? "pending_deposit" : "pending_full";
    const booking = await tx.booking.create({
      data: {
        code,
        user_id: input.userId ?? null,
        guest_pin_hash: pinHash,
        departure_id: dep.id,
        contact_name: input.contact.name,
        contact_phone: input.contact.phone,
        contact_email: input.contact.email,
        adults: input.pax.adults,
        children: input.pax.children,
        infants: input.pax.infants,
        single_rooms: input.pax.single_rooms,
        total_amount: q.total,
        deposit_amount: plan.firstAmount,
        pay_mode: plan.mode,
        pay_deadline: plan.payDeadline,
        balance_deadline: plan.balanceDeadline,
        status,
        travelers: {
          create: input.travelers.map((t) => ({
            type: travelerType(t.birth_date, dep.depart_date),
            name_ko: t.name_ko,
            name_en: t.name_en,
            gender: t.gender,
            birth_date: t.birth_date,
            passport_last4: t.passport_last4 ?? null,
          })),
        },
      },
    });
    await refreshDepartureStatus(tx, dep.id);
    await recordMessage(
      tx,
      booking,
      "booking_received",
      "예약 접수",
      `${dep.product.name} ${dep.depart_date} 출발 예약이 접수됐어요. ${plan.mode === "deposit" ? "예약금" : "여행 요금"} ${won(plan.firstAmount)}을 24시간 안에 결제해 주세요.`,
    );
    return booking;
  });
}

function checkTravelers(
  travelers: TravelerInput[],
  pax: { adults: number; children: number; infants: number },
  departDate: string,
  today: string,
): void {
  if (travelers.length !== pax.adults + pax.children + pax.infants) {
    throw new HttpError(400, "BAD_TRAVELERS", "여행자 정보를 인원 수만큼 넣어 주세요.");
  }
  const count = { adult: 0, child: 0, infant: 0 };
  for (const t of travelers) {
    if (!validBirthDate(t.birth_date, today)) {
      throw new HttpError(400, "BAD_TRAVELERS", `${t.name_ko} 님의 생년월일을 확인해 주세요.`);
    }
    count[travelerType(t.birth_date, departDate)]++;
  }
  if (count.adult !== pax.adults || count.child !== pax.children || count.infant !== pax.infants) {
    throw new HttpError(
      400,
      "BAD_TRAVELERS",
      "여행자 생년월일로 본 성인·아동·유아 수가 고른 인원과 달라요. (출발일 기준 만 12세 미만 아동, 만 2세 미만 유아)",
    );
  }
}

// ── 좌석 돌려놓기 ──
/** 좌석을 돌려놓는다. 이미 돌려놓은 예약이면 아무것도 안 한다(두 번 불러도 안전). */
export async function releaseSeats(tx: Tx, booking: Pick<Booking, "id" | "departure_id" | "adults" | "children">, now = new Date()): Promise<boolean> {
  const marked = await tx.booking.updateMany({
    where: { id: booking.id, seats_released_at: null },
    data: { seats_released_at: now },
  });
  if (marked.count === 0) return false;
  await tx.departure.update({
    where: { id: booking.departure_id },
    data: { seats_taken: { decrement: booking.adults + booking.children } },
  });
  await refreshDepartureStatus(tx, booking.departure_id);
  return true;
}

/** 예약 행 잠금. */
export async function lockBooking(tx: Tx, code: string): Promise<Booking> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM bookings WHERE code = ${code} FOR UPDATE`;
  if (!rows.length) throw notFound();
  return tx.booking.findUniqueOrThrow({ where: { id: rows[0].id } });
}

/** 상태 바꾸기. 읽은 뒤 다른 곳이 이미 상태를 바꿨으면 덮어쓰지 않고 409. */
export async function setStatus(tx: Tx, b: Booking, to: BookingStatus, extra: Prisma.BookingUpdateManyMutationInput = {}): Promise<Booking> {
  if (!canTransition(b.status as BookingStatus, to)) {
    throw new HttpError(409, "BAD_STATE", "지금 상태에서는 할 수 없어요.");
  }
  const changed = await tx.booking.updateMany({ where: { id: b.id, status: b.status }, data: { status: to, ...extra } });
  if (!changed.count) throw new HttpError(409, "BAD_STATE", "예약 상태가 방금 바뀌었어요. 새로고침해 주세요.");
  return tx.booking.findUniqueOrThrow({ where: { id: b.id } });
}

// ── 취소 ──
export interface CancelPreview {
  daysBefore: number;
  rate: number;
  fee: number;
  paid: number;
  refund: number;
}

export async function previewCancel(code: string, now = new Date()): Promise<CancelPreview> {
  const b = await db.booking.findUnique({ where: { code }, include: { departure: true } });
  if (!b) throw notFound();
  return calcCancel(b.total_amount, b.paid_amount, b.departure.depart_date, now);
}

export function calcCancel(total: number, paid: number, departDate: string, now: Date): CancelPreview {
  const d = daysBefore(departDate, now);
  const { rate, fee } = cancellationFee(total, d);
  return { daysBefore: d, rate, fee, paid, refund: refundAmount(paid, fee) };
}

export type Actor = { kind: "customer" | "guest" | "staff" | "system"; id?: string };

/**
 * 취소 신청.
 * - 결제 전(pending_*) 예약은 바로 취소, 좌석 반환.
 * - 결제한 예약은 취소 요청(직원 승인 뒤 환불). 수수료는 신청 시각 기준으로 미리 계산해 둔다.
 */
export async function requestCancel(code: string, actor: Actor, reason: string, now = new Date()): Promise<Booking> {
  return db.$transaction(async (tx) => {
    const b = await lockBooking(tx, code);
    const dep = await tx.departure.findUniqueOrThrow({ where: { id: b.departure_id } });
    if (b.status === "pending_deposit" || b.status === "pending_full") {
      const updated = await setStatus(tx, b, "cancelled");
      await tx.cancellation.create({
        data: {
          booking_id: b.id, requested_by: actor.kind, reason, days_before: daysBefore(dep.depart_date, now),
          fee_rate: 0, fee: 0, paid: 0, refund: 0, status: "done", decided_by: actor.id ?? actor.kind, decided_at: now,
        },
      });
      await releaseSeats(tx, b, now);
      await recordMessage(tx, b, "cancelled", "예약 취소", "결제 전 예약이 취소됐어요.");
      return updated;
    }
    if (b.status !== "deposit_paid" && b.status !== "fully_paid") {
      throw new HttpError(409, "BAD_STATE", "지금 상태에서는 취소를 신청할 수 없어요.");
    }
    const p = calcCancel(b.total_amount, b.paid_amount, dep.depart_date, now);
    const updated = await setStatus(tx, b, "cancel_requested", { status_before_cancel: b.status });
    await tx.cancellation.create({
      data: {
        booking_id: b.id, requested_by: actor.kind, reason, days_before: p.daysBefore,
        fee_rate: p.rate, fee: p.fee, paid: p.paid, refund: p.refund, status: "requested",
      },
    });
    await recordMessage(
      tx, b, "cancel_requested", "취소 신청 접수",
      `취소 신청이 접수됐어요. 예상 수수료 ${won(p.fee)}, 예상 환불액 ${won(p.refund)}이에요. 담당자가 확인 후 처리해 드려요.`,
    );
    return updated;
  });
}

// ── 조회 ──
export async function findBookingForGuest(code: string, phone: string, pin: string): Promise<Booking | null> {
  const b = await db.booking.findUnique({ where: { code: code.trim().toUpperCase() } });
  if (!b || b.user_id || !b.guest_pin_hash) return null;
  if (b.contact_phone !== phone.replace(/[^0-9]/g, "")) return null;
  return (await verifyPassword(pin, b.guest_pin_hash)) ? b : null;
}

export const bookingInclude = {
  departure: { include: { product: { include: { region: true } } } },
  travelers: { orderBy: { created_at: "asc" } },
  payments: { orderBy: { created_at: "asc" } },
  cancellations: { orderBy: { created_at: "asc" } },
} satisfies Prisma.BookingInclude;

export type BookingFull = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export async function getBookingFull(code: string): Promise<BookingFull | null> {
  return db.booking.findUnique({ where: { code }, include: bookingInclude });
}

/** 손님 화면용 예약 모양 (내부 값·비밀값 제외). */
export function bookingView(b: BookingFull) {
  return {
    code: b.code,
    status: b.status,
    product: { code: b.departure.product.code, name: b.departure.product.name },
    departure: { id: b.departure.id, depart_date: b.departure.depart_date, return_date: b.departure.return_date, status: b.departure.status },
    contact: { name: b.contact_name, phone: b.contact_phone, email: b.contact_email },
    pax: { adults: b.adults, children: b.children, infants: b.infants, single_rooms: b.single_rooms },
    total_amount: b.total_amount,
    deposit_amount: b.deposit_amount,
    paid_amount: b.paid_amount,
    balance: b.total_amount - b.paid_amount,
    pay_mode: b.pay_mode,
    pay_deadline: b.pay_deadline.toISOString(),
    balance_deadline: b.balance_deadline?.toISOString() ?? null,
    is_guest: !b.user_id,
    travelers: b.travelers.map((t) => ({
      type: t.type, name_ko: t.name_ko, name_en: t.name_en, gender: t.gender, birth_date: t.birth_date,
    })),
    payments: b.payments
      .filter((p) => p.status === "approved")
      .map((p) => ({ kind: p.kind, method: p.method, amount: p.amount, approved_at: p.approved_at?.toISOString() ?? null })),
    cancellation: (() => {
      const c = b.cancellations.at(-1);
      return c ? { status: c.status, fee: c.fee, refund: c.refund, reason: c.reason, decide_note: c.decide_note } : null;
    })(),
    created_at: b.created_at.toISOString(),
  };
}

export type BookingView = ReturnType<typeof bookingView>;
