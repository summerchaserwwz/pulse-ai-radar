import type { RadarEnv, RadarEventRow } from "./contracts.ts";
import type { EventEvidenceRow } from "./repository.ts";

export type DigestEntry = {
  event: RadarEventRow;
  evidence: EventEvidenceRow[];
};

type ResendResponse = { id?: unknown; message?: unknown };

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildConfirmationHtml(input: {
  confirmUrl: string;
  unsubscribeUrl: string;
}) {
  return `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#101010;color:#f2f2f2;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:620px;margin:0 auto;padding:40px 24px">
    <p style="margin:0 0 24px;color:#00d992;font:600 12px/16px SFMono-Regular,Menlo,monospace;letter-spacing:1.8px">PULSE/AI · 订阅确认</p>
    <h1 style="margin:0 0 16px;font-size:28px;line-height:36px;font-weight:500">确认你的个人 AI 情报日报</h1>
    <p style="margin:0 0 24px;color:#bdbdbd;font-size:15px;line-height:24px">确认后，我们会根据你在网站保存的兴趣与反馈，于本地时间每天 08:00 发送同一套个性化排序结果。</p>
    <a href="${escapeHtml(input.confirmUrl)}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#00d992;color:#101010;text-decoration:none;font-weight:700">确认订阅</a>
    <p style="margin:28px 0 0;color:#8b949e;font-size:12px;line-height:19px">如果这不是你的操作，可直接忽略，或<a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#bdbdbd">取消订阅</a>。</p>
  </div>
</body></html>`;
}

export function buildDigestHtml(input: {
  entries: DigestEntry[];
  localDate: string;
  interests: string[];
  unsubscribeUrl: string;
  appOrigin: string;
}) {
  if (input.entries.some((entry) => entry.evidence.length === 0)) {
    throw new Error("日报事件缺少原始证据链接");
  }
  const cards = input.entries
    .map(({ event, evidence }, index) => {
      const links = evidence
        .map((item) => {
          const href = safeHttpUrl(item.canonical_url);
          if (!href) return "";
          return `<a href="${escapeHtml(href)}" style="display:inline-block;margin:0 10px 6px 0;color:#bdbdbd;font-size:12px;line-height:18px">${escapeHtml(item.source_name)} ↗</a>`;
        })
        .filter(Boolean)
        .join("");
      if (!links) throw new Error(`日报事件 ${event.id} 缺少有效 HTTPS/HTTP 来源`);
      return `<section style="padding:22px 0;border-top:1px solid #3d3a39">
        <div style="margin-bottom:10px;color:#8b949e;font:500 11px/16px SFMono-Regular,Menlo,monospace">${String(index + 1).padStart(2, "0")} · 趋势 ${event.trend_score} · ${escapeHtml(event.status)}</div>
        <h2 style="margin:0 0 10px;color:#f2f2f2;font-size:19px;line-height:28px;font-weight:600">${escapeHtml(event.title_zh)}</h2>
        <p style="margin:0 0 10px;color:#bdbdbd;font-size:14px;line-height:23px">${escapeHtml(event.summary_zh)}</p>
        <p style="margin:0 0 14px;color:#f2f2f2;font-size:13px;line-height:21px"><strong style="color:#00d992">为什么重要：</strong>${escapeHtml(event.why_it_matters)}</p>
        <div>${links}</div>
      </section>`;
    })
    .join("");

  const appUrl = safeHttpUrl(input.appOrigin) ?? "https://example.invalid";
  return `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#101010;color:#f2f2f2;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:680px;margin:0 auto;padding:36px 24px">
    <p style="margin:0 0 12px;color:#00d992;font:600 12px/16px SFMono-Regular,Menlo,monospace;letter-spacing:1.8px">PULSE/AI · DAILY BRIEF · ${escapeHtml(input.localDate)}</p>
    <h1 style="margin:0 0 10px;font-size:28px;line-height:36px;font-weight:500">今天值得你关注的 AI 变化</h1>
    <p style="margin:0 0 28px;color:#8b949e;font-size:13px;line-height:21px">关注：${escapeHtml(input.interests.slice(0, 8).join("、") || "全球 AI 高信号")}</p>
    ${cards}
    <footer style="padding-top:22px;border-top:1px solid #3d3a39;color:#8b949e;font-size:12px;line-height:20px">
      <a href="${escapeHtml(appUrl)}" style="color:#bdbdbd">打开个人雷达</a>
      <span style="margin:0 8px">·</span>
      <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:#bdbdbd">取消订阅</a>
      <p>摘要由自动化管线生成；关键判断请以每条原始来源为准。</p>
    </footer>
  </div>
</body></html>`;
}

function requireEmailConfiguration(env: RadarEnv) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY 未配置");
  if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM 未配置");
  return { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM };
}

export async function sendResendEmail(
  env: RadarEnv,
  input: {
    to: string;
    subject: string;
    html: string;
    idempotencyKey: string;
    emailHeaders?: Record<string, string>;
  },
) {
  const configuration = requireEmailConfiguration(env);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${configuration.apiKey}`,
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
      "user-agent": "PULSE-AI-Radar/1.0",
    },
    body: JSON.stringify({
      from: configuration.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      headers: input.emailHeaders,
    }),
  });

  let payload: ResendResponse = {};
  try {
    payload = (await response.json()) as ResendResponse;
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const detail = typeof payload.message === "string" ? payload.message.slice(0, 200) : "unknown";
    throw new Error(`Resend 请求失败 (${response.status}): ${detail}`);
  }
  if (typeof payload.id !== "string" || !payload.id) {
    throw new Error("Resend 未返回 delivery id");
  }
  return payload.id;
}
