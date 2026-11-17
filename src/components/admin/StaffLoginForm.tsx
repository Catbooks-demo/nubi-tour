"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

export function StaffLoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [f, setF] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api("/api/admin/auth/login", f);
          router.push(next && next.startsWith("/admin") ? next : "/admin");
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
          setBusy(false);
        }
      }}
    >
      <div><label htmlFor="s-email" className="label">이메일</label><input id="s-email" type="email" required autoComplete="username" className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div><label htmlFor="s-pw" className="label">비밀번호</label><input id="s-pw" type="password" required autoComplete="current-password" className="field" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      <button disabled={busy} className="btn-primary w-full py-3">{busy ? "확인 중…" : "로그인"}</button>
    </form>
  );
}

export function StaffLogoutButton() {
  const router = useRouter();
  return (
    <button
      className="text-xs text-slate-400 hover:text-white"
      onClick={async () => {
        await api("/api/admin/auth/logout", {});
        router.push("/admin/login");
        router.refresh();
      }}
    >
      로그아웃
    </button>
  );
}
