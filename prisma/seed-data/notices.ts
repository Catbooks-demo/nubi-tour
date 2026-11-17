export interface SeedNotice {
  kind: "notice" | "faq";
  category: string | null;
  title: string;
  body: string;
  pinned: boolean;
}

export const NOTICES: SeedNotice[] = [
  {
    kind: "notice", category: null, pinned: true,
    title: "누비투어는 시연용 가상 여행사예요",
    body: "이 사이트는 서비스 시연을 위해 만든 가상 여행사예요. 실제 여행 상품을 판매하지 않으며, 결제는 테스트 모드로만 동작해 실제 돈이 빠져나가지 않아요.",
  },
  {
    kind: "notice", category: null, pinned: false,
    title: "예약금 결제 기한 안내",
    body: "예약 후 24시간 안에 예약금을 결제해 주세요. 기한이 지나면 예약이 자동으로 취소되고 좌석은 다른 손님께 돌아가요. 출발 7일 이내 상품은 예약금 없이 총액을 한 번에 결제해요.",
  },
  {
    kind: "notice", category: null, pinned: false,
    title: "취소 수수료 기준 안내",
    body: "취소 수수료는 국외여행 표준약관을 따라요. 출발 30일 전까지 무료, 29~20일 전 10%, 19~10일 전 15%, 9~8일 전 20%, 7~1일 전 30%, 당일 50%예요.",
  },
];

export const FAQS: SeedNotice[] = [
  { kind: "faq", category: "예약", pinned: false, title: "회원가입 없이 예약할 수 있나요?", body: "네. 비회원으로 예약할 때 조회 비밀번호(숫자 4~6자리)를 정하면, 예약번호·휴대폰 번호·조회 비밀번호로 예약을 확인하고 잔금 결제와 취소 신청을 할 수 있어요." },
  { kind: "faq", category: "예약", pinned: false, title: "출발 확정은 무슨 뜻인가요?", body: "상품마다 최소 출발 인원이 있어요. 예약금까지 낸 인원이 최소 인원을 넘으면 '출발 확정'이 되고, 그 출발일은 여행사 사정으로 취소되지 않아요." },
  { kind: "faq", category: "결제", pinned: false, title: "잔금은 언제까지 내야 하나요?", body: "출발 7일 전까지 내 주세요. 마이페이지(비회원은 예약 조회) 예약 상세에서 바로 결제할 수 있어요." },
  { kind: "faq", category: "취소", pinned: false, title: "취소하면 얼마를 돌려받나요?", body: "예약 상세의 '취소 신청'에서 지금 취소할 때의 수수료와 환불액을 먼저 보여 드려요. 수수료는 여행 요금 총액 기준이고, 낸 금액에서 수수료를 뺀 만큼 환불돼요." },
  { kind: "faq", category: "취소", pinned: false, title: "여행사 사정으로 출발이 취소되면요?", body: "최소 인원이 모이지 않아 출발이 취소되면 낸 금액 전액을 환불해 드리고 문자로 안내해 드려요." },
  { kind: "faq", category: "여권", pinned: false, title: "여권 정보는 언제 넣나요?", body: "예약할 때는 여권 영문 이름만 넣으면 돼요. 여권번호는 출발 전 담당자가 따로 확인해요. 누비투어는 여권번호를 저장하지 않아요." },
];
