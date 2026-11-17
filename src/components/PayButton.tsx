"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { won } from "@/lib/format";

type Kind = "deposit" | "balance" | "full";
const LABEL: Record<Kind, string> = { deposit: "예약금", balance: "잔금", full: "여행 요금" };

/** 결제 버튼: 토스 테스트 키가 있으면 토스 결제창, 없으면 모의 결제. */
export function PayButton({ code, kind, amount, toss }: { code: string; kind: Kind; amount: number; toss: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      if (!toss) {
        await api("/api/payments/mock", { code, kind });
        router.refresh();
        setBusy(false);
        return;
      }
      const p = await api<{ orderId: string; amount: number; orderName: string; clientKey: string; customerName: string; customerEmail: string }>(
        "/api/payments/prepare",
        { code, kind },
      );
      const { loadTossPayments, ANONYMOUS } = await import("@tosspayments/tosspayments-sdk");
      const tp = await loadTossPayments(p.clientKey);
      const payment = tp.payment({ customerKey: ANONYMOUS });
      await payment.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: p.amount },
        orderId: p.orderId,
        orderName: p.orderName,
        successUrl: `${location.origin}/pay/success`,
        failUrl: `${location.origin}/pay/fail?booking=${encodeURIComponent(code)}`,
        customerEmail: p.customerEmail,
        customerName: p.customerName,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={pay} disabled={busy} className="btn-pay w-full py-3 text-base sm:w-auto sm:px-8">
        {busy ? "결제 진행 중…" : `${LABEL[kind]} ${won(amount)} ${toss ? "결제하기" : "모의 결제하기"}`}
      </button>
      {!toss && <p className="mt-1 text-xs text-slate-500">테스트 환경이라 실제 결제 없이 결제 완료로 처리돼요.</p>}
      {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
    </div>
  );
}
