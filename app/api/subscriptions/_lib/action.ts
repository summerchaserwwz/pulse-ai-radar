import { env } from "cloudflare:workers";
import { verifySubscriptionAction, type SubscriptionAction } from "@/services/radar/src/auth";
import {
  appendIdentityCookies,
  assertProfileSchema,
  getDatabase,
  resolveIdentity,
  sha256,
} from "../../_lib/profile";

async function redirectState(
  request: Request,
  state: "confirmed" | "unsubscribed" | "invalid",
  session?: { userId: string; email: string; rssToken: string },
) {
  const url = new URL("/", request.url);
  url.searchParams.set("subscription", state);
  const headers = new Headers({ location: url.toString(), "cache-control": "no-store" });
  if (session) {
    await appendIdentityCookies(
      headers,
      request,
      {
        id: session.userId,
        email: session.email,
        userCookie: session.userId,
        rssToken: null,
      },
      session.rssToken,
    );
  }
  return new Response(null, { status: 303, headers });
}

export async function handleSubscriptionAction(
  request: Request,
  action: SubscriptionAction,
) {
  const url = new URL(request.url);
  let token = url.searchParams.get("token") ?? "";
  if (request.method === "POST" && !token) {
    try {
      const form = await request.formData();
      const value = form.get("token");
      token = typeof value === "string" ? value : "";
    } catch {
      token = "";
    }
  }
  const payload = await verifySubscriptionAction(
    { AUTH_SIGNING_KEY: env.AUTH_SIGNING_KEY },
    token,
    action,
  );
  if (!payload) return redirectState(request, "invalid");

  if (request.method === "GET") {
    const label = action === "confirm" ? "确认订阅" : "取消订阅";
    const description =
      action === "confirm"
        ? "确认后，每天 08:00 接收与你兴趣一致的 AI 情报日报，并启用私有 RSS。"
        : "提交后将停止后续邮件与私有 RSS 更新。";
    const safeToken = token.replace(/[^A-Za-z0-9._-]/g, "");
    return new Response(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${label} · PULSE/AI</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#101010;color:#f2f2f2;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><main style="width:min(520px,calc(100% - 32px));padding:28px;border:1px solid #3d3a39;border-radius:8px;background:#141414"><p style="margin:0 0 18px;color:#00d992;font:600 12px/18px monospace;letter-spacing:1.6px">PULSE/AI</p><h1 style="margin:0 0 12px;font-size:26px;font-weight:500">${label}</h1><p style="margin:0 0 24px;color:#bdbdbd;line-height:1.7">${description}</p><form method="post"><input type="hidden" name="token" value="${safeToken}"><button type="submit" style="min-height:44px;padding:0 18px;border:0;border-radius:6px;background:#00d992;color:#101010;font:700 14px sans-serif;cursor:pointer">${label}</button></form></main></body></html>`,
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      },
    );
  }

  try {
    const db = getDatabase();
    await assertProfileSchema(db);
    const row = await db
      .prepare(
        `SELECT user_id, email, status, updated_at
         FROM subscriptions WHERE id = ? AND updated_at = ?`,
      )
      .bind(payload.subscriptionId, payload.revision)
      .first<{ user_id: string; email: string; status: string; updated_at: number }>();
    if (!row) return redirectState(request, "invalid");

    const revision = Math.max(Date.now(), payload.revision + 1);
    if (action === "unsubscribe") {
      const result = await db
        .prepare(
          `UPDATE subscriptions SET status = 'unsubscribed', updated_at = ?
           WHERE id = ? AND updated_at = ?`,
        )
        .bind(revision, payload.subscriptionId, payload.revision)
        .run();
      if ((result.meta?.changes ?? 0) !== 1) return redirectState(request, "invalid");
      return redirectState(request, "unsubscribed");
    }

    const currentIdentity = await resolveIdentity(request);
    const rssToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const rssTokenHash = await sha256(rssToken);
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE subscriptions
           SET status = 'active', rss_token_hash = ?, updated_at = ?
           WHERE id = ? AND updated_at = ?`,
        )
        .bind(rssTokenHash, revision, payload.subscriptionId, payload.revision),
      db
        .prepare(
          `UPDATE users SET email = ?, updated_at = ?
           WHERE id = ? AND EXISTS (
             SELECT 1 FROM subscriptions
             WHERE id = ? AND status = 'active' AND updated_at = ?
           )`,
        )
        .bind(row.email, revision, row.user_id, payload.subscriptionId, revision),
    ];

    if (currentIdentity.id !== row.user_id) {
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO interests (user_id, kind, value, weight, created_at)
             SELECT ?, kind, value, weight, created_at FROM interests
             WHERE user_id = ? AND EXISTS (
               SELECT 1 FROM subscriptions
               WHERE id = ? AND status = 'active' AND updated_at = ?
             )`,
          )
          .bind(row.user_id, currentIdentity.id, payload.subscriptionId, revision),
        db
          .prepare(
            `INSERT OR IGNORE INTO feedback
               (id, user_id, signal_id, action, active, created_at, updated_at)
             SELECT ? || ':' || signal_id || ':' || action, ?, signal_id, action, active, created_at, updated_at
             FROM feedback
             WHERE user_id = ? AND EXISTS (
               SELECT 1 FROM subscriptions
               WHERE id = ? AND status = 'active' AND updated_at = ?
             )`,
          )
          .bind(row.user_id, row.user_id, currentIdentity.id, payload.subscriptionId, revision),
      );
    }

    const results = await db.batch(statements);
    if ((results[0]?.meta?.changes ?? 0) !== 1) return redirectState(request, "invalid");
    return redirectState(request, "confirmed", {
      userId: row.user_id,
      email: row.email,
      rssToken,
    });
  } catch {
    return redirectState(request, "invalid");
  }
}
