import Link from "next/link";
import { redirect } from "next/navigation";
import { StaffLogoutButton } from "@/components/admin/StaffLoginForm";
import { currentStaff } from "@/server/auth/current";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "운영", template: "%s | 누비투어 운영" } };

const MENU = [
  { href: "/admin", label: "대시보드" },
  { href: "/admin/bookings", label: "예약" },
  { href: "/admin/cancellations", label: "취소 요청" },
  { href: "/admin/tours", label: "상품·출발일" },
  { href: "/admin/inquiries", label: "1:1 문의" },
  { href: "/admin/reviews", label: "후기" },
  { href: "/admin/notices", label: "공지·FAQ" },
  { href: "/admin/messages", label: "보낸 편지함" },
];
const ADMIN_MENU = [
  { href: "/admin/staff", label: "직원" },
  { href: "/admin/api-keys", label: "API 키" },
  { href: "/admin/audit", label: "작업 기록" },
];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");
  const menu = staff.role === "admin" ? [...MENU, ...ADMIN_MENU] : MENU;
  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="hidden w-52 shrink-0 flex-col bg-sea-900 px-3 py-5 text-sm text-sea-100 md:flex">
        <Link href="/admin" className="px-2 text-lg font-extrabold text-white">누비투어 운영</Link>
        <nav aria-label="운영 메뉴" className="mt-6 flex-1 space-y-0.5">
          {menu.map((m) => (
            <Link key={m.href} href={m.href} className="block rounded-md px-2 py-1.5 hover:bg-sea-800 hover:text-white">{m.label}</Link>
          ))}
        </nav>
        <div className="border-t border-sea-800 px-2 pt-3">
          <p className="text-white">{staff.name}</p>
          <p className="text-xs text-sea-300">{staff.role === "admin" ? "관리자" : "상담원"}</p>
          <div className="mt-2 flex gap-3"><Link href="/" className="text-xs text-slate-400 hover:text-white">손님 화면</Link><StaffLogoutButton /></div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <nav aria-label="운영 메뉴" className="flex gap-3 overflow-x-auto bg-sea-900 px-4 py-2 text-sm text-sea-100 md:hidden">
          {menu.map((m) => <Link key={m.href} href={m.href} className="whitespace-nowrap">{m.label}</Link>)}
        </nav>
        <main className="mx-auto max-w-6xl p-5">{children}</main>
      </div>
    </div>
  );
}
