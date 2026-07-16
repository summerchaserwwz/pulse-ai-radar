import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { requestAbsoluteUrl } from "./request-origin";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const canonicalUrl = await requestAbsoluteUrl("/");
  const socialImage = await requestAbsoluteUrl("/og.png");

  return {
    title: {
      default: "PULSE/AI · 个人 AI 情报雷达",
      template: "%s · PULSE/AI",
    },
    description:
      "为 AI 从业者聚合全球高信号信息，自动生成中文摘要、事件证据链与个性化速报。",
    applicationName: "PULSE/AI",
    keywords: ["AI 情报", "AI 新闻", "人工智能", "RSS", "AI Radar"],
    alternates: { canonical: canonicalUrl },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      url: canonicalUrl,
      locale: "zh_CN",
      siteName: "PULSE/AI",
      title: "PULSE/AI · 个人 AI 情报雷达",
      description: "全球信号，中文摘要，证据优先。",
      images: [
        {
          url: socialImage,
          width: 1200,
          height: 630,
          alt: "PULSE/AI 全球 AI 信号雷达",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "PULSE/AI · 个人 AI 情报雷达",
      description: "全球信号，中文摘要，证据优先。",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geist.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
