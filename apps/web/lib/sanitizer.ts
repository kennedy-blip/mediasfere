export type Platform =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "x"
  | "reddit"
  | "pinterest"
  | "vimeo";

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  x: "X / Twitter",
  reddit: "Reddit",
  pinterest: "Pinterest",
  vimeo: "Vimeo",
};

const SUB = String.raw`(?:[a-z0-9-]+\.)*`;

export const PLATFORM_PATTERNS: Record<Platform, RegExp> = {
  youtube: new RegExp(String.raw`^${SUB}(?:youtube\.com|youtu\.be)$`),
  tiktok: new RegExp(String.raw`^${SUB}tiktok\.com$`),
  instagram: new RegExp(String.raw`^${SUB}instagram\.com$`),
  x: new RegExp(String.raw`^${SUB}(?:x\.com|twitter\.com)$`),
  reddit: new RegExp(String.raw`^${SUB}(?:reddit\.com|redd\.it)$`),
  pinterest: new RegExp(String.raw`^${SUB}(?:pinterest\.com|pin\.it)$`),
  vimeo: new RegExp(String.raw`^${SUB}vimeo\.com$`),
};

export const WHITELIST_REGEX = new RegExp(
  String.raw`^${SUB}(?:youtube\.com|youtu\.be|tiktok\.com|instagram\.com|x\.com|twitter\.com|reddit\.com|redd\.it|pinterest\.com|pin\.it|vimeo\.com)$`,
);

const TRACKING_PARAMS = new Set([
  "igsh",
  "igshid",
  "si",
  "fbclid",
  "gclid",
  "ref_src",
  "ref_url",
  "t",
  "feature",
  "share_id",
  "_r",
  "_t",
]);

export type SanitizeResult =
  | { ok: true; url: string; platform: Platform; removed: string[] }
  | { ok: false; error: string };

export function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return key.startsWith("utm_") || TRACKING_PARAMS.has(key);
}

export function detectPlatform(hostname: string): Platform | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  for (const [platform, pattern] of Object.entries(PLATFORM_PATTERNS)) {
    if (pattern.test(host)) return platform as Platform;
  }
  return null;
}

export function sanitizeUrl(input: string): SanitizeResult {
  const raw = input.trim();
  if (!raw) return { ok: false, error: "Paste a link to get started" };
  if (raw.length > 2048) return { ok: false, error: "Link is too long" };

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "That doesn't look like a valid URL" };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, error: "Only http(s) links are supported" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Links with embedded credentials are not allowed" };
  }
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return { ok: false, error: "Custom ports are not allowed" };
  }

  const host = parsed.hostname.toLowerCase();
  if (!WHITELIST_REGEX.test(host)) {
    return { ok: false, error: `Unsupported platform: ${host || "unknown"}` };
  }
  const platform = detectPlatform(host)!;

  const removed: string[] = [];
  for (const key of [...parsed.searchParams.keys()]) {
    if (isTrackingParam(key)) {
      removed.push(key);
      parsed.searchParams.delete(key);
    }
  }
  parsed.protocol = "https:";
  parsed.hash = "";

  return { ok: true, url: parsed.toString(), platform, removed: [...new Set(removed)] };
}
