import Link from "next/link";
import { Logo } from "@/components/Logo";
import { currentUser } from "@/server/auth/current";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [user, regions] = await Promise.all([
    currentUser(),
    db.region.findMany({ orderBy: { sort_order: "asc" } }),
  ]);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" aria-label="누비투어 처음으로">
            <Logo />
          </Link>
          <nav aria-label="내 메뉴" className="flex items-center gap-1 text-sm text-slate-600">
            <Link href="/lookup" className="rounded-md px-2.5 py-1.5 hover:bg-slate-100">비회원 예약 조회</Link>
            <Link href="/support" className="hidden rounded-md px-2.5 py-1.5 hover:bg-slate-100 sm:inline">고객센터</Link>
            {user ? (
              <Link href="/my" className="rounded-md px-2.5 py-1.5 font-medium text-sea-700 hover:bg-sea-50">
                {user.name}님 · 마이페이지
              </Link>
            ) : (
              <>
                <Link href="/login" className="rounded-md px-2.5 py-1.5 hover:bg-slate-100">로그인</Link>
                <Link href="/signup" className="hidden rounded-md px-2.5 py-1.5 hover:bg-slate-100 sm:inline">회원가입</Link>
              </>
            )}
          </nav>
        </div>
        <nav aria-label="지역" className="mx-auto max-w-6xl overflow-x-auto px-4">
          <ul className="flex gap-5 whitespace-nowrap pb-2 text-[15px] font-semibold text-slate-700">
            {regions.map((r) => (
              <li key={r.code}>
                <Link href={`/tours?region=${r.code}`} className="inline-block border-b-2 border-transparent py-1 hover:border-sea-600 hover:text-sea-700">
                  {r.name}
                </Link>
              </li>
            ))}
            <li className="ml-auto">
              <Link href="/tours?confirmed=1" className="inline-block py-1 text-emerald-700 hover:underline">출발 확정 상품</Link>
            </li>
          </ul>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-16 border-t border-slate-200 bg-slate-50 text-sm text-slate-600">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Logo />
            <p className="font-medium text-slate-700">시연용 가상 여행사입니다. 실제 여행 상품을 판매하지 않습니다.</p>
            <p>결제는 테스트 모드로만 동작해 실제 돈이 빠져나가지 않아요. 문자·이메일 안내도 실제로 보내지 않아요.</p>
          </div>
          <ul className="space-y-1.5">
            <li><Link href="/terms/travel" className="hover:underline">여행약관</Link></li>
            <li><Link href="/terms/cancellation" className="hover:underline">취소·환불 규정</Link></li>
            <li><Link href="/terms/privacy" className="font-semibold hover:underline">개인정보 처리방침</Link></li>
            <li><Link href="/support" className="hover:underline">고객센터</Link></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
