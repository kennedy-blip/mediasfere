"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { History as HistoryIcon, RotateCcw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { QUALITY_LABELS } from "@/lib/api";
import { db } from "@/lib/db";
import { formatBytes, timeAgo } from "@/lib/format";
import { PLATFORM_LABELS, type Platform } from "@/lib/sanitizer";
import { EmptyState, PlatformTag, StatusPill } from "./ui";

export default function History({ onReuse }: { onReuse: (url: string) => void }) {
  const entries = useLiveQuery(() => db.history.orderBy("createdAt").reverse().toArray(), []);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<Platform | "all">("all");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    entries?.forEach((e) => map.set(e.platform, (map.get(e.platform) ?? 0) + 1));
    return map;
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (entries ?? []).filter(
      (e) =>
        (platform === "all" || e.platform === platform) &&
        (!q || e.url.toLowerCase().includes(q) || (e.title ?? "").toLowerCase().includes(q)),
    );
  }, [entries, query, platform]);

  if (entries === undefined) return null;

  if (!entries.length) {
    return (
      <EmptyState
        icon={<HistoryIcon className="h-10 w-10" />}
        title="Your history is empty"
        hint="Every job is logged locally in your browser (IndexedDB). No account, no server-side tracking."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles or links"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pr-3 pl-9 text-sm outline-none focus:border-indigo-500"
          />
        </div>
        <button
          onClick={() => {
            if (confirm("Clear all local history?")) void db.history.clear();
          }}
          className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          <Trash2 className="h-4 w-4" /> Clear
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip active={platform === "all"} onClick={() => setPlatform("all")} label={`All (${entries.length})`} />
        {(Object.keys(PLATFORM_LABELS) as Platform[])
          .filter((p) => counts.has(p))
          .map((p) => (
            <FilterChip
              key={p}
              active={platform === p}
              onClick={() => setPlatform(p)}
              label={`${PLATFORM_LABELS[p]} (${counts.get(p)})`}
            />
          ))}
      </div>

      <ul className="divide-y divide-slate-800 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60">
        {filtered.map((e) => (
          <li key={e.id} className="flex items-center gap-4 p-4">
            {e.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={e.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" />
            ) : (
              <div className="h-12 w-20 shrink-0 rounded-md bg-slate-800" />
            )}
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <StatusPill status={e.status} />
                <PlatformTag platform={e.platform} />
                <span className="text-xs text-slate-500">
                  {QUALITY_LABELS[e.quality]}
                  {e.fileSize ? ` · ${formatBytes(e.fileSize)}` : ""} · {timeAgo(e.createdAt)}
                  {e.demo ? " · demo" : ""}
                </span>
              </div>
              <p className="truncate text-sm font-medium text-slate-200">{e.title ?? e.url}</p>
              <p className="truncate text-xs text-slate-500">{e.error ?? e.url}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => onReuse(e.url)}
                title="Use this link again"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                onClick={() => void db.history.delete(e.id)}
                title="Delete entry"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-rose-300"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
        {!filtered.length && <li className="p-6 text-center text-sm text-slate-500">No matching entries</li>}
      </ul>
    </div>
  );
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active ? "border-indigo-500 bg-indigo-500/15 text-indigo-200" : "border-slate-700 text-slate-400 hover:border-slate-500"
      }`}
    >
      {label}
    </button>
  );
}
