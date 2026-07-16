import type { FeedItem, SourceDefinition } from "./contracts.ts";
import { canonicalizeUrl, sanitizeUntrustedText, stableHash } from "./quality.ts";
import { SOURCE_HOST_ALLOWLIST } from "./sources.ts";

const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const ABSOLUTE_MAX_RESPONSE_BYTES = 8_000_000;
const MAX_ITEMS = 60;

export class SourceFetchError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SourceFetchError";
    this.code = code.slice(0, 80);
  }
}

function decodeXml(value: string) {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

function tagValue(block: string, names: string[]) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
    if (match?.[1]) return sanitizeUntrustedText(decodeXml(match[1]));
  }
  return "";
}

function linkValue(block: string) {
  const atomAlternate = block.match(/<link\s+[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  if (atomAlternate?.[1]) return decodeXml(atomAlternate[1]);
  const atomLink = block.match(/<link\s+[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (atomLink?.[1]) return decodeXml(atomLink[1]);
  return tagValue(block, ["link"]);
}

function publishedValue(block: string) {
  const raw = tagValue(block, ["published", "updated", "pubDate", "dc:date"]);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function relevant(source: SourceDefinition, item: FeedItem) {
  if (source.includeTerms.length === 0) return true;
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  return source.includeTerms.some((term) => {
    const normalized = term.toLowerCase().trim().replace(/\s+/g, " ");
    if (!normalized) return false;
    if (/^[a-z0-9]+(?:[ -][a-z0-9]+)*$/i.test(normalized)) {
      const escaped = normalized
        .split(" ")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("\\s+");
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(haystack);
    }
    return haystack.includes(normalized);
  });
}

export function parseFeed(xml: string, source: SourceDefinition) {
  const blocks = [
    ...Array.from(xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi), (match) => match[1]),
    ...Array.from(xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi), (match) => match[1]),
  ].slice(0, MAX_ITEMS);

  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = tagValue(block, ["title"]);
    const rawUrl = linkValue(block);
    if (!title || !rawUrl) continue;
    let canonicalUrl: string;
    try {
      canonicalUrl = canonicalizeUrl(rawUrl);
      if (new URL(canonicalUrl).protocol !== "https:") continue;
    } catch {
      continue;
    }
    const externalId = tagValue(block, ["guid", "id"]) || canonicalUrl;
    const item: FeedItem = {
      externalId: externalId.slice(0, 500),
      canonicalUrl,
      title: title.slice(0, 300),
      summary: tagValue(block, ["description", "summary", "content", "content:encoded"]).slice(
        0,
        2000,
      ),
      publishedAt: publishedValue(block),
    };
    if (relevant(source, item)) items.push(item);
  }
  return items;
}

function validateFetchUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !SOURCE_HOST_ALLOWLIST.has(url.hostname)) {
    throw new SourceFetchError("source-redirect-host", `来源地址不在 allowlist: ${url.hostname}`);
  }
  return url;
}

export async function fetchSource(source: SourceDefinition) {
  const maxResponseBytes = source.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (
    !Number.isInteger(maxResponseBytes) ||
    maxResponseBytes < 1 ||
    maxResponseBytes > ABSOLUTE_MAX_RESPONSE_BYTES
  ) {
    throw new SourceFetchError("source-config-invalid", "来源响应上限配置无效");
  }
  let url = validateFetchUrl(source.feedUrl);
  let response: Response | null = null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    for (let redirects = 0; redirects <= 2; redirects += 1) {
      try {
        response = await fetch(url, {
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
            "user-agent": "PULSE-AI-Radar/1.0 (+https://pulse-ai-web.sumerchaser.workers.dev/)",
          },
        });
      } catch (error) {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          throw new SourceFetchError("source-timeout", "来源请求超时");
        }
        throw new SourceFetchError("source-network-error", "来源网络请求失败");
      }
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) {
        throw new SourceFetchError("source-redirect-missing", "来源返回无 Location 的重定向");
      }
      url = validateFetchUrl(new URL(location, url).toString());
    }
  } finally {
    clearTimeout(timer);
  }

  if (!response?.ok) {
    throw new SourceFetchError(
      `source-http-${response?.status ?? "network"}`,
      `来源请求失败: ${response?.status ?? "network"}`,
    );
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > maxResponseBytes) {
    throw new SourceFetchError("source-body-too-large", "来源响应超过单源大小限制");
  }
  let xml: string;
  try {
    xml = await response.text();
  } catch {
    throw new SourceFetchError("source-network-error", "来源响应读取失败");
  }
  if (new TextEncoder().encode(xml).byteLength > maxResponseBytes) {
    throw new SourceFetchError("source-body-too-large", "来源响应超过单源大小限制");
  }

  return {
    xml,
    contentHash: await stableHash(xml),
    items: parseFeed(xml, source),
    fetchedUrl: url.toString(),
  };
}
