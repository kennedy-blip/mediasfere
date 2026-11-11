"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AudioLines,
  CheckCircle2,
  Clapperboard,
  Film,
  Link2,
  Loader2,
  Scissors,
  ShieldCheck,
  Sparkles,
  Subtitles,
} from "lucide-react";
import { api, DEMO_MODE, QUALITY_LABELS, type ProbeResult, type Quality } from "@/lib/api";
import { formatDuration, parseTimestamp } from "@/lib/format";
import { useJobs } from "@/lib/jobs";
import { PLATFORM_LABELS, sanitizeUrl } from "@/lib/sanitizer";
import { Toggle } from "./ui";

const QUALITY_ICONS: Record<Quality, React.ReactNode> = {
  "1080p": <Clapperboard className="h-4 w-4" />,
  "720p": <Film className="h-4 w-4" />,
  audio_mp3_320k: <AudioLines className="h-4 w-4" />,
};

export default function Workspace({
  initialUrl,
  onSubmitted,
}: {
  initialUrl: string;
  onSubmitted: () => void;
}) {
  const { submit } = useJobs();
  const [input, setInput] = useState(initialUrl);
  const [quality, setQuality] = useState<Quality>("720p");
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [precise, setPrecise] = useState(false);
  const [subtitles, setSubtitles] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setInput(initialUrl), [initialUrl]);

  const result = useMemo(() => sanitizeUrl(input), [input]);
  const cleanUrl = result.ok ? result.url : null;

  useEffect(() => {
    setProbe(null);
    setProbeError(null);
    if (!cleanUrl || DEMO_MODE) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setProbing(true);
      try {
        const info = await api.probe(cleanUrl, controller.signal);
        setProbe(info);
        if (!info.qualities.includes(quality)) setQuality(info.qualities[0]);
      } catch (e) {
        if (!controller.signal.aborted) setProbeError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setProbing(false);
      }
    }, 600);
    return () => {
      controller.abort();
      clearTimeout(timer);
      setProbing(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanUrl]);

  const startSec = trimEnabled ? parseTimestamp(start) : null;
  const endSec = trimEnabled ? parseTimestamp(end) : null;
  const trimError = (() => {
    if (!trimEnabled) return null;
    if (Number.isNaN(startSec) || Number.isNaN(endSec)) return "Use HH:MM:SS, MM:SS or seconds";
    if (startSec != null && endSec != null && endSec <= startSec) return "End must be after start";
    if (probe?.duration && endSec != null && endSec > probe.duration) return "End is past the media duration";
    return null;
  })();

  const canSubmit = Boolean(cleanUrl) && !trimError && !submitting;
  const available = probe?.qualities ?? (Object.keys(QUALITY_LABELS) as Quality[]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cleanUrl || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await submit(
        { url: cleanUrl, quality, start: startSec, end: endSec, precise_trim: trimEnabled && precise, subtitles },
        { title: probe?.title, thumbnail: probe?.thumbnail },
      );
      setInput("");
      onSubmitted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <label htmlFor="url" className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
            <Link2 className="h-4 w-4" /> Media link
          </label>
          <div className="relative">
            <input
              id="url"
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 pr-32 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
            />
            <div className="absolute inset-y-0 right-3 flex items-center">
              {input.trim() &&
                (result.ok ? (
                  <span className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {PLATFORM_LABELS[result.platform]}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-1 text-xs font-medium text-rose-300">
                    <AlertCircle className="h-3.5 w-3.5" /> Invalid
                  </span>
                ))}
            </div>
          </div>
          <div className="mt-2 min-h-5 text-xs">
            {input.trim() && !result.ok && <p className="text-rose-400">{result.error}</p>}
            {result.ok && (
              <p className="flex flex-wrap items-center gap-1 text-slate-500">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                {result.removed.length
                  ? `Removed tracking: ${result.removed.join(", ")}`
                  : "No tracking parameters found"}
                <span className="truncate text-slate-600">· {result.url}</span>
              </p>
            )}
          </div>

          {(probing || probe || probeError) && (
            <div className="mt-4 flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              {probing && (
                <p className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Inspecting media…
                </p>
              )}
              {probe && (
                <>
                  {probe.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={probe.thumbnail} alt="" className="h-16 w-28 rounded-lg object-cover" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-100">{probe.title}</p>
                    <p className="text-xs text-slate-500">
                      {probe.uploader} · {formatDuration(probe.duration)}
                    </p>
                  </div>
                </>
              )}
              {probeError && !probing && <p className="text-sm text-amber-400">{probeError}</p>}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="mb-3 text-sm font-medium text-slate-300">Output quality</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(QUALITY_LABELS) as Quality[]).map((q) => {
              const disabled = !available.includes(q);
              return (
                <button
                  key={q}
                  type="button"
                  disabled={disabled}
                  onClick={() => setQuality(q)}
                  className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
                    quality === q
                      ? "border-indigo-500 bg-indigo-500/10 text-indigo-200"
                      : "border-slate-700 text-slate-300 hover:border-slate-500"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {QUALITY_ICONS[q]} {QUALITY_LABELS[q]}
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <Toggle
            checked={trimEnabled}
            onChange={setTrimEnabled}
            label="Trim time range"
            description="Fast stream-copy cut via FFmpeg -ss / -to"
          />
          {trimEnabled && (
            <div className="space-y-3 pl-12">
              <div className="flex flex-wrap items-center gap-3">
                <Scissors className="h-4 w-4 text-slate-500" />
                <input
                  aria-label="Start time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  placeholder="00:00:00"
                  className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
                />
                <span className="text-slate-500">→</span>
                <input
                  aria-label="End time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  placeholder={probe?.duration ? formatDuration(probe.duration) : "00:01:00"}
                  className="w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-500"
                />
              </div>
              {trimError && <p className="text-xs text-rose-400">{trimError}</p>}
              <Toggle
                checked={precise}
                onChange={setPrecise}
                label="Frame-accurate cut"
                description="Re-encodes for exact keyframe alignment (slower)"
              />
            </div>
          )}
          <Toggle
            checked={subtitles}
            onChange={setSubtitles}
            label="AI subtitles & summary"
            description="Faster-Whisper (small) generates timestamped .srt and a text summary"
          />
        </section>
      </div>

      <aside className="space-y-4">
        <div className="sticky top-6 space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <Sparkles className="h-4 w-4 text-indigo-400" /> Job summary
          </h3>
          <dl className="space-y-2 text-sm">
            <Row label="Platform" value={result.ok ? PLATFORM_LABELS[result.platform] : "—"} />
            <Row label="Quality" value={QUALITY_LABELS[quality]} />
            <Row
              label="Range"
              value={
                trimEnabled && (startSec != null || endSec != null) && !trimError
                  ? `${formatDuration(startSec ?? 0)} → ${endSec != null ? formatDuration(endSec) : "end"}`
                  : "Full length"
              }
            />
            <Row label="Subtitles" value={subtitles ? "On" : "Off"} icon={<Subtitles className="h-3.5 w-3.5" />} />
          </dl>
          {error && <p className="rounded-lg bg-rose-500/10 p-2 text-xs text-rose-300">{error}</p>}
          <button
            type="submit"
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Start extraction
          </button>
          <p className="text-center text-[11px] text-slate-500">
            Public links only. Respect creators&apos; rights and platform terms.
          </p>
        </div>
      </aside>
    </form>
  );
}

function Row({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="flex items-center gap-1 text-slate-200">
        {icon}
        {value}
      </dd>
    </div>
  );
}
