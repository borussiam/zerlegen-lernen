import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "zerlegen lernen — 독일어를 조각내어 배우기",
  description: "독일어 단어의 형태소, 어원과 관사를 탐색하는 학습 도구",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
