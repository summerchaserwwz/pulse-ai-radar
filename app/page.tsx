import type { Metadata } from "next";
import RadarApp from "./RadarApp";

export const metadata: Metadata = {
  title: "今日信号",
  description:
    "面向 AI 从业者的个人情报雷达：全球信号、中文摘要、证据追踪与个性化速报。",
};

export default function Home() {
  return <RadarApp />;
}
