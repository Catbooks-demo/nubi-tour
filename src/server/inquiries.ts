import { db } from "./db";
import { HttpError } from "./http";

/** 문의 답변 (직원 화면·외부 API 공용). 답변을 보낸 사실은 보낸 편지함에 이메일로 남긴다. */
export async function answerInquiry(id: string, answer: string, by: string): Promise<void> {
  const q = await db.inquiry.findUnique({ where: { id } });
  if (!q) throw new HttpError(404, "NOT_FOUND", "문의를 찾지 못했어요.");
  await db.$transaction([
    db.inquiry.update({ where: { id }, data: { answer, answered_by: by, answered_at: new Date(), status: "answered" } }),
    db.message.create({
      data: {
        booking_id: q.booking_id,
        channel: "email",
        to: q.email,
        kind: "inquiry_answered",
        subject: `[누비투어] 문의하신 "${q.title.slice(0, 30)}"에 답변드려요`,
        body: answer,
      },
    }),
  ]);
}
