/** 외부 시스템용 API 설명 (OpenAPI 3.1). 경로를 더하면 여기도 같이 고친다(시험이 확인). */
const listParams = [
  { name: "updated_since", in: "query", schema: { type: "string", format: "date-time" }, description: "이 시각 이후 바뀐 것만" },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "앞 응답의 next_cursor" },
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
];
const list = (summary: string, extra: object[] = []) => ({
  get: {
    summary,
    security: [{ apiKey: [] }],
    parameters: [...listParams, ...extra],
    responses: {
      "200": { description: "`{data: [...], next_cursor: string|null}` — updated_at, id 오름차순" },
      "401": { description: "키 없음·틀림·폐기" },
      "403": { description: "범위 부족" },
      "429": { description: "키당 분당 600회 초과" },
    },
  },
});
const write = (summary: string, schema: object) => ({
  post: {
    summary,
    security: [{ apiKey: [] }],
    requestBody: { required: true, content: { "application/json": { schema } } },
    responses: { "200": { description: "`{ok: true}`" }, "403": { description: "write 범위 필요" }, "404": { description: "없음" } },
  },
});

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "누비투어 외부 시스템 API",
    version: "1.0.0",
    description:
      "정산·ERP 같은 외부 시스템이 예약 데이터를 읽고 일부를 처리하는 API. 키 범위: read(개인정보 가림), read_pii(개인정보 원문), write(문의 답변·예약 메모·출발일 상태·취소 결정). 여권번호는 어떤 범위로도 나가지 않는다. 금액은 원(정수), 시각은 UTC ISO 8601, 날짜(depart_date)는 한국 날짜.",
  },
  components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "직원 화면 › API 키에서 발급 (nbk_…)" } } },
  paths: {
    "/api/v1/tours": list("상품 목록"),
    "/api/v1/departures": list("출발일 목록", [
      { name: "product_code", in: "query", schema: { type: "string" } },
      { name: "from", in: "query", schema: { type: "string", format: "date" } },
    ]),
    "/api/v1/bookings": list("예약 목록 — 환불액 refunded_amount·마지막 환불 시각 refunded_at 포함 (status: pending_deposit, pending_full, deposit_paid, fully_paid, completed, cancel_requested, cancelled, expired)", [
      { name: "status", in: "query", schema: { type: "string" } },
    ]),
    "/api/v1/bookings/{code}": {
      get: {
        summary: "예약 하나",
        security: [{ apiKey: [] }],
        parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "`{data: booking}`" }, "404": { description: "없음" } },
      },
    },
    "/api/v1/bookings/{code}/memo": write("예약 내부 메모", { type: "object", required: ["memo"], properties: { memo: { type: "string", maxLength: 2000 } } }),
    "/api/v1/payments": list("결제·환불 목록 (kind: deposit, balance, full, refund)"),
    "/api/v1/cancellations": list("취소 목록 (status: requested, done, rejected)", [{ name: "status", in: "query", schema: { type: "string" } }]),
    "/api/v1/cancellations/{id}/decision": {
      post: {
        summary:
          "취소 요청 결정 (approve: 사이트 규칙 수수료대로 환불, refund_amount를 주면 그 금액으로·이때 reason 필요 / reject: reason 필요). 같은 결정 재전송은 같은 결과(replayed: true)",
        security: [{ apiKey: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["decision"],
                properties: {
                  decision: { enum: ["approve", "reject"] },
                  refund_amount: { type: "integer", minimum: 0 },
                  reason: { type: "string", maxLength: 500 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "`{id, booking_code, status, fee, refund_amount, decided_at, replayed}`" },
          "400": { description: "사유 없음·금액 오류" },
          "403": { description: "write 범위 필요" },
          "404": { description: "없음" },
          "409": { description: "취소 요청 상태가 아니거나 이미 다른 결정으로 처리됨 (ALREADY_DECIDED)" },
          "502": { description: "결정은 반영됐지만 결제사 환불 실패 (REFUND_FAILED)" },
        },
      },
    },
    "/api/v1/me": {
      get: {
        summary: "이 키의 이름·앞자리·범위 (쓰기 전에 write 범위 확인용)",
        security: [{ apiKey: [] }],
        responses: { "200": { description: "`{name, prefix, scopes}`" }, "401": { description: "키 없음·틀림·폐기" } },
      },
    },
    "/api/v1/inquiries": list("1:1 문의 목록 (status: open, answered)", [{ name: "status", in: "query", schema: { type: "string" } }]),
    "/api/v1/inquiries/{id}/answer": write("문의 답변", { type: "object", required: ["answer"], properties: { answer: { type: "string" } } }),
    "/api/v1/departures/{id}/status": write("출발일 상태 (open, confirmed, closed. 출발 취소는 직원 화면에서만)", {
      type: "object",
      required: ["status"],
      properties: { status: { enum: ["open", "confirmed", "closed"] } },
    }),
  },
} as const;
