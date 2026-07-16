export type TrendInputs = {
  freshness: number;
  velocity: number;
  authority: number;
  corroboration: number;
  interestMatch: number;
};

export type EvidenceInput = {
  sourceId: string;
  hostname: string;
  official: boolean;
  authority: number;
};

const injectionPatterns = [
  /ignore (all|any|the)?\s*(previous|prior) instructions?/i,
  /reveal (the )?(system|developer) prompt/i,
  /you are now/i,
  /system message/i,
  /developer message/i,
  /忽略.{0,8}(之前|以上|先前).{0,8}(指令|要求|提示)/i,
  /输出.{0,8}(系统|开发者).{0,8}(提示|指令)/i,
];

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function computeTrendScore(inputs: TrendInputs) {
  const weighted =
    clamp01(inputs.freshness) * 0.35 +
    clamp01(inputs.velocity) * 0.25 +
    clamp01(inputs.authority) * 0.2 +
    clamp01(inputs.corroboration) * 0.15 +
    clamp01(inputs.interestMatch) * 0.05;
  return Math.round(weighted * 100);
}

export function assessConfidence(evidence: EvidenceInput[]) {
  const uniqueSources = new Set(evidence.map((item) => item.sourceId)).size;
  const uniqueHosts = new Set(evidence.map((item) => item.hostname)).size;
  const hasPrimary = evidence.some((item) => item.official && item.authority >= 85);
  const authority = evidence.length
    ? evidence.reduce((sum, item) => sum + clamp01(item.authority / 100), 0) /
      evidence.length
    : 0;

  let score = Math.round(authority * 55);
  if (hasPrimary) score += 30;
  if (uniqueSources >= 2 && uniqueHosts >= 2) score += 15;
  score = Math.min(100, score);

  const status = hasPrimary
    ? "已确认"
    : uniqueSources >= 2 && uniqueHosts >= 2
      ? "多源确认"
      : "待核实";
  return { score, status, hasPrimary, independentSources: uniqueHosts };
}

export function shouldQuarantine(input: {
  confidence: number;
  status: string;
  promptInjectionDetected: boolean;
  translationState: string;
}) {
  return (
    input.confidence < 55 ||
    input.status === "待核实" ||
    input.promptInjectionDetected ||
    input.translationState === "pending"
  );
}

export function containsPromptInjection(value: string) {
  return injectionPatterns.some((pattern) => pattern.test(value));
}

export function sanitizeUntrustedText(value: string, maxLength = 4000) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function canonicalizeUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  const removable = ["fbclid", "gclid", "mc_cid", "mc_eid", "ref", "source"];
  for (const key of Array.from(url.searchParams.keys())) {
    if (key.toLowerCase().startsWith("utm_") || removable.includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url.toString();
}

export function entityFingerprint(value: string) {
  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "for",
    "of",
    "in",
    "on",
    "with",
    "new",
    "发布",
    "推出",
    "宣布",
  ]);
  return Array.from(
    new Set(
      value
        .toLowerCase()
        .normalize("NFKC")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(" ")
        .filter((token) => token.length > 1 && !stopWords.has(token)),
    ),
  )
    .sort()
    .slice(0, 14)
    .join("|");
}

export async function stableHash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
