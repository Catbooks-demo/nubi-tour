import { NextResponse } from "next/server";
import { requireUser, userFromRequest } from "@/server/auth/session";
import { db } from "@/server/db";
import { guestCodeFromRequest } from "@/server/guest";
import { readJson, route } from "@/server/http";
import { createInquiry, inquirySchema } from "@/server/support";

export const dynamic = "force-dynamic";

/** 내 문의 목록 (회원). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const list = await db.inquiry.findMany({ where: { user_id: user.id }, orderBy: { created_at: "desc" } });
  return NextResponse.json({
    inquiries: list.map((i) => ({
      id: i.id, category: i.category, title: i.title, body: i.body, status: i.status,
      answer: i.answer, answered_at: i.answered_at?.toISOString() ?? null, created_at: i.created_at.toISOString(),
    })),
  });
});

export const POST = route(async (req) => {
  const input = await readJson(req, inquirySchema);
  const user = await userFromRequest(req);
  const inq = await createInquiry(input, { userId: user?.id, guestCode: guestCodeFromRequest(req) });
  return NextResponse.json({ id: inq.id }, { status: 201 });
});
