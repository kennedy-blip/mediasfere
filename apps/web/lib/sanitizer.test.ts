import { describe, expect, it } from "vitest";
import { detectPlatform, sanitizeUrl } from "./sanitizer";
import { formatDuration, parseTimestamp } from "./format";

describe("sanitizeUrl", () => {
  it("strips tracking parameters and keeps content params", () => {
    const res = sanitizeUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc&utm_source=x&utm_medium=y&t=42&feature=share#frag",
    );
    expect(res).toEqual({
      ok: true,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      platform: "youtube",
      removed: ["si", "utm_source", "utm_medium", "t", "feature"],
    });
  });

  it("removes instagram igsh and fbclid", () => {
    const res = sanitizeUrl("instagram.com/reel/C123/?igsh=MWQ1&fbclid=IwAR");
    expect(res.ok && res.url).toBe("https://instagram.com/reel/C123/");
  });

  it("removes ref_src from X links", () => {
    const res = sanitizeUrl("https://twitter.com/user/status/1?ref_src=twsrc%5Etfw");
    expect(res.ok && res.platform).toBe("x");
    expect(res.ok && res.url).toBe("https://twitter.com/user/status/1");
  });

  it.each([
    ["https://youtu.be/abc", "youtube"],
    ["https://vm.tiktok.com/ZM123/", "tiktok"],
    ["https://x.com/a/status/1", "x"],
    ["https://old.reddit.com/r/videos/comments/1/x/", "reddit"],
    ["https://www.pinterest.com/pin/123/", "pinterest"],
    ["https://vimeo.com/76979871", "vimeo"],
  ])("accepts %s", (url, platform) => {
    const res = sanitizeUrl(url);
    expect(res.ok && res.platform).toBe(platform);
  });

  it.each([
    "https://evil-youtube.com/watch?v=1",
    "https://youtube.com.evil.io/watch?v=1",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "ftp://youtube.com/x",
    "javascript:alert(1)",
    "https://user:pw@youtube.com/watch?v=1",
    "https://youtube.com:8443/watch?v=1",
    "",
    "not a url at all",
  ])("rejects %s", (url) => {
    expect(sanitizeUrl(url).ok).toBe(false);
  });

  it("upgrades http to https", () => {
    const res = sanitizeUrl("http://vimeo.com/1");
    expect(res.ok && res.url).toBe("https://vimeo.com/1");
  });
});

describe("helpers", () => {
  it("detects platforms", () => {
    expect(detectPlatform("m.youtube.com")).toBe("youtube");
    expect(detectPlatform("example.com")).toBeNull();
  });

  it("parses timestamps", () => {
    expect(parseTimestamp("1:02:03")).toBe(3723);
    expect(parseTimestamp("90")).toBe(90);
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("ab")).toBeNaN();
  });

  it("formats durations", () => {
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(null)).toBe("--:--");
  });
});
