import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AX Startup — 지원사업 어시스턴트",
  description:
    "기업마당과 K-Startup의 수집 데이터를 바탕으로 기업 조건에 맞는 지원사업을 찾아보세요.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
