import { z } from "zod";
import { db } from "./db";
import { HttpError } from "./http";

export const INQUIRY_CATEGORIES = {
  booking: "예약",
  payment: "결제",
  cancel: "취소·환불",
  product: "상품 문의",
  etc: "기타",
} as const;

export const inquirySchema = z.object({
  category: z.enum(["booking", "payment", "cancel", "product", "etc"]),
  title: z.string().trim().min(2, "제목을 2자 이상 넣어 주세요.").max(100),
  body: z.string().trim().min(5, "내용을 5자 이상 넣어 주세요.").max(3000),
  booking_code: z.string().trim().optional(),
  name: z.string().trim().max(30).optional(),
  email: z.string().trim().toLowerCase().email("답변 받을 이메일을 확인해 주세요.").optional(),
});

/** 1:1 문의. 회원이면 회원 정보로, 비회원이면 이름·이메일이 필요하다. 예약번호는 본인 예약일 때만 잇는다. */
export async function createInquiry(
  input: z.infer<typeof inquirySchema>,
  who: { userId?: string | null; guestCode?: string | null },
) {
  let name = input.name;
  let email = input.email;
  if (who.userId) {
    const u = await db.user.findUniqueOrThrow({ where: { id: who.userId } });
    name = u.name;
    email = u.email;
  }
  if (!name || !email) throw new HttpError(400, "CONTACT_REQUIRED", "답변 받을 이름과 이메일을 넣어 주세요.");
  let bookingId: string | null = null;
  if (input.booking_code) {
    const b = await db.booking.findUnique({ where: { code: input.booking_code.toUpperCase() } });
    const mine = b && ((who.userId && b.user_id === who.userId) || (!b.user_id && who.guestCode === b.code));
    if (!mine) throw new HttpError(400, "BAD_BOOKING", "내 예약번호만 연결할 수 있어요.");
    bookingId = b.id;
  }
  return db.inquiry.create({
    data: {
      user_id: who.userId ?? null,
      booking_id: bookingId,
      name,
      email,
      category: input.category,
      title: input.title,
      body: input.body,
    },
  });
}

export const reviewSchema = z.object({
  booking_code: z.string().trim().min(1),
  rating: z.number().int().min(1).max(5),
  body: z.string().trim().min(10, "후기는 10자 이상 써 주세요.").max(2000),
});

/** 여행 후기: 여행을 마친 본인 예약만, 예약마다 하나. */
export async function createReview(userId: string, input: z.infer<typeof reviewSchema>) {
  const b = await db.booking.findUnique({ where: { code: input.booking_code.toUpperCase() }, include: { departure: true, review: true } });
  if (!b || b.user_id !== userId) throw new HttpError(404, "NOT_FOUND", "예약을 찾지 못했어요.");
  if (b.status !== "completed") throw new HttpError(403, "NOT_COMPLETED", "여행을 마친 뒤에 후기를 쓸 수 있어요.");
  if (b.review) throw new HttpError(409, "ALREADY_REVIEWED", "이 예약에는 이미 후기를 썼어요.");
  return db.review.create({
    data: { user_id: userId, booking_id: b.id, product_id: b.departure.product_id, rating: input.rating, body: input.body },
  });
}
