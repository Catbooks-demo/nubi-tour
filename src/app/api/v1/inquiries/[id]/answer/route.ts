import { NextResponse } from "next/server";
import { z } from "zod";
import { authApiKey } from "@/server/apikeys";
import { audit } from "@/server/audit";
import { answerInquiry } from "@/server/inquiries";
import { readJson, route } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };
const body = z.object({ answer: z.string().trim().min(1, "답변을 넣어 주세요.").max(5000) });

/** 1:1 문의 답변 (다시 보내면 답변을 고친다). */
export const POST = route<Ctx>(async (req, { params }) => {
  const key = await authApiKey(req, "write");
  const { id } = await params;
  const { answer } = await readJson(req, body);
  await answerInquiry(id, answer, `api:${key.name}`);
  await audit(`api:${key.name}`, "inquiry.answer", id);
  return NextResponse.json({ ok: true });
});
