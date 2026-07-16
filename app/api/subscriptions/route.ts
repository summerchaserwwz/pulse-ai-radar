import {
  assertProfileSchema,
  ensureUser,
  getDatabase,
  jsonResponse,
  resolveIdentity,
  sha256,
} from "../_lib/profile";

type SubscriptionRow = {
  id: string;
  user_id: string;
  email: string;
  status: string;
  rss_token_hash: string;
  updated_at: number;
};

const CONFIRMATION_COOLDOWN_MS = 10 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 60 * 1000;

async function consumeRateLimit(
  db: D1Database,
  key: string,
  scope: "email" | "ip",
  maximum: number,
) {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const row = await db
    .prepare(
      `INSERT INTO subscription_rate_limits
         (key, scope, window_start, request_count, updated_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         window_start = CASE
           WHEN subscription_rate_limits.window_start <= ? THEN excluded.window_start
           ELSE subscription_rate_limits.window_start
         END,
         request_count = CASE
           WHEN subscription_rate_limits.window_start <= ? THEN 1
           ELSE subscription_rate_limits.request_count + 1
         END,
         updated_at = excluded.updated_at
       RETURNING request_count`,
    )
    .bind(key, scope, now, now, cutoff, cutoff)
    .first<{ request_count: number }>();
  return (row?.request_count ?? maximum + 1) <= maximum;
}

function validTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      email?: unknown;
      timezone?: unknown;
      digestHour?: unknown;
    };
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
      return Response.json({ error: "邮箱格式无效" }, { status: 400 });
    }
    const requestedTimezone =
      typeof payload.timezone === "string" && payload.timezone.length <= 64
        ? payload.timezone
        : "Asia/Shanghai";
    if (!validTimeZone(requestedTimezone)) {
      return Response.json({ error: "时区无效" }, { status: 400 });
    }
    const timezone = requestedTimezone;
    const digestHour =
      typeof payload.digestHour === "number" &&
      Number.isInteger(payload.digestHour) &&
      payload.digestHour >= 0 &&
      payload.digestHour <= 23
        ? payload.digestHour
        : 8;

    const db = getDatabase();
    await assertProfileSchema(db);
    const identity = await resolveIdentity(request);
    await ensureUser(db, identity);
    const clientAddress = (request.headers.get("cf-connecting-ip") ?? "unknown").trim();
    const [emailAllowed, ipAllowed] = await Promise.all([
      consumeRateLimit(db, `email:${await sha256(email)}`, "email", 3),
      consumeRateLimit(db, `ip:${await sha256(clientAddress)}`, "ip", 20),
    ]);
    if (!emailAllowed || !ipAllowed) {
      return Response.json(
        { error: "订阅请求过于频繁，请稍后再试" },
        { status: 429, headers: { "retry-after": "3600" } },
      );
    }
    const rssToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const rssTokenHash = await sha256(rssToken);
    const now = Date.now();
    const [byEmail, byUser] = await Promise.all([
      db
        .prepare(
          `SELECT id, user_id, email, status, rss_token_hash, updated_at
           FROM subscriptions WHERE email = ?`,
        )
        .bind(email)
        .first<SubscriptionRow>(),
      db
        .prepare(
          `SELECT id, user_id, email, status, rss_token_hash, updated_at
           FROM subscriptions WHERE user_id = ?`,
        )
        .bind(identity.id)
        .first<SubscriptionRow>(),
    ]);

    if (
      byEmail?.status === "pending" &&
      now - byEmail.updated_at < CONFIRMATION_COOLDOWN_MS
    ) {
      return Response.json(
        { error: "确认邮件已安排发送，请稍后再试" },
        { status: 429, headers: { "retry-after": "600" } },
      );
    }

    const currentConfirmed = byEmail?.status === "active" && byEmail.user_id === identity.id;
    const target = byEmail ?? byUser;
    const id = target?.id ?? `sub:${identity.id}`;
    const ownerId = target?.user_id ?? identity.id;
    const nextStatus = currentConfirmed ? "active" : "pending";

    if (target) {
      const statements = [
        db
          .prepare(
            `UPDATE subscriptions
             SET email = ?, timezone = ?, digest_hour = ?, status = ?, rss_token_hash = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(email, timezone, digestHour, nextStatus, rssTokenHash, now, id),
      ];
      if (byEmail && byUser && byEmail.id !== byUser.id) {
        statements.push(
          db
            .prepare(
              `UPDATE subscriptions SET status = 'unsubscribed', updated_at = ? WHERE id = ?`,
            )
            .bind(now, byUser.id),
        );
      }
      await db.batch(statements);
    } else {
      await db
        .prepare(
          `INSERT INTO subscriptions
             (id, user_id, email, timezone, digest_hour, status, rss_token_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .bind(id, ownerId, email, timezone, digestHour, rssTokenHash, now, now)
        .run();
    }

    return jsonResponse(
      request,
      identity,
      {
        subscription: {
          email,
          status: nextStatus,
          rssPath: `/rss.xml?token=${rssToken}`,
          message: currentConfirmed
            ? "日报设置已更新，私有 RSS 令牌已轮换。"
            : "订阅已保存；请查收确认邮件。演示环境不会执行真实投递。",
        },
      },
      { status: 201 },
      rssToken,
    );
  } catch {
    const requestId = crypto.randomUUID();
    return Response.json(
      { error: "订阅保存失败", requestId },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
}
