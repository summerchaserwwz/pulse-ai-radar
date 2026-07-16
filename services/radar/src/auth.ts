import type { RadarEnv } from "./contracts.ts";

export type SubscriptionAction = "confirm" | "unsubscribe";
type SigningEnv = Pick<RadarEnv, "AUTH_SIGNING_KEY">;

type ActionPayload = {
  subscriptionId: string;
  action: SubscriptionAction;
  revision: number;
  expiresAt: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return new Uint8Array(signature);
}

function validPayload(value: unknown): value is ActionPayload {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.subscriptionId === "string" &&
    record.subscriptionId.length > 0 &&
    record.subscriptionId.length <= 160 &&
    (record.action === "confirm" || record.action === "unsubscribe") &&
    typeof record.revision === "number" &&
    Number.isSafeInteger(record.revision) &&
    typeof record.expiresAt === "number" &&
    Number.isFinite(record.expiresAt)
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}

export function requireSigningKey(env: SigningEnv) {
  if (!env.AUTH_SIGNING_KEY || env.AUTH_SIGNING_KEY.length < 32) {
    throw new Error("AUTH_SIGNING_KEY 未配置或长度不足 32 字符");
  }
  return env.AUTH_SIGNING_KEY;
}

export async function signSubscriptionAction(
  env: SigningEnv,
  input: {
    subscriptionId: string;
    action: SubscriptionAction;
    revision: number;
    expiresAt?: number;
  },
) {
  const payload: ActionPayload = {
    subscriptionId: input.subscriptionId,
    action: input.action,
    revision: input.revision,
    expiresAt: input.expiresAt ?? Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await hmac(requireSigningKey(env), encodedPayload));
  return `${encodedPayload}.${signature}`;
}

export async function verifySubscriptionAction(
  env: SigningEnv,
  token: string,
  expectedAction: SubscriptionAction,
) {
  if (!token || token.length > 1200) return null;
  const [encodedPayload, encodedSignature, extra] = token.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;

  try {
    const suppliedSignature = base64UrlDecode(encodedSignature);
    const expectedSignature = await hmac(requireSigningKey(env), encodedPayload);
    if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;

    const parsed: unknown = JSON.parse(decoder.decode(base64UrlDecode(encodedPayload)));
    if (!validPayload(parsed)) return null;
    if (parsed.action !== expectedAction || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
