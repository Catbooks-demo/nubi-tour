import type { Metadata } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "누비투어 — 패키지여행", template: "%s | 누비투어" },
  description: "일본·동남아·유럽·미주 패키지여행 예약. 시연용 가상 여행사입니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
