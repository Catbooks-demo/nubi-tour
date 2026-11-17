"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

export function ReviewForm({ code }: { code: string }) {
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/reviews", { booking_code: code, rating, body });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 p-4">
      <fieldset>
        <legend className="label">별점</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n}점`} aria-pressed={rating === n} onClick={() => setRating(n)} className={`text-2xl ${n <= rating ? "text-dusk-500" : "text-slate-300"}`}>★</button>
          ))}
        </div>
      </fieldset>
      <label htmlFor="review-body" className="label">후기</label>
      <textarea id="review-body" rows={4} className="field" value={body} onChange={(e) => setBody(e.target.value)} placeholder="일정·숙소·가이드는 어땠나요?" />
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      <button disabled={busy} className="btn-primary">후기 남기기</button>
    </form>
  );
}
