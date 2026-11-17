"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { won } from "@/lib/format";

type Preview = { daysBefore: number; rate: number; fee: number; paid: number; refund: number };

/** 취소 신청: 먼저 지금 취소할 때의 수수료·환불액을 보여 주고 사유를 받아 신청한다. */
export function CancelPanel({ code, paidAlready }: { code: string; paidAlready: boolean }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    try {
      setPreview((await api<{ preview: Preview }>(`/api/bookings/${code}/cancel`)).preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/bookings/${code}/cancel`, { reason });
      setPreview(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!preview) {
    return (
      <div>
        <button onClick={open} className="btn-line">예약 취소 신청</button>
        {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
      <h3 className="font-semibold">지금 취소하면</h3>
      <dl className="mt-2 grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
        <div><dt className="text-slate-500">출발까지</dt><dd className="font-semibold">{preview.daysBefore}일</dd></div>
        <div><dt className="text-slate-500">취소 수수료</dt><dd className="font-semibold tabular-nums">{won(preview.fee)} ({Math.round(preview.rate * 100)}%)</dd></div>
        <div><dt className="text-slate-500">낸 금액</dt><dd className="font-semibold tabular-nums">{won(preview.paid)}</dd></div>
        <div><dt className="text-slate-500">돌려받을 금액</dt><dd className="price">{won(preview.refund)}</dd></div>
      </dl>
      {preview.fee > preview.paid && <p className="mt-2 text-xs text-slate-600">수수료가 낸 금액보다 많아도 더 내실 돈은 없어요.</p>}
      <label htmlFor="cancel-reason" className="label mt-3">취소 사유</label>
      <textarea id="cancel-reason" rows={2} className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 개인 일정 변경" />
      <p className="mt-2 text-xs text-slate-600">
        {paidAlready ? "담당자가 확인한 뒤 환불해 드려요. 금액은 신청한 시각 기준이에요." : "결제 전 예약이라 바로 취소돼요."}
      </p>
      {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={confirm} disabled={busy || !reason.trim()} className="btn bg-rose-600 text-white hover:bg-rose-700">{busy ? "신청하는 중…" : "취소 신청하기"}</button>
        <button onClick={() => setPreview(null)} className="btn-line">그만두기</button>
      </div>
    </div>
  );
}
