import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const basePath = rawBasePath && rawBasePath !== "/"
  ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

export const metadata: Metadata = {
  title: "비긋기",
  description: "집과 회사의 날씨, 강수 창, 이동하기 좋은 시간을 한눈에 확인하세요.",
  applicationName: "비긋기",
  manifest: `${basePath}/manifest.webmanifest`,
  icons: {
    icon: `${basePath}/icon.svg`,
  },
};

export const viewport: Viewport = {
  themeColor: "#10263f",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
