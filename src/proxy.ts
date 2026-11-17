import { NextResponse, type NextRequest } from "next/server";

/** 직원 화면: 직원 쿠키가 없으면 로그인 화면으로 (실제 확인은 각 화면·API에서 다시 한다). */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/admin") && pathname !== "/admin/login" && !req.cookies.get("nb_staff")) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };
