import {
  DEFAULT_INTERESTS,
  assertProfileSchema,
  ensureUser,
  getDatabase,
  jsonResponse,
  loadProfile,
  readProfile,
  resolveIdentity,
} from "../_lib/profile";

type UpdatePayload = {
  interests?: unknown;
  bookmarks?: unknown;
  tracked?: unknown;
  hidden?: unknown;
  autoTranslate?: unknown;
  verifiedOnly?: unknown;
  denseMode?: unknown;
  instantAlerts?: unknown;
};

function stringList(value: unknown, fallback: string[], maxItems = 50) {
  if (!Array.isArray(value)) return fallback;
  const sanitized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 80)
    .slice(0, maxItems);
  return Array.from(new Set(sanitized));
}

export async function GET(request: Request) {
  try {
    const { identity, profile } = await loadProfile(request);
    return jsonResponse(request, identity, { profile });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "偏好读取失败" },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as UpdatePayload;
    const db = getDatabase();
    await assertProfileSchema(db);
    const identity = await resolveIdentity(request);
    await ensureUser(db, identity);

    const interests = stringList(payload.interests, DEFAULT_INTERESTS, 30);
    const bookmarks = stringList(payload.bookmarks, [], 100);
    const tracked = stringList(payload.tracked, [], 100);
    const hidden = stringList(payload.hidden, [], 100);
    const now = Date.now();
    const statements: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE users SET auto_translate = ?, verified_only = ?, dense_mode = ?, instant_alerts = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(
          payload.autoTranslate === false ? 0 : 1,
          payload.verifiedOnly === true ? 1 : 0,
          payload.denseMode === false ? 0 : 1,
          payload.instantAlerts === false ? 0 : 1,
          now,
          identity.id,
        ),
      db.prepare(`DELETE FROM interests WHERE user_id = ?`).bind(identity.id),
      db
        .prepare(
          `DELETE FROM feedback WHERE user_id = ? AND action IN ('bookmark', 'track', 'hide')`,
        )
        .bind(identity.id),
    ];

    for (const interest of interests) {
      statements.push(
        db
          .prepare(
            `INSERT INTO interests (user_id, kind, value, weight, created_at) VALUES (?, 'topic', ?, 100, ?)`,
          )
          .bind(identity.id, interest, now),
      );
    }

    for (const [action, ids] of [
      ["bookmark", bookmarks],
      ["track", tracked],
      ["hide", hidden],
    ] as const) {
      for (const signalId of ids) {
        statements.push(
          db
            .prepare(
              `INSERT INTO feedback (id, user_id, signal_id, action, active, created_at, updated_at)
               VALUES (?, ?, ?, ?, 1, ?, ?)`,
            )
            .bind(
              `${identity.id}:${signalId}:${action}`,
              identity.id,
              signalId,
              action,
              now,
              now,
            ),
        );
      }
    }

    await db.batch(statements);
    const profile = await readProfile(db, identity);
    return jsonResponse(request, identity, { profile, saved: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "偏好保存失败" },
      { status: 400 },
    );
  }
}
