import { NextResponse } from "next/server";
import { OPENAPI } from "@/server/v1/openapi";

export function GET() {
  return NextResponse.json(OPENAPI);
}
