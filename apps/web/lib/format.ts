export function parseTimestamp(value: string): number | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d+)?$/.test(v)) return NaN;
  return v.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

export function formatDuration(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "--:--";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return h ? `${h}:${mm}:${String(sec).padStart(2, "0")}` : `${mm}:${String(sec).padStart(2, "0")}`;
}

export function formatBytes(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bps?: number | null): string {
  return bps ? `${formatBytes(bps)}/s` : "—";
}

export function timeAgo(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}
