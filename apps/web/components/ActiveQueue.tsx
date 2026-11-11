"use client";

import { Check, Download, Gauge, Hourglass, Loader2, X } from "lucide-react";
import { useState } from "react";
import { isTerminal, QUALITY_LABELS, STAGES, type Job } from "@/lib/api";
import { formatDuration, formatSpeed } from "@/lib/format";
import { useJobs } from "@/lib/jobs";
import { EmptyState, PlatformTag, StatusPill } from "./ui";

const STAGE_LABELS: Record<string, string> = {
  QUEUED: "Queued",
  EXTRACTING: "Extract",
  TRIMMING: "Trim",
  TRANSCRIBING: "Transcribe",
  COMPLETED: "Done",
};

export default function ActiveQueue() {
  const { jobs } = useJobs();
  const active = jobs.filter((j) => !isTerminal(j.status) || j.status === "FAILED");

  if (!active.length) {
    return (
      <EmptyState
        icon={<Download className="h-10 w-10" />}
        title="No active downloads"
        hint="Jobs you start from the Extraction tab stream live progress here over WebSockets."
      />
    );
  }

  return (
    <div className="space-y-4">
      {active.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function JobCard({ job }: { job: Job }) {
  const { cancel, dismiss } = useJobs();
  const [cancelling, setCancelling] = useState(false);
  const stages = job.subtitles ? STAGES : STAGES.filter((s) => s !== "TRANSCRIBING");
  const currentIndex = stages.indexOf(job.status);
  const failed = job.status === "FAILED";

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-start gap-4">
        {job.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={job.thumbnail} alt="" className="h-14 w-24 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="h-14 w-24 shrink-0 rounded-lg bg-slate-800" />
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <StatusPill status={job.status} />
            <PlatformTag platform={job.platform} />
            <span className="text-xs text-slate-500">{QUALITY_LABELS[job.quality]}</span>
          </div>
          <p className="truncate font-medium text-slate-100">{job.title ?? job.url}</p>
          <p className="truncate text-xs text-slate-500">{job.url}</p>
        </div>
        {failed ? (
          <button
            onClick={() => dismiss(job.id)}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
          >
            Dismiss
          </button>
        ) : (
          <button
            disabled={cancelling}
            onClick={async () => {
              setCancelling(true);
              try {
                await cancel(job.id);
              } finally {
                setCancelling(false);
              }
            }}
            className="flex items-center gap-1 rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
          >
            {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Cancel
          </button>
        )}
      </div>

      {failed ? (
        <p className="mt-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300">{job.error ?? "Job failed"}</p>
      ) : (
        <>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-[width] duration-500"
              style={{ width: `${job.progress}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <ol className="flex items-center gap-1">
              {stages.map((stage, i) => (
                <li key={stage} className="flex items-center gap-1">
                  <span
                    className={`flex items-center gap-1 rounded-md px-2 py-0.5 ${
                      i < currentIndex
                        ? "text-emerald-300"
                        : i === currentIndex
                          ? "bg-indigo-500/15 text-indigo-200"
                          : "text-slate-600"
                    }`}
                  >
                    {i < currentIndex && <Check className="h-3 w-3" />}
                    {i === currentIndex && <Loader2 className="h-3 w-3 animate-spin" />}
                    {STAGE_LABELS[stage]}
                  </span>
                  {i < stages.length - 1 && <span className="text-slate-700">›</span>}
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-4 text-slate-400">
              <span className="flex items-center gap-1">
                <Gauge className="h-3.5 w-3.5" /> {formatSpeed(job.speed)}
              </span>
              <span className="flex items-center gap-1">
                <Hourglass className="h-3.5 w-3.5" /> ETA {job.eta != null ? formatDuration(job.eta) : "—"}
              </span>
              <span className="font-mono text-slate-200">{job.progress}%</span>
            </div>
          </div>
        </>
      )}
    </article>
  );
}
