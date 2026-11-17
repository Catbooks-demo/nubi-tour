-- 직원이 직접 마감한 출발일 표시
ALTER TABLE "departures" ADD COLUMN "manual_closed" BOOLEAN NOT NULL DEFAULT false;
