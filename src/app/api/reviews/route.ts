import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { createReview, reviewSchema } from "@/server/support";

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await readJson(req, reviewSchema);
  const r = await createReview(user.id, input);
  return NextResponse.json({ id: r.id }, { status: 201 });
});
