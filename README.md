# 누비투어

패키지여행 예약 사이트(시연용 가상 여행사). 손님 화면, 직원 관리 화면, 외부 시스템용 API를 갖춘 독립 서비스다.

- 설계: [docs/superpowers/specs/2026-11-17-nubi-tour-design.md](docs/superpowers/specs/2026-11-17-nubi-tour-design.md)
- 기본 브랜치 `dev`. `dev`·`main`에는 PR로만 올린다.

> 시연용 가상 여행사입니다. 실제 여행 상품을 팔지 않으며 결제는 테스트 모드로만 동작합니다.

## 만든 것

- 손님 화면: 상품 검색·출발일 달력, 예약(회원·비회원), 예약금·잔금 결제(토스 테스트 또는 모의), 취소 신청(국외여행 표준약관 수수료), 마이페이지, 고객센터
- 직원 화면 `/admin`: 대시보드, 예약·취소 승인, 상품·출발일, 문의 답변, 직원·API 키·작업 기록
- 외부 시스템용 API `/api/v1` (API 키, 개인정보 가림) — 설명 `/api/v1/openapi.json`
- 주기 작업: 결제 기한 만료, 출발 확정, 여행 완료, 잔금 안내

## 개발

```bash
cp .env.example .env            # DATABASE_URL을 로컬 PostgreSQL로
npm ci
npx prisma migrate deploy
npm run db:seed
npm run dev
```

시험: `npm test`(DB 필요), `npm run e2e`(빌드한 앱 + 시드). CI가 PR마다 web·e2e·docker 잡을 돌린다.

## 배포

[docs/deploy.md](docs/deploy.md) — 온프레미스 서버에 Docker Compose로 올리는 순서.
