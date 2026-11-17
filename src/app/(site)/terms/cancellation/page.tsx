import type { Metadata } from "next";
import { Doc } from "@/components/Doc";
import { CANCELLATION_TABLE } from "@/rules/cancellation";

export const metadata: Metadata = { title: "취소·환불 규정" };

export default function CancellationTerms() {
  return (
    <Doc title="취소·환불 규정" updated="2026년 11월 17일">
      <p>국외여행 표준약관에 따른 기준이에요. 날짜는 한국 시간 기준으로 셉니다.</p>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-slate-300 text-left"><th className="py-2">취소를 알린 때</th><th className="py-2 text-right">취소 수수료</th></tr></thead>
        <tbody>
          {CANCELLATION_TABLE.map((r) => (
            <tr key={r.label} className="border-b border-slate-100">
              <td className="py-2">{r.label}</td>
              <td className="py-2 text-right font-semibold">{r.rate === 0 ? "없음 (낸 금액 전액 환불)" : `여행 요금의 ${Math.round(r.rate * 100)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section>
        <h2>계산 방법</h2>
        <ul>
          <li>수수료는 그 예약의 여행 요금 총액(아동·유아·싱글룸 포함)에 비율을 곱해 원 단위 아래는 버려요.</li>
          <li>돌려받는 금액은 지금까지 낸 금액에서 수수료를 뺀 만큼이에요. 수수료가 낸 금액보다 많아도 더 받지 않아요.</li>
          <li>결제 전(예약금을 내기 전) 예약은 수수료 없이 바로 취소돼요.</li>
        </ul>
      </section>
      <section>
        <h2>여행사 사정으로 취소되면</h2>
        <p>최소 출발 인원이 모이지 않는 등 여행사 사정으로 출발이 취소되면 수수료 없이 낸 금액 전액을 돌려드려요.</p>
      </section>
      <section>
        <h2>환불 방법과 시기</h2>
        <p>취소 신청은 예약 상세의 ‘예약 취소 신청’에서 할 수 있어요. 담당자가 확인한 뒤 결제한 수단으로 돌려드리고, 카드사에 따라 실제 반영까지 3~7영업일이 걸려요.</p>
      </section>
    </Doc>
  );
}
