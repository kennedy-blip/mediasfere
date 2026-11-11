export type Quality = "1080p" | "720p" | "audio_mp3_320k";

export type JobStatus =
  | "QUEUED"
  | "EXTRACTING"
  | "TRIMMING"
  | "TRANSCRIBING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export const TERMINAL: JobStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];
export const STAGES: JobStatus[] = ["QUEUED", "EXTRACTING", "TRIMMING", "TRANSCRIBING", "COMPLETED"];

export interface Summary {
  language: string | null;
  duration: number;
  word_count: number;
  keywords: string[];
  key_points: string[];
  chapters: { start: number; text: string }[];
}

export interface Job {
  id: string;
  url: string;
  platform: string;
  quality: Quality;
  start: number | null;
  end: number | null;
  precise_trim: boolean;
  subtitles: boolean;
  status: JobStatus;
  progress: number;
  speed: number | null;
  eta: number | null;
  error: string | null;
  title: string | null;
  thumbnail: string | null;
  duration: number | null;
  file_name: string | null;
  file_size: number | null;
  media_type: "video" | "audio" | null;
  transcript_available: boolean;
  summary: Summary | null;
  created_at: number;
  updated_at: number;
  demo?: boolean;
}

export interface JobRequest {
  url: string;
  quality: Quality;
  start: number | null;
  end: number | null;
  precise_trim: boolean;
  subtitles: boolean;
}

export interface ProbeResult {
  url: string;
  platform: string;
  title: string | null;
  duration: number | null;
  thumbnail: string | null;
  uploader: string | null;
  qualities: Quality[];
}

export const QUALITY_LABELS: Record<Quality, string> = {
  "1080p": "1080p MP4",
  "720p": "720p MP4",
  audio_mp3_320k: "MP3 320k",
};

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/+$/, "");
export const WS_URL = (process.env.NEXT_PUBLIC_WS_URL ?? API_URL.replace(/^http/, "ws")).replace(/\/+$/, "");
export const DEMO_MODE = !API_URL;

export const isTerminal = (status: JobStatus) => TERMINAL.includes(status);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join(", ");
    } catch {}
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string }>("/healthz"),
  probe: (url: string, signal?: AbortSignal) =>
    request<ProbeResult>("/api/probe", { method: "POST", body: JSON.stringify({ url }), signal }),
  createJob: (body: JobRequest) => request<Job>("/api/jobs", { method: "POST", body: JSON.stringify(body) }),
  getJob: (id: string) => request<Job>(`/api/jobs/${id}`),
  cancelJob: (id: string) => request<Job>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  fileUrl: (id: string, inline = false) => `${API_URL}/api/jobs/${id}/file${inline ? "?inline=1" : ""}`,
  transcriptUrl: (id: string, format: "srt" | "txt" | "json" = "srt") =>
    `${API_URL}/api/jobs/${id}/transcript?format=${format}`,
  async transcriptText(id: string): Promise<string> {
    const res = await fetch(api.transcriptUrl(id, "txt"));
    if (!res.ok) throw new Error("Transcript unavailable");
    return res.text();
  },
  socketUrl: (id: string) => `${WS_URL}/ws/jobs/${id}`,
};
