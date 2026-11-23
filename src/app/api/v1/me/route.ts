import { NextResponse } from "next/server";
import { authApiKey } from "@/server/apikeys";
import { route } from "@/server/http";

export const dynamic = "force-dynamic";

/** 이 키의 이름과 범위. 쓰기 전에 write 범위가 있는지 확인하는 용도(키 원문·해시는 돌려주지 않는다). */
export const GET = route(async (req) => {
  const key = await authApiKey(req, "any");
  return NextResponse.json({ name: key.name, prefix: key.prefix, scopes: key.scopes });
});
