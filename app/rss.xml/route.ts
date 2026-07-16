import { env } from "cloudflare:workers";
import { loadLiveSignals } from "@/app/api/_lib/radar";
import { personalizedSignals } from "@/shared/ranking";
import { signals } from "@/shared/signals";
import { DEFAULT_INTERESTS, assertProfileSchema, sha256 } from "../api/_lib/profile";

type SubscriptionLookup = { user_id: string; status: string };
type InterestLookup = { value: string };
type FeedbackLookup = { signal_id: string };
type UserLookup = { verified_only: number };

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  let interests = DEFAULT_INTERESTS;
  let hidden: string[] = [];
  let verifiedOnly = true;
  let inputSignals = signals;
  let demo = token === "preview";

  if (!demo) {
    if (!token || token.length > 160 || !env.DB) {
      return new Response("RSS 令牌无效", { status: 401 });
    }
    await assertProfileSchema(env.DB);
    const tokenHash = await sha256(token);
    const subscription = await env.DB
      .prepare(
        `SELECT user_id, status FROM subscriptions
         WHERE rss_token_hash = ? AND status IN ('active', 'rss_only')`,
      )
      .bind(tokenHash)
      .first<SubscriptionLookup>();
    if (!subscription) return new Response("RSS 令牌无效", { status: 401 });
    const [rows, feedback, user] = await Promise.all([
      env.DB
        .prepare(`SELECT value FROM interests WHERE user_id = ? ORDER BY weight DESC, id ASC`)
        .bind(subscription.user_id)
        .all<InterestLookup>(),
      env.DB
        .prepare(
          `SELECT signal_id FROM feedback
           WHERE user_id = ? AND action IN ('hide', 'less_like') AND active = 1`,
        )
        .bind(subscription.user_id)
        .all<FeedbackLookup>(),
      env.DB
        .prepare(`SELECT verified_only FROM users WHERE id = ?`)
        .bind(subscription.user_id)
        .first<UserLookup>(),
    ]);
    interests = rows.results?.map((row) => row.value) ?? DEFAULT_INTERESTS;
    hidden = feedback.results?.map((row) => row.signal_id) ?? [];
    verifiedOnly = user?.verified_only === 1;
    try {
      const liveSignals = await loadLiveSignals(env.DB, 50);
      if (liveSignals.length > 0) {
        inputSignals = liveSignals;
        demo = false;
      } else {
        demo = true;
      }
    } catch {
      demo = true;
    }
  }

  const selected = personalizedSignals(inputSignals, {
    interests,
    hidden,
    verifiedOnly,
    limit: 10,
  });
  const self = `${url.origin}/rss.xml?token=${encodeURIComponent(token)}`;
  const items = selected
    .map((signal) => {
      const sourceLinks = signal.sources
        .map(
          (source) =>
            `<li><a href="${escapeXml(source.url)}">${escapeXml(source.name)} · ${escapeXml(source.type)}</a></li>`,
        )
        .join("");
      const description = `<p>${escapeXml(signal.summary)}</p><p><strong>为什么重要：</strong>${escapeXml(signal.whyItMatters)}</p><p><strong>状态：</strong>${escapeXml(signal.status)} · ${signal.evidenceCount} 条证据${demo ? " · 历史公开样例" : ""}</p><ul>${sourceLinks}</ul>`;
      return `<item>
        <guid isPermaLink="false">pulse:${escapeXml(signal.id)}</guid>
        <title>${escapeXml(signal.title)}</title>
        <link>${escapeXml(signal.sources[0]?.url ?? url.origin)}</link>
        <pubDate>${new Date(signal.publishedAt).toUTCString()}</pubDate>
        <category>${escapeXml(signal.category)}</category>
        <description><![CDATA[${description}]]></description>
      </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>PULSE/AI · 个人 AI 情报雷达</title>
    <link>${escapeXml(url.origin)}</link>
    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml" />
    <description>根据你的兴趣生成的全球 AI 信号中文摘要与证据链接。</description>
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
