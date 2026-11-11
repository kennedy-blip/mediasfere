import type { JobStatus } from "@/lib/api";
import { PLATFORM_LABELS, type Platform } from "@/lib/sanitizer";

export function PlatformTag({ platform }: { platform: string }) {
  const label = PLATFORM_LABELS[platform as Platform] ?? platform;
  return (
    <span className="rounded-full border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-300">
      {label}
    </span>
  );
}

const STATUS_STYLES: Record<JobStatus, string> = {
  QUEUED: "bg-slate-700 text-slate-200",
  EXTRACTING: "bg-sky-500/15 text-sky-300",
  TRIMMING: "bg-violet-500/15 text-violet-300",
  TRANSCRIBING: "bg-amber-500/15 text-amber-300",
  COMPLETED: "bg-emerald-500/15 text-emerald-300",
  FAILED: "bg-rose-500/15 text-rose-300",
  CANCELLED: "bg-slate-600/40 text-slate-400",
};

export function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

export function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-800 py-16 text-center">
      <div className="text-slate-600">{icon}</div>
      <p className="font-medium text-slate-300">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{hint}</p>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-indigo-500" : "bg-slate-700"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`}
        />
      </button>
      <span>
        <span className="block text-sm font-medium text-slate-200">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}
