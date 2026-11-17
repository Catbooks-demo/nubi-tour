"use server";

import type { Staff } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addDays, kstDate } from "@/rules/time";
import { approveCancel, rejectCancel, retryRefund } from "@/server/admin";
import { NEW_KEY_COOKIE, type Scope, issueApiKey, revokeApiKey } from "@/server/apikeys";
import { audit } from "@/server/audit";
import { currentStaff } from "@/server/auth/current";
import { hashPassword } from "@/server/auth/password";
import { requestCancel } from "@/server/bookings";
import { db } from "@/server/db";
import { HttpError } from "@/server/http";
import { answerInquiry } from "@/server/inquiries";
import { cancelDeparture } from "@/server/jobs";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => {
  const v = s(f, k).replace(/[^0-9-]/g, "");
  return v === "" ? undefined : Number(v);
};

async function who(role?: "admin"): Promise<Staff> {
  const st = await currentStaff();
  if (!st) redirect("/admin/login");
  if (role === "admin" && st.role !== "admin") throw new HttpError(403, "ADMIN_ONLY", "관리자만 할 수 있어요.");
  return st;
}

/** 처리하고 같은 화면으로 돌아간다. 손님에게 보일 오류는 화면 위에 띄운다. */
async function run(back: string, fn: () => Promise<string | void>): Promise<never> {
  let msg: string | void;
  try {
    msg = await fn();
  } catch (e) {
    if (e instanceof HttpError) redirect(`${back}?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath(back);
  redirect(`${back}?ok=${encodeURIComponent(msg || "처리했어요.")}`);
}

const backOf = (f: FormData, fallback: string) => {
  const b = s(f, "back");
  return b.startsWith("/admin") ? b : fallback;
};

// ── 예약·취소 ──
export async function approveCancelAction(f: FormData) {
  const st = await who();
  const code = s(f, "code");
  await run(`/admin/bookings/${code}`, async () => {
    const r = await approveCancel(code, st.id, { fee: n(f, "fee"), reason: s(f, "reason") || undefined });
    return `취소를 승인하고 ${r.refund.toLocaleString("ko-KR")}원을 환불했어요.`;
  });
}

export async function rejectCancelAction(f: FormData) {
  const st = await who();
  const code = s(f, "code");
  await run(`/admin/bookings/${code}`, async () => {
    await rejectCancel(code, st.id, s(f, "reason"));
    return "취소 요청을 거절했어요.";
  });
}

export async function staffCancelAction(f: FormData) {
  const st = await who();
  const code = s(f, "code");
  await run(`/admin/bookings/${code}`, async () => {
    const reason = s(f, "reason");
    if (!reason) throw new HttpError(400, "REASON_REQUIRED", "취소 사유를 적어 주세요.");
    const b = await requestCancel(code, { kind: "staff", id: st.id }, `[직원 접수] ${reason}`);
    await audit(`staff:${st.id}`, "booking.cancel_request", code, { reason });
    return b.status === "cancelled" ? "결제 전 예약이라 바로 취소했어요." : "취소 요청을 접수했어요. 아래에서 승인해 주세요.";
  });
}

export async function retryRefundAction(f: FormData) {
  const st = await who();
  const code = s(f, "code");
  await run(`/admin/bookings/${code}`, async () => {
    const r = await retryRefund(code, st.id);
    return `${r.refund.toLocaleString("ko-KR")}원을 환불했어요.`;
  });
}

export async function memoAction(f: FormData) {
  const st = await who();
  const code = s(f, "code");
  await run(`/admin/bookings/${code}`, async () => {
    const memo = s(f, "memo").slice(0, 2000);
    await db.booking.update({ where: { code }, data: { staff_memo: memo || null } });
    await audit(`staff:${st.id}`, "booking.memo", code, { memo });
    return "메모를 저장했어요.";
  });
}

// ── 문의·후기·공지 ──
export async function answerInquiryAction(f: FormData) {
  const st = await who();
  await run(backOf(f, "/admin/inquiries"), async () => {
    const answer = s(f, "answer");
    if (!answer) throw new HttpError(400, "EMPTY", "답변을 적어 주세요.");
    await answerInquiry(s(f, "id"), answer, `staff:${st.id}`);
    await audit(`staff:${st.id}`, "inquiry.answer", s(f, "id"));
    return "답변을 보냈어요.";
  });
}

export async function toggleReviewAction(f: FormData) {
  const st = await who();
  await run("/admin/reviews", async () => {
    const r = await db.review.findUniqueOrThrow({ where: { id: s(f, "id") } });
    await db.review.update({ where: { id: r.id }, data: { hidden: !r.hidden } });
    await audit(`staff:${st.id}`, r.hidden ? "review.show" : "review.hide", r.id);
    return r.hidden ? "후기를 다시 보이게 했어요." : "후기를 숨겼어요.";
  });
}

export async function noticeCreateAction(f: FormData) {
  const st = await who();
  await run("/admin/notices", async () => {
    const kind = s(f, "kind") === "faq" ? "faq" : "notice";
    const title = s(f, "title");
    const body = s(f, "body");
    if (!title || !body) throw new HttpError(400, "EMPTY", "제목과 내용을 적어 주세요.");
    const row = await db.notice.create({ data: { kind, title, body, category: s(f, "category") || null, pinned: f.get("pinned") === "on" } });
    await audit(`staff:${st.id}`, "notice.create", row.id, { kind, title });
    return "올렸어요.";
  });
}

export async function noticeToggleAction(f: FormData) {
  const st = await who();
  await run("/admin/notices", async () => {
    const row = await db.notice.findUniqueOrThrow({ where: { id: s(f, "id") } });
    await db.notice.update({ where: { id: row.id }, data: { published: !row.published } });
    await audit(`staff:${st.id}`, row.published ? "notice.unpublish" : "notice.publish", row.id);
    return row.published ? "내렸어요." : "다시 올렸어요.";
  });
}

// ── 상품·출발일 ──
export async function productEditAction(f: FormData) {
  const st = await who();
  const code = s(f, "code");
  await run(`/admin/tours/${code}`, async () => {
    const name = s(f, "name");
    const summary = s(f, "summary");
    const base = n(f, "base_price");
    if (!name || !summary || !base || base <= 0) throw new HttpError(400, "BAD_INPUT", "이름·요약·기준가를 확인해 주세요.");
    await db.product.update({ where: { code }, data: { name, summary, base_price: base, on_sale: f.get("on_sale") === "on" } });
    await audit(`staff:${st.id}`, "product.edit", code, { name, base_price: base });
    return "상품을 저장했어요.";
  });
}

export async function departureStatusAction(f: FormData) {
  const st = await who();
  await run(backOf(f, "/admin/tours"), async () => {
    const status = s(f, "status");
    if (status !== "open" && status !== "closed") throw new HttpError(400, "BAD_STATUS", "예약 가능·마감만 바꿀 수 있어요.");
    const d = await db.departure.findUniqueOrThrow({ where: { id: s(f, "id") } });
    if (d.status === "cancelled" || d.status === "departed") throw new HttpError(409, "BAD_STATE", "취소됐거나 출발한 출발일이에요.");
    await db.departure.update({ where: { id: d.id }, data: { status } });
    await audit(`staff:${st.id}`, "departure.status", d.id, { from: d.status, to: status });
    return status === "closed" ? "예약을 마감했어요." : "예약을 다시 열었어요.";
  });
}

export async function cancelDepartureAction(f: FormData) {
  const st = await who();
  await run(backOf(f, "/admin/tours"), async () => {
    const reason = s(f, "reason") || "최소 출발 인원 미달";
    const r = await cancelDeparture(s(f, "id"), st.id, reason);
    await audit(`staff:${st.id}`, "departure.cancel", s(f, "id"), { reason, ...r });
    return `출발을 취소했어요. 예약 ${r.bookings}건, 환불 ${r.refunded.toLocaleString("ko-KR")}원.`;
  });
}

export async function addDepartureAction(f: FormData) {
  const st = await who();
  const code = s(f, "code");
  await run(`/admin/tours/${code}`, async () => {
    const p = await db.product.findUniqueOrThrow({ where: { code } });
    const date = s(f, "depart_date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date <= addDays(kstDate(new Date()), 2)) {
      throw new HttpError(400, "BAD_DATE", "출발일은 오늘부터 3일 뒤 이후로 골라 주세요.");
    }
    const adult = n(f, "price_adult");
    const capacity = n(f, "capacity");
    const minPax = n(f, "min_pax");
    if (!adult || !capacity || !minPax || adult <= 0 || capacity <= 0 || minPax <= 0 || minPax > capacity) {
      throw new HttpError(400, "BAD_INPUT", "요금·정원·최소 인원을 확인해 주세요.");
    }
    const exists = await db.departure.findUnique({ where: { product_id_depart_date: { product_id: p.id, depart_date: date } } });
    if (exists) throw new HttpError(409, "EXISTS", "그 날짜 출발일이 이미 있어요.");
    const d = await db.departure.create({
      data: {
        product_id: p.id,
        depart_date: date,
        return_date: addDays(date, p.days - 1),
        capacity,
        min_pax: minPax,
        price_adult: adult,
        price_child: Math.round((adult * 0.9) / 1000) * 1000,
        price_infant: Math.round((adult * 0.1) / 1000) * 1000,
        single_supplement: n(f, "single_supplement") ?? 0,
      },
    });
    await audit(`staff:${st.id}`, "departure.create", d.id, { code, date, adult });
    return "출발일을 만들었어요.";
  });
}

// ── 직원·API 키 (관리자만) ──
export async function staffCreateAction(f: FormData) {
  const st = await who("admin");
  await run("/admin/staff", async () => {
    const email = s(f, "email").toLowerCase();
    const password = s(f, "password");
    const role = s(f, "role") === "admin" ? "admin" : "agent";
    if (!email.includes("@") || password.length < 10) throw new HttpError(400, "BAD_INPUT", "이메일과 10자 이상 비밀번호를 넣어 주세요.");
    if (await db.staff.findUnique({ where: { email } })) throw new HttpError(409, "EXISTS", "이미 있는 직원 이메일이에요.");
    const row = await db.staff.create({ data: { email, name: s(f, "name") || email, role, password_hash: await hashPassword(password) } });
    await audit(`staff:${st.id}`, "staff.create", row.id, { email, role });
    return "직원을 추가했어요.";
  });
}

export async function staffToggleAction(f: FormData) {
  const st = await who("admin");
  await run("/admin/staff", async () => {
    const id = s(f, "id");
    if (id === st.id) throw new HttpError(400, "SELF", "내 계정은 끌 수 없어요.");
    const row = await db.staff.findUniqueOrThrow({ where: { id } });
    await db.staff.update({ where: { id }, data: { active: !row.active } });
    if (row.active) await db.staffSession.deleteMany({ where: { staff_id: id } });
    await audit(`staff:${st.id}`, row.active ? "staff.disable" : "staff.enable", id);
    return row.active ? "직원 계정을 껐어요." : "직원 계정을 켰어요.";
  });
}



export async function apiKeyIssueAction(f: FormData) {
  const st = await who("admin");
  await run("/admin/api-keys", async () => {
    const scopes = f.getAll("scopes").map(String) as Scope[];
    const k = await issueApiKey(s(f, "name"), scopes, st.id);
    // 원문은 한 번만 보여 준다: 1분짜리 쿠키로 다음 화면에 넘긴다(주소창·로그에 남지 않게)
    (await cookies()).set(NEW_KEY_COOKIE, k.key, { httpOnly: true, sameSite: "strict", path: "/admin/api-keys", maxAge: 60 });
    await audit(`staff:${st.id}`, "apikey.issue", k.id, { name: s(f, "name"), scopes });
    return "키를 만들었어요. 지금 한 번만 보여 드려요.";
  });
}

export async function apiKeyRevokeAction(f: FormData) {
  const st = await who("admin");
  await run("/admin/api-keys", async () => {
    await revokeApiKey(s(f, "id"));
    await audit(`staff:${st.id}`, "apikey.revoke", s(f, "id"));
    return "키를 폐기했어요.";
  });
}
