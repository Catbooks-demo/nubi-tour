import type { Metadata } from "next";
import Link from "next/link";
import { LookupForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "비회원 예약 조회" };

export default function LookupPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-14">
      <h1 className="text-2xl font-bold">비회원 예약 조회</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">예약할 때 받은 예약번호와 정한 조회 비밀번호를 넣어 주세요.</p>
      <LookupForm />
      <p className="mt-6 text-center text-sm text-slate-500">회원으로 예약했다면 <Link href="/login?next=/my" className="underline">로그인</Link>해서 보세요.</p>
    </div>
  );
}
