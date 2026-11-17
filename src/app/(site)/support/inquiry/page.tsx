import type { Metadata } from "next";
import { InquiryForm } from "@/components/InquiryForm";
import { currentUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "1:1 문의" };

export default async function InquiryPage({ searchParams }: { searchParams: Promise<{ booking?: string }> }) {
  const [{ booking }, user] = await Promise.all([searchParams, currentUser()]);
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">1:1 문의</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">답변은 영업일 기준 하루 안에 드려요. 예약 문의는 예약번호를 함께 적어 주시면 빨라요.</p>
      <InquiryForm member={!!user} bookingCode={booking} />
    </div>
  );
}
