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
};

function createToken() {
  return `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

export async function POST(request: Request) {
  try {
    const db = getDatabase();
    await assertProfileSchema(db);
    const identity = await resolveIdentity(request);
    await ensureUser(db, identity);

    const existing = await db
      .prepare(`SELECT id FROM subscriptions WHERE user_id = ?`)
      .bind(identity.id)
      .first<SubscriptionRow>();
    const rssToken = createToken();
    const rssTokenHash = await sha256(rssToken);
    const identityHash = (await sha256(identity.id)).slice(0, 32);
    const placeholderEmail = `rss-${identityHash}@pulse.invalid`;
    const now = Date.now();

    await db
      .prepare(
        `INSERT INTO subscriptions
           (id, user_id, email, timezone, digest_hour, status, rss_token_hash, created_at, updated_at)
         VALUES (?, ?, ?, 'Asia/Shanghai', 8, 'rss_only', ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           status = 'rss_only',
           rss_token_hash = excluded.rss_token_hash,
           updated_at = excluded.updated_at`,
      )
      .bind(`sub:${identity.id}`, identity.id, placeholderEmail, rssTokenHash, now, now)
      .run();

    return jsonResponse(
      request,
      identity,
      {
        rss: {
          status: "active",
          rssPath: `/rss.xml?token=${rssToken}`,
          message: existing ? "私有 RSS 地址已轮换" : "私有 RSS 已启用",
        },
      },
      { status: existing ? 200 : 201 },
      rssToken,
    );
  } catch {
    const requestId = crypto.randomUUID();
    return Response.json(
      { error: "RSS 地址生成失败", requestId },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
}
