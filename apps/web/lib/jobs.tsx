"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, DEMO_MODE, isTerminal, type Job, type JobRequest, type JobStatus } from "./api";
import { db, type HistoryEntry } from "./db";
import { detectPlatform } from "./sanitizer";

const RESTORE_WINDOW_MS = 6 * 60 * 60 * 1000;

interface JobsContextValue {
  jobs: Job[];
  submit: (req: JobRequest, meta?: { title?: string | null; thumbnail?: string | null }) => Promise<Job>;
  cancel: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
}

const JobsContext = createContext<JobsContextValue | null>(null);

function toHistory(job: Job): HistoryEntry {
  let platform: HistoryEntry["platform"] = "unknown";
  try {
    platform = detectPlatform(new URL(job.url).hostname) ?? "unknown";
  } catch {}
  return {
    id: job.id,
    url: job.url,
    platform,
    title: job.title,
    thumbnail: job.thumbnail,
    quality: job.quality,
    status: job.status,
    start: job.start,
    end: job.end,
    subtitles: job.subtitles,
    fileName: job.file_name,
    fileSize: job.file_size,
    transcriptAvailable: job.transcript_available,
    error: job.error,
    demo: Boolean(job.demo),
    createdAt: job.created_at * 1000,
    updatedAt: Date.now(),
  };
}

function demoJob(req: JobRequest, meta?: { title?: string | null; thumbnail?: string | null }): Job {
  const now = Date.now() / 1000;
  return {
    id: `demo-${crypto.randomUUID()}`,
    url: req.url,
    platform: "unknown",
    quality: req.quality,
    start: req.start,
    end: req.end,
    precise_trim: req.precise_trim,
    subtitles: req.subtitles,
    status: "QUEUED",
    progress: 0,
    speed: null,
    eta: null,
    error: null,
    title: meta?.title ?? "Demo media",
    thumbnail: meta?.thumbnail ?? null,
    duration: null,
    file_name: null,
    file_size: null,
    media_type: req.quality === "audio_mp3_320k" ? "audio" : "video",
    transcript_available: false,
    summary: null,
    created_at: now,
    updated_at: now,
    demo: true,
  };
}

function nextDemoState(job: Job): Partial<Job> {
  const p = job.progress + 2 + Math.random() * 4;
  if (job.status === "QUEUED") return { status: "EXTRACTING", progress: 20 };
  if (job.status === "EXTRACTING") {
    if (p < 60) return { progress: Math.round(p), speed: 2_000_000 + Math.random() * 6_000_000, eta: Math.round((60 - p) / 2.5) };
    return { status: "TRIMMING", progress: 60, speed: null, eta: null };
  }
  if (job.status === "TRIMMING") {
    if (p < 85 && (job.subtitles || p < 75)) return { progress: Math.round(p) };
    if (job.subtitles) return { status: "TRANSCRIBING", progress: 85 };
    return demoComplete(job);
  }
  if (job.status === "TRANSCRIBING") {
    if (p < 100) return { progress: Math.round(p) };
    return demoComplete(job);
  }
  return {};
}

function demoComplete(job: Job): Partial<Job> {
  return {
    status: "COMPLETED",
    progress: 100,
    file_name: `demo.${job.quality === "audio_mp3_320k" ? "mp3" : "mp4"}`,
    file_size: 12_400_000,
    transcript_available: job.subtitles,
    summary: job.subtitles
      ? {
          language: "en",
          duration: 120,
          word_count: 312,
          keywords: ["demo", "mediasphere", "backend"],
          key_points: [
            "This is a simulated job because NEXT_PUBLIC_API_URL is not configured.",
            "Connect the FastAPI backend to get real downloads, trims and Faster-Whisper transcripts.",
          ],
          chapters: [{ start: 0, text: "Demo mode walkthrough" }],
        }
      : null,
  };
}

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const sockets = useRef(new Map<string, WebSocket>());
  const timers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const lastStatus = useRef(new Map<string, JobStatus>());

  const apply = useCallback((job: Job) => {
    setJobs((prev) => ({ ...prev, [job.id]: { ...prev[job.id], ...job } }));
    if (lastStatus.current.get(job.id) !== job.status) {
      lastStatus.current.set(job.id, job.status);
      void db.history.put(toHistory(job));
    }
  }, []);

  const stopWatching = useCallback((id: string) => {
    const ws = sockets.current.get(id);
    if (ws) {
      ws.onclose = null;
      ws.close();
      sockets.current.delete(id);
    }
    const timer = timers.current.get(id);
    if (timer) {
      clearInterval(timer);
      timers.current.delete(id);
    }
  }, []);

  const poll = useCallback(
    (id: string) => {
      if (timers.current.has(id)) return;
      const timer = setInterval(async () => {
        try {
          const job = await api.getJob(id);
          apply(job);
          if (isTerminal(job.status)) stopWatching(id);
        } catch {
          // keep retrying until the job resolves or is dismissed
        }
      }, 2000);
      timers.current.set(id, timer);
    },
    [apply, stopWatching],
  );

  const watch = useCallback(
    (id: string) => {
      if (sockets.current.has(id) || timers.current.has(id)) return;
      let ws: WebSocket;
      try {
        ws = new WebSocket(api.socketUrl(id));
      } catch {
        poll(id);
        return;
      }
      sockets.current.set(id, ws);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.status === "NOT_FOUND") return;
        apply(data as Job);
        if (isTerminal(data.status)) stopWatching(id);
      };
      ws.onclose = () => {
        sockets.current.delete(id);
        poll(id);
      };
    },
    [apply, poll, stopWatching],
  );

  const simulate = useCallback(
    (initial: Job) => {
      let current = initial;
      const timer = setInterval(() => {
        current = { ...current, ...nextDemoState(current), updated_at: Date.now() / 1000 };
        apply(current);
        if (isTerminal(current.status)) stopWatching(current.id);
      }, 450);
      timers.current.set(initial.id, timer);
    },
    [apply, stopWatching],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const recent = await db.history.where("updatedAt").above(Date.now() - RESTORE_WINDOW_MS).toArray();
      for (const entry of recent) {
        if (cancelled || entry.status === "FAILED" || entry.status === "CANCELLED") continue;
        if (entry.demo) {
          if (!isTerminal(entry.status)) await db.history.update(entry.id, { status: "CANCELLED" });
          continue;
        }
        if (DEMO_MODE) continue;
        try {
          const job = await api.getJob(entry.id);
          if (cancelled) return;
          apply(job);
          if (!isTerminal(job.status)) watch(job.id);
        } catch {
          // job expired on the server
        }
      }
    })();
    const socketMap = sockets.current;
    const timerMap = timers.current;
    return () => {
      cancelled = true;
      socketMap.forEach((ws) => {
        ws.onclose = null;
        ws.close();
      });
      timerMap.forEach(clearInterval);
      socketMap.clear();
      timerMap.clear();
    };
  }, [apply, watch]);

  const submit = useCallback<JobsContextValue["submit"]>(
    async (req, meta) => {
      if (DEMO_MODE) {
        const job = demoJob(req, meta);
        apply(job);
        simulate(job);
        return job;
      }
      const job = await api.createJob(req);
      apply({ ...job, title: job.title ?? meta?.title ?? null, thumbnail: job.thumbnail ?? meta?.thumbnail ?? null });
      watch(job.id);
      return job;
    },
    [apply, simulate, watch],
  );

  const cancel = useCallback(
    async (id: string) => {
      const job = jobs[id];
      if (!job) return;
      if (job.demo) {
        stopWatching(id);
        apply({ ...job, status: "CANCELLED", speed: null, eta: null });
        return;
      }
      const updated = await api.cancelJob(id);
      apply(updated);
    },
    [apply, jobs, stopWatching],
  );

  const dismiss = useCallback(
    (id: string) => {
      stopWatching(id);
      setJobs((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [stopWatching],
  );

  const value = useMemo(
    () => ({
      jobs: Object.values(jobs).sort((a, b) => b.created_at - a.created_at),
      submit,
      cancel,
      dismiss,
    }),
    [jobs, submit, cancel, dismiss],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs must be used within JobsProvider");
  return ctx;
}
