"use client";

import { useState } from "react";
import { api } from "@/lib/api";

const CATS = [
  { v: "booking", label: "예약" },
  { v: "payment", label: "결제" },
  { v: "cancel", label: "취소·환불" },
  { v: "product", label: "상품 문의" },
  { v: "etc", label: "기타" },
];

export function InquiryForm({ member, bookingCode }: { member: boolean; bookingCode?: string }) {
  const [f, setF] = useState({ category: bookingCode ? "booking" : "product", title: "", body: "", booking_code: bookingCode ?? "", name: "", email: "" });
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (done) {
    return (
      <div className="rounded-xl bg-emerald-50 p-6 text-emerald-800" role="status">
        문의를 받았어요. 답변은 {member ? "마이페이지 › 1:1 문의 내역과 " : ""}이메일로 보내 드려요.
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api("/api/inquiries", {
            category: f.category,
            title: f.title,
            body: f.body,
            booking_code: f.booking_code || undefined,
            name: member ? undefined : f.name,
            email: member ? undefined : f.email,
          });
          setDone(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="cat" className="label">분류</label>
          <select id="cat" className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="bcode" className="label">예약번호 (선택)</label>
          <input id="bcode" className="field uppercase" placeholder="NB2611170001" value={f.booking_code} onChange={(e) => setF({ ...f, booking_code: e.target.value.toUpperCase() })} />
        </div>
      </div>
      {!member && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="qname" className="label">이름</label><input id="qname" required className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div><label htmlFor="qemail" className="label">답변 받을 이메일</label><input id="qemail" type="email" required className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        </div>
      )}
      <div><label htmlFor="qtitle" className="label">제목</label><input id="qtitle" required className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      <div><label htmlFor="qbody" className="label">내용</label><textarea id="qbody" required rows={6} className="field" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></div>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      <button disabled={busy} className="btn-primary">{busy ? "보내는 중…" : "문의 남기기"}</button>
    </form>
  );
}
