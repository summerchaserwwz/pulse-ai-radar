import type { RadarEnv } from "./contracts.ts";
import { personalizedEntries } from "./pipeline.ts";
import { stableHash } from "./quality.ts";
import { getActiveSubscriptionByTokenHash } from "./repository.ts";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function privateRssResponse(env: RadarEnv, request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token || token.length > 160) return new Response("RSS 令牌无效", { status: 401 });
  const subscription = await getActiveSubscriptionByTokenHash(env, await stableHash(token));
  if (!subscription) return new Response("RSS 令牌无效或订阅尚未确认", { status: 401 });

  const entries = await personalizedEntries(env, subscription.user_id, 20);
  const items = entries
    .map(({ event, evidence }) => {
      if (evidence.length === 0) return "";
      const links = evidence
        .map(
          (source) =>
            `<li><a href="${escapeXml(source.canonical_url)}">${escapeXml(source.source_name)}</a></li>`,
        )
        .join("");
      const description = `<p>${escapeXml(event.summary_zh)}</p><p><strong>为什么重要：</strong>${escapeXml(event.why_it_matters)}</p><p><strong>状态：</strong>${escapeXml(event.status)} · 置信度 ${event.confidence}%</p><ul>${links}</ul>`;
      return `<item>
        <guid isPermaLink="false">pulse:${escapeXml(event.id)}</guid>
        <title>${escapeXml(event.title_zh)}</title>
        <link>${escapeXml(evidence[0].canonical_url)}</link>
        <pubDate>${new Date(event.published_at).toUTCString()}</pubDate>
        <description><![CDATA[${description}]]></description>
      </item>`;
    })
    .filter(Boolean)
    .join("\n");
  const self = `${url.origin}${url.pathname}?token=${encodeURIComponent(token)}`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>PULSE/AI · 个人 AI 情报雷达</title>
    <link>${escapeXml(env.APP_ORIGIN ?? url.origin)}</link>
    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml" />
    <description>根据你的兴趣与反馈生成的全球 AI 信号中文摘要和原始证据。</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${items}
  </channel>
</rss>`;
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
