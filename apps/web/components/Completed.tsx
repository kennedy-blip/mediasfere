"use client";

import { Check, CheckCircle2, Copy, Download, FileText, Loader2, X } from "lucide-react";
import { useState } from "react";
import { api, QUALITY_LABELS, type Job } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/format";
import { useJobs } from "@/lib/jobs";
import { EmptyState, PlatformTag } from "./ui";

export default function Completed() {
  const { jobs } = useJobs();
  const done = jobs.filter((j) => j.status === "COMPLETED");

  if (!done.length) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="h-10 w-10" />}
        title="Nothing completed yet"
        hint="Finished jobs appear here with an inline player, a direct download and one-click transcript copy."
      />
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {done.map((job) => (
        <CompletedCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function CompletedCard({ job }: { job: Job }) {
  const { dismiss } = useJobs();
  const [copyState, setCopyState] = useState<"idle" | "loading" | "copied" | "error">("idle");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const isAudio = job.media_type === "audio";

  async function loadTranscript() {
    if (transcript != null) return transcript;
    const text = job.demo ? (job.summary?.key_points.join(" ") ?? "") : await api.transcriptText(job.id);
    setTranscript(text);
    return text;
  }

  async function copyTranscript() {
    setCopyState("loading");
    try {
      await navigator.clipboard.writeText(await loadTranscript());
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
      <div className="bg-black">
        {job.demo ? (
          <div className="flex aspect-video items-center justify-center text-sm text-slate-500">
            Demo mode — connect the API for real media playback
          </div>
        ) : isAudio ? (
          <div className="p-6">
            <audio controls preload="metadata" src={api.fileUrl(job.id, true)} className="w-full" />
          </div>
        ) : (
          <video
            controls
            preload="metadata"
            poster={job.thumbnail ?? undefined}
            src={api.fileUrl(job.id, true)}
            className="aspect-video w-full"
          >
            {job.transcript_available && (
              <track kind="subtitles" src={api.transcriptUrl(job.id, "srt")} label="Transcript" />
            )}
          </video>
        )}
      </div>

      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <PlatformTag platform={job.platform} />
              <span className="text-xs text-slate-500">
                {QUALITY_LABELS[job.quality]} · {formatBytes(job.file_size)}
                {(job.start != null || job.end != null) &&
                  ` · ${formatDuration(job.start ?? 0)}–${job.end != null ? formatDuration(job.end) : "end"}`}
              </span>
            </div>
            <p className="truncate font-medium text-slate-100">{job.title ?? job.file_name}</p>
          </div>
          <button
            onClick={() => dismiss(job.id)}
            aria-label="Remove from list"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={job.demo ? undefined : api.fileUrl(job.id)}
            download={job.file_name ?? undefined}
            aria-disabled={job.demo}
            className={`flex items-center gap-2 rounded-lg bg-indigo-500 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-400 ${job.demo ? "pointer-events-none opacity-50" : ""}`}
          >
            <Download className="h-4 w-4" /> Download
          </a>
          {job.transcript_available && (
            <>
              <button
                onClick={copyTranscript}
                className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                {copyState === "loading" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : copyState === "copied" ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy transcript"}
              </button>
              {!job.demo && (
                <a
                  href={api.transcriptUrl(job.id, "srt")}
                  className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <FileText className="h-4 w-4" /> .srt
                </a>
              )}
            </>
          )}
        </div>

        {job.summary && (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>AI summary</span>
              {job.summary.language && <span>· {job.summary.language.toUpperCase()}</span>}
              <span>· {job.summary.word_count} words</span>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-slate-300">
              {job.summary.key_points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            {job.summary.keywords.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {job.summary.keywords.map((k) => (
                  <span key={k} className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
                    #{k}
                  </span>
                ))}
              </div>
            )}
            <button
              onClick={async () => {
                if (!showTranscript) await loadTranscript().catch(() => setTranscript("Transcript unavailable"));
                setShowTranscript((v) => !v);
              }}
              className="mt-3 text-xs text-indigo-300 hover:underline"
            >
              {showTranscript ? "Hide full transcript" : "Show full transcript"}
            </button>
            {showTranscript && (
              <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-400">
                {transcript}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
