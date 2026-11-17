"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { won } from "@/lib/format";
import { MAX_PAX, quote, validatePax } from "@/rules/pricing";

type Dep = {
  id: string;
  depart_date: string;
  seats_left: number;
  price_adult: number;
  price_child: number;
  price_infant: number;
  single_supplement: number;
  deposit_per_person: number;
};
type Traveler = { name_ko: string; name_en: string; gender: "F" | "M" | ""; birth_date: string };
const TYPE_KO = { adult: "성인", child: "아동", infant: "유아" } as const;
const empty = (): Traveler => ({ name_ko: "", name_en: "", gender: "", birth_date: "" });

export function BookingForm({ departure, payMode, member }: { departure: Dep; payMode: "deposit" | "full"; member: { name: string; phone: string; email: string } | null }) {
  const router = useRouter();
  const [pax, setPax] = useState({ adults: 2, children: 0, infants: 0, single_rooms: 0 });
  const [contact, setContact] = useState({ name: member?.name ?? "", phone: member?.phone ?? "", email: member?.email ?? "" });
  const [travelers, setTravelers] = useState<Traveler[]>([empty(), empty()]);
  const [pin, setPin] = useState("");
  const [agree, setAgree] = useState({ terms: false, privacy: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kinds = useMemo(
    () => [
      ...Array(pax.adults).fill("adult"),
      ...Array(pax.children).fill("child"),
      ...Array(pax.infants).fill("infant"),
    ] as (keyof typeof TYPE_KO)[],
    [pax],
  );
  const paxError = validatePax(pax) ?? (pax.adults + pax.children > departure.seats_left ? `남은 좌석이 ${departure.seats_left}석이에요.` : null);
  const q = quote(departure, pax);
  const first = payMode === "full" ? q.total : Math.min(q.total, departure.deposit_per_person * q.seats);

  function changePax(key: keyof typeof pax, delta: number) {
    const next = { ...pax, [key]: Math.max(0, pax[key] + delta) };
    setPax(next);
    const n = next.adults + next.children + next.infants;
    setTravelers((cur) => (n > cur.length ? [...cur, ...Array.from({ length: n - cur.length }, empty)] : cur.slice(0, n)));
  }

  function setTraveler(i: number, patch: Partial<Traveler>) {
    setTravelers((cur) => cur.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (paxError) return setError(paxError);
    if (!agree.terms || !agree.privacy) return setError("약관과 개인정보 수집·이용에 동의해 주세요.");
    if (travelers.some((t) => !t.gender)) return setError("여행자 성별을 골라 주세요.");
    setBusy(true);
    try {
      const r = await api<{ booking: { code: string } }>("/api/bookings", {
        departure_id: departure.id,
        pax,
        contact,
        travelers,
        guest_pin: member ? undefined : pin,
        agree_terms: true,
      });
      router.push(`/bookings/${r.booking.code}?new=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-8">
      <Step n={1} title="인원">
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          <Counter label="성인" hint="만 12세 이상" value={pax.adults} price={departure.price_adult} onChange={(d) => changePax("adults", d)} />
          <Counter label="아동" hint="출발일 기준 만 2~11세" value={pax.children} price={departure.price_child} onChange={(d) => changePax("children", d)} />
          <Counter label="유아" hint="출발일 기준 만 2세 미만, 좌석 없음" value={pax.infants} price={departure.price_infant} onChange={(d) => changePax("infants", d)} />
          {departure.single_supplement > 0 && (
            <Counter label="싱글룸" hint="혼자 방을 쓰는 성인 수" value={pax.single_rooms} price={departure.single_supplement} onChange={(d) => changePax("single_rooms", d)} />
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">한 번에 {MAX_PAX}명까지 예약할 수 있어요.</p>
        {paxError && <p className="mt-2 text-sm text-rose-600" role="alert">{paxError}</p>}
      </Step>

      <Step n={2} title="예약자">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="이름" id="c-name"><input id="c-name" required className="field" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} autoComplete="name" /></Field>
          <Field label="휴대폰" id="c-phone"><input id="c-phone" required inputMode="tel" placeholder="010-1234-5678" className="field" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} autoComplete="tel" /></Field>
          <Field label="이메일" id="c-email"><input id="c-email" required type="email" className="field" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} autoComplete="email" /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">예약 안내 문자와 이메일을 이 연락처로 보내요.</p>
      </Step>

      <Step n={3} title="여행자">
        <p className="mb-3 text-sm text-slate-600">여권과 똑같이 적어 주세요. 영문 이름이 여권과 다르면 탑승이 거절될 수 있어요.</p>
        <ol className="space-y-3">
          {travelers.map((t, i) => (
            <li key={i} className="rounded-xl border border-slate-200 p-4">
              <p className="mb-2 text-sm font-semibold text-sea-800">여행자 {i + 1} · {TYPE_KO[kinds[i]]}</p>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="한글 이름" id={`t${i}-ko`}><input id={`t${i}-ko`} required className="field" value={t.name_ko} onChange={(e) => setTraveler(i, { name_ko: e.target.value })} /></Field>
                <Field label="영문 이름 (여권)" id={`t${i}-en`}><input id={`t${i}-en`} required placeholder="KIM MINJI" className="field uppercase" value={t.name_en} onChange={(e) => setTraveler(i, { name_en: e.target.value.toUpperCase() })} /></Field>
                <Field label="성별" id={`t${i}-g`}>
                  <select id={`t${i}-g`} required className="field" value={t.gender} onChange={(e) => setTraveler(i, { gender: e.target.value as Traveler["gender"] })}>
                    <option value="">고르기</option>
                    <option value="F">여성</option>
                    <option value="M">남성</option>
                  </select>
                </Field>
                <Field label="생년월일" id={`t${i}-b`}><input id={`t${i}-b`} required type="date" className="field" value={t.birth_date} onChange={(e) => setTraveler(i, { birth_date: e.target.value })} /></Field>
              </div>
              {i === 0 && contact.name && !t.name_ko && (
                <button type="button" className="mt-2 text-sm text-sea-700 underline" onClick={() => setTraveler(0, { name_ko: contact.name })}>예약자와 같은 사람이에요</button>
              )}
            </li>
          ))}
        </ol>
      </Step>

      <Step n={4} title="동의와 결제 안내">
        {!member && (
          <div className="mb-4 rounded-xl border border-slate-200 p-4">
            <Field label="조회 비밀번호 (숫자 4~6자리)" id="pin">
              <input id="pin" required inputMode="numeric" pattern="[0-9]{4,6}" maxLength={6} className="field max-w-48" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))} />
            </Field>
            <p className="mt-1 text-xs text-slate-500">비회원 예약이에요. 예약번호·휴대폰 번호와 이 비밀번호로 예약을 조회해요. <Link href="/login" className="underline">로그인하고 예약하기</Link></p>
          </div>
        )}
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-sea-700" checked={agree.terms} onChange={(e) => setAgree({ ...agree, terms: e.target.checked })} />
            <span>[필수] <Link href="/terms/travel" target="_blank" className="underline">여행약관</Link>과 <Link href="/terms/cancellation" target="_blank" className="underline">취소·환불 규정</Link>을 읽었고 동의해요.</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-sea-700" checked={agree.privacy} onChange={(e) => setAgree({ ...agree, privacy: e.target.checked })} />
            <span>[필수] 예약을 위한 <Link href="/terms/privacy" target="_blank" className="underline">개인정보 수집·이용</Link>에 동의해요. (이름·연락처·생년월일·여권 영문 이름)</span>
          </label>
        </div>
      </Step>

      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-4 backdrop-blur sm:static sm:mx-0 sm:rounded-xl sm:border sm:px-5">
        <ul className="space-y-1 text-sm">
          {q.lines.map((l) => (
            <li key={l.label} className="flex justify-between"><span className="text-slate-600">{l.label} {l.qty}</span><span className="tabular-nums">{won(l.amount)}</span></li>
          ))}
        </ul>
        <div className="mt-2 flex items-end justify-between border-t border-slate-100 pt-2">
          <span className="font-semibold">여행 요금 합계</span>
          <span className="price text-xl">{won(q.total)}</span>
        </div>
        <p className="mt-1 text-right text-sm text-slate-600">
          {payMode === "full" ? "출발이 7일 이내라 지금 전액" : "지금 예약금"} <b className="tabular-nums text-ink">{won(first)}</b>을 24시간 안에 결제해요.
        </p>
        {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
        <button disabled={busy || !!paxError} className="btn-pay mt-3 w-full py-3 text-base">{busy ? "예약하는 중…" : "예약하기"}</button>
      </div>
    </form>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="mb-3 flex items-center gap-2 text-lg font-bold">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sea-700 text-sm text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
    </div>
  );
}

function Counter({ label, hint, value, price, onChange }: { label: string; hint: string; value: number; price: number; onChange: (d: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <p className="font-medium">{label} <span className="ml-1 text-sm tabular-nums text-slate-500">{won(price)}</span></p>
        <p className="text-xs text-slate-500">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" aria-label={`${label} 줄이기`} onClick={() => onChange(-1)} disabled={value === 0} className="h-8 w-8 rounded-full border border-slate-300 text-lg leading-none disabled:opacity-40">−</button>
        <span className="w-5 text-center font-semibold tabular-nums" aria-live="polite" aria-label={`${label} ${value}명`}>{value}</span>
        <button type="button" aria-label={`${label} 늘리기`} onClick={() => onChange(1)} className="h-8 w-8 rounded-full border border-slate-300 text-lg leading-none">+</button>
      </div>
    </div>
  );
}
