import {
  assertProfileSchema,
  ensureUser,
  getDatabase,
  jsonResponse,
  resolveIdentity,
} from "../_lib/profile";

const allowedActions = new Set(["bookmark", "track", "hide", "less_like"]);

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      signalId?: unknown;
      action?: unknown;
      active?: unknown;
    };
    const signalId = typeof payload.signalId === "string" ? payload.signalId.trim() : "";
    const action = typeof payload.action === "string" ? payload.action.trim() : "";
    if (!signalId || signalId.length > 100 || !allowedActions.has(action)) {
      return Response.json({ error: "反馈参数无效" }, { status: 400 });
    }

    const db = getDatabase();
    await assertProfileSchema(db);
    const identity = await resolveIdentity(request);
    await ensureUser(db, identity);
    const now = Date.now();
    await db
      .prepare(
        `INSERT INTO feedback (id, user_id, signal_id, action, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, signal_id, action)
         DO UPDATE SET active = excluded.active, updated_at = excluded.updated_at`,
      )
      .bind(
        `${identity.id}:${signalId}:${action}`,
        identity.id,
        signalId,
        action,
        payload.active === false ? 0 : 1,
        now,
        now,
      )
      .run();

    return jsonResponse(request, identity, { saved: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "反馈保存失败" },
      { status: 503 },
    );
  }
}
