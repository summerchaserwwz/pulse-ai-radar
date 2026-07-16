import { env } from "cloudflare:workers";

export const DEFAULT_INTERESTS = ["基础模型", "Agent", "AI Coding", "开源模型"];
const USER_COOKIE = "pulse_uid";
const RSS_COOKIE = "pulse_rss";
const IDENTITY_COOKIE_VERSION = "v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type Profile = {
  interests: string[];
  bookmarks: string[];
  tracked: string[];
  hidden: string[];
  autoTranslate: boolean;
  verifiedOnly: boolean;
  denseMode: boolean;
  instantAlerts: boolean;
  subscriptionEmail: string;
  subscriptionStatus: string;
  rssPath: string | null;
};

export type Identity = {
  id: string;
  email: string | null;
  userCookie: string | null;
  rssToken: string | null;
};

type UserRow = {
  auto_translate: number;
  verified_only: number;
  dense_mode: number;
  instant_alerts: number;
};

type InterestRow = { value: string };
type FeedbackRow = { signal_id: string; action: string };
type SubscriptionRow = { email: string; status: string; rss_token_hash: string };

export function getDatabase() {
  if (!env.DB) throw new Error("D1 binding DB 未配置");
  return env.DB;
}

function parseCookies(request: Request) {
  const values = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key) values.set(key, decodeURIComponent(value));
  }
  return values;
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("身份 Cookie 编码无效");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validIdentityId(value: string) {
  return /^(?:anon:[a-f0-9-]{36}|email:[a-f0-9]{32})$/.test(value);
}

async function identitySigningKey() {
  if (!env.AUTH_SIGNING_KEY || env.AUTH_SIGNING_KEY.length < 32) {
    throw new Error("AUTH_SIGNING_KEY 未配置或长度不足 32 字符");
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(env.AUTH_SIGNING_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signIdentityCookie(id: string) {
  if (!validIdentityId(id)) throw new Error("身份标识格式无效");
  const encodedId = base64UrlEncode(encoder.encode(id));
  const signedValue = `${USER_COOKIE}\0${IDENTITY_COOKIE_VERSION}.${encodedId}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await identitySigningKey(),
    encoder.encode(signedValue),
  );
  return `${IDENTITY_COOKIE_VERSION}.${encodedId}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyIdentityCookie(value: string) {
  if (!value || value.length > 512) return null;
  const [version, encodedId, encodedSignature, extra] = value.split(".");
  if (
    version !== IDENTITY_COOKIE_VERSION ||
    !encodedId ||
    !encodedSignature ||
    extra
  ) {
    return null;
  }

  try {
    const signedValue = `${USER_COOKIE}\0${version}.${encodedId}`;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await identitySigningKey(),
      base64UrlDecode(encodedSignature),
      encoder.encode(signedValue),
    );
    if (!valid) return null;
    const id = decoder.decode(base64UrlDecode(encodedId));
    return validIdentityId(id) ? id : null;
  } catch {
    return null;
  }
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function resolveIdentity(request: Request): Promise<Identity> {
  const cookies = parseCookies(request);
  const forwardedEmail = request.headers
    .get("oai-authenticated-user-email")
    ?.trim()
    .toLowerCase();
  const existing = cookies.get(USER_COOKIE);
  const validStoredId = existing ? await verifyIdentityCookie(existing) : null;
  const id = forwardedEmail
    ? `email:${(await sha256(forwardedEmail)).slice(0, 32)}`
    : validStoredId ?? `anon:${crypto.randomUUID()}`;

  return {
    id,
    email: forwardedEmail ?? null,
    userCookie: forwardedEmail || validStoredId ? null : id,
    rssToken: cookies.get(RSS_COOKIE) ?? null,
  };
}

export async function appendIdentityCookies(
  headers: Headers,
  request: Request,
  identity: Identity,
  nextRssToken?: string,
) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  if (identity.userCookie) {
    const signedIdentity = await signIdentityCookie(identity.userCookie);
    headers.append(
      "Set-Cookie",
      `${USER_COOKIE}=${encodeURIComponent(signedIdentity)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
    );
  }
  if (nextRssToken) {
    headers.append(
      "Set-Cookie",
      `${RSS_COOKIE}=${encodeURIComponent(nextRssToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`,
    );
  }
}

export async function assertProfileSchema(db: D1Database) {
  try {
    await db.prepare(`SELECT id FROM users LIMIT 1`).first<{ id: string }>();
  } catch {
    throw new Error("D1 migration 尚未应用");
  }
}

export async function ensureUser(db: D1Database, identity: Identity) {
  const now = Date.now();
  if (identity.email) {
    const existing = await db
      .prepare(`SELECT id FROM users WHERE email = ?`)
      .bind(identity.email)
      .first<{ id: string }>();
    if (existing?.id) {
      identity.id = existing.id;
      await db
        .prepare(`UPDATE users SET updated_at = ? WHERE id = ?`)
        .bind(now, existing.id)
        .run();
      return;
    }
  }
  await db
    .prepare(
      `INSERT INTO users (id, email, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = COALESCE(excluded.email, users.email), updated_at = excluded.updated_at`,
    )
    .bind(identity.id, identity.email, now, now)
    .run();
}

export async function loadProfile(request: Request) {
  const db = getDatabase();
  await assertProfileSchema(db);
  const identity = await resolveIdentity(request);
  await ensureUser(db, identity);

  return { db, identity, profile: await readProfile(db, identity) };
}

export async function readProfile(db: D1Database, identity: Identity) {

  const [user, interestResult, feedbackResult, subscription] = await Promise.all([
    db
      .prepare(
        `SELECT auto_translate, verified_only, dense_mode, instant_alerts
         FROM users WHERE id = ?`,
      )
      .bind(identity.id)
      .first<UserRow>(),
    db
      .prepare(`SELECT value FROM interests WHERE user_id = ? ORDER BY weight DESC, id ASC`)
      .bind(identity.id)
      .all<InterestRow>(),
    db
      .prepare(`SELECT signal_id, action FROM feedback WHERE user_id = ? AND active = 1`)
      .bind(identity.id)
      .all<FeedbackRow>(),
    db
      .prepare(`SELECT email, status, rss_token_hash FROM subscriptions WHERE user_id = ?`)
      .bind(identity.id)
      .first<SubscriptionRow>(),
  ]);

  const actions = feedbackResult.results ?? [];
  let rssPath: string | null = null;
  if (
    subscription &&
    identity.rssToken &&
    (subscription.status === "active" || subscription.status === "rss_only")
  ) {
    const cookieHash = await sha256(identity.rssToken);
    if (cookieHash === subscription.rss_token_hash) {
      rssPath = `/rss.xml?token=${encodeURIComponent(identity.rssToken)}`;
    }
  }

  const profile: Profile = {
    interests:
      interestResult.results && interestResult.results.length > 0
        ? interestResult.results.map((row) => row.value)
        : DEFAULT_INTERESTS,
    bookmarks: actions.filter((row) => row.action === "bookmark").map((row) => row.signal_id),
    tracked: actions.filter((row) => row.action === "track").map((row) => row.signal_id),
    hidden: actions.filter((row) => row.action === "hide").map((row) => row.signal_id),
    autoTranslate: user?.auto_translate !== 0,
    verifiedOnly: user?.verified_only === 1,
    denseMode: user?.dense_mode !== 0,
    instantAlerts: user?.instant_alerts !== 0,
    subscriptionEmail: subscription?.email ?? "",
    subscriptionStatus: subscription?.status ?? "none",
    rssPath,
  };

  return profile;
}

export async function jsonResponse(
  request: Request,
  identity: Identity,
  data: unknown,
  init?: ResponseInit,
  nextRssToken?: string,
) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  await appendIdentityCookies(headers, request, identity, nextRssToken);
  return new Response(JSON.stringify(data), { ...init, headers });
}
