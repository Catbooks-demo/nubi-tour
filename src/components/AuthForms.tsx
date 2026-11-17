"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

function useSubmit() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return { error, busy, run };
}

const safeNext = (next?: string) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/my");

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [f, setF] = useState({ email: "", password: "" });
  const { error, busy, run } = useSubmit();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await api("/api/auth/login", f);
          router.push(safeNext(next));
          router.refresh();
        });
      }}
      className="space-y-4"
    >
      <div><label htmlFor="email" className="label">이메일</label><input id="email" type="email" required autoComplete="email" className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div><label htmlFor="password" className="label">비밀번호</label><input id="password" type="password" required autoComplete="current-password" className="field" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      <button disabled={busy} className="btn-primary w-full py-3">{busy ? "로그인하는 중…" : "로그인"}</button>
      <p className="text-center text-sm text-slate-600">처음이신가요? <Link href="/signup" className="font-semibold text-sea-700 underline">회원가입</Link></p>
    </form>
  );
}

export function SignupForm() {
  const router = useRouter();
  const [f, setF] = useState({ email: "", password: "", name: "", phone: "", marketing_opt_in: false, agree_terms: false, agree_privacy: false });
  const { error, busy, run } = useSubmit();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await api("/api/auth/signup", f);
          router.push("/my");
          router.refresh();
        });
      }}
      className="space-y-4"
    >
      <div><label htmlFor="name" className="label">이름</label><input id="name" required autoComplete="name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label htmlFor="email" className="label">이메일</label><input id="email" type="email" required autoComplete="email" className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div><label htmlFor="password" className="label">비밀번호 (8자 이상)</label><input id="password" type="password" required minLength={8} autoComplete="new-password" className="field" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      <div><label htmlFor="phone" className="label">휴대폰</label><input id="phone" required inputMode="tel" autoComplete="tel" placeholder="010-1234-5678" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-sea-700" checked={f.agree_terms} onChange={(e) => setF({ ...f, agree_terms: e.target.checked })} />[필수] <Link href="/terms/travel" target="_blank" className="underline">이용약관</Link>에 동의해요.</label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-sea-700" checked={f.agree_privacy} onChange={(e) => setF({ ...f, agree_privacy: e.target.checked })} />[필수] <Link href="/terms/privacy" target="_blank" className="underline">개인정보 수집·이용</Link>에 동의해요.</label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-sea-700" checked={f.marketing_opt_in} onChange={(e) => setF({ ...f, marketing_opt_in: e.target.checked })} />[선택] 특가·기획전 소식을 받을게요.</label>
      </div>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      <button disabled={busy} className="btn-primary w-full py-3">{busy ? "가입하는 중…" : "가입하기"}</button>
    </form>
  );
}

export function LookupForm() {
  const router = useRouter();
  const [f, setF] = useState({ code: "", phone: "", pin: "" });
  const { error, busy, run } = useSubmit();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await api<{ booking: { code: string } }>("/api/bookings/lookup", f);
          router.push(`/bookings/${r.booking.code}`);
        });
      }}
      className="space-y-4"
    >
      <div><label htmlFor="code" className="label">예약번호</label><input id="code" required placeholder="NB2611170001" className="field uppercase" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></div>
      <div><label htmlFor="phone" className="label">예약자 휴대폰</label><input id="phone" required inputMode="tel" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      <div><label htmlFor="pin" className="label">조회 비밀번호</label><input id="pin" required type="password" inputMode="numeric" maxLength={6} className="field" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></div>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      <button disabled={busy} className="btn-primary w-full py-3">{busy ? "찾는 중…" : "예약 조회"}</button>
    </form>
  );
}

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await api("/api/auth/logout", {});
        router.push("/");
        router.refresh();
      }}
      className="text-sm text-slate-500 underline"
    >
      로그아웃
    </button>
  );
}
