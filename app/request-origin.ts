import { headers } from "next/headers";

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() ?? "";
}

export async function requestOrigin() {
  const requestHeaders = await headers();
  const host =
    firstHeaderValue(requestHeaders.get("x-forwarded-host")) ||
    firstHeaderValue(requestHeaders.get("host"));

  if (!host || /[\\/@?#\s]/.test(host)) return null;

  const forwardedProtocol = firstHeaderValue(
    requestHeaders.get("x-forwarded-proto"),
  ).toLowerCase();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : host.startsWith("localhost") || host.startsWith("127.0.0.1")
        ? "http"
        : "https";

  try {
    const origin = new URL(`${protocol}://${host}`);
    if (origin.username || origin.password) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

export async function requestAbsoluteUrl(pathname: string) {
  const origin = await requestOrigin();
  return origin ? new URL(pathname, origin).toString() : pathname;
}
