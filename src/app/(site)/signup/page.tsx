import type { Metadata } from "next";
import { SignupForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "회원가입" };

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-14">
      <h1 className="text-2xl font-bold">회원가입</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">회원이면 예약 내역을 한곳에서 보고 여행 후기를 남길 수 있어요.</p>
      <SignupForm />
    </div>
  );
}
