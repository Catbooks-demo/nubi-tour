import type { Metadata } from "next";
import { Doc } from "@/components/Doc";

export const metadata: Metadata = { title: "개인정보 처리방침" };

export default function PrivacyPolicy() {
  return (
    <Doc title="개인정보 처리방침" updated="2026년 11월 17일">
      <p>누비투어는 시연용 가상 여행사예요. 실제 개인정보를 넣지 말아 주세요. 아래는 실제 여행사라면 이렇게 처리한다는 기준이에요.</p>
      <section>
        <h2>1. 모으는 정보와 목적</h2>
        <ul>
          <li>회원가입: 이름, 이메일, 휴대폰 번호, 비밀번호(암호화해서 저장) — 회원 확인과 예약 안내</li>
          <li>예약: 예약자 이름·연락처, 여행자 한글·영문 이름, 성별, 생년월일 — 항공권·호텔 예약과 여행자보험 가입</li>
          <li>결제: 결제 수단 승인 정보 — 결제와 환불. 카드번호는 결제사가 처리하고 누비투어는 저장하지 않아요.</li>
          <li>여권번호는 저장하지 않아요. 출발 전 담당자가 따로 확인해요.</li>
        </ul>
      </section>
      <section>
        <h2>2. 보관 기간</h2>
        <ul>
          <li>회원 정보: 탈퇴할 때까지</li>
          <li>계약·결제·취소 기록: 전자상거래법에 따라 5년</li>
          <li>상담(1:1 문의) 기록: 3년</li>
        </ul>
      </section>
      <section>
        <h2>3. 다른 곳에 주는 정보</h2>
        <p>여행에 꼭 필요한 범위에서만 항공사, 현지 호텔·여행사, 보험사에 여행자 정보를 줘요. 그 밖에는 손님 동의 없이 주지 않아요.</p>
      </section>
      <section>
        <h2>4. 손님의 권리</h2>
        <p>내 정보를 보거나 고치거나 지워 달라고 언제든 요청할 수 있어요. 1:1 문의로 남겨 주세요.</p>
      </section>
    </Doc>
  );
}
