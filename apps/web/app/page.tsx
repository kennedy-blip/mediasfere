"use client";

import { CheckCircle2, Download, History as HistoryIcon, Orbit, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";
import ActiveQueue from "@/components/ActiveQueue";
import Completed from "@/components/Completed";
import History from "@/components/History";
import Workspace from "@/components/Workspace";
import { api, DEMO_MODE, isTerminal } from "@/lib/api";
import { JobsProvider, useJobs } from "@/lib/jobs";

type Tab = "extract" | "active" | "completed" | "history";

export default function Page() {
  return (
    <JobsProvider>
      <Shell />
    </JobsProvider>
  );
}

function Shell() {
  const { jobs } = useJobs();
  const [tab, setTab] = useState<Tab>("extract");
  const [reuseUrl, setReuseUrl] = useState("");

  const activeCount = jobs.filter((j) => !isTerminal(j.status) || j.status === "FAILED").length;
  const completedCount = jobs.filter((j) => j.status === "COMPLETED").length;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { id: "extract", label: "Extraction", icon: <Wand2 className="h-4 w-4" /> },
    { id: "active", label: "Active Downloads", icon: <Download className="h-4 w-4" />, count: activeCount },
    { id: "completed", label: "Completed", icon: <CheckCircle2 className="h-4 w-4" />, count: completedCount },
    { id: "history", label: "History", icon: <HistoryIcon className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-400">
            <Orbit className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-white">MediaSphere</h1>
            <p className="text-xs text-slate-500">Secure media intelligence &amp; extraction</p>
          </div>
        </div>
        <ApiStatus />
      </header>

      {DEMO_MODE && (
        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Demo mode: <code className="font-mono">NEXT_PUBLIC_API_URL</code> is not set, so jobs are simulated in your
          browser. Point it at the FastAPI backend for real extraction.
        </div>
      )}

      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 p-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.id ? "bg-slate-800 text-white" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.icon}
            {t.label}
            {!!t.count && (
              <span className="rounded-full bg-indigo-500/20 px-1.5 text-[11px] text-indigo-200">{t.count}</span>
            )}
          </button>
        ))}
      </nav>

      <main>
        <div hidden={tab !== "extract"}>
          <Workspace initialUrl={reuseUrl} onSubmitted={() => setTab("active")} />
        </div>
        {tab === "active" && <ActiveQueue />}
        {tab === "completed" && <Completed />}
        {tab === "history" && (
          <History
            onReuse={(url) => {
              setReuseUrl(url);
              setTab("extract");
            }}
          />
        )}
      </main>
    </div>
  );
}

function ApiStatus() {
  const [state, setState] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    if (DEMO_MODE) return;
    let alive = true;
    const check = () =>
      api
        .health()
        .then(() => alive && setState("online"))
        .catch(() => alive && setState("offline"));
    check();
    const id = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const [label, color] = DEMO_MODE
    ? ["Demo mode", "bg-amber-400"]
    : state === "online"
      ? ["API online", "bg-emerald-400"]
      : state === "offline"
        ? ["API offline", "bg-rose-400"]
        : ["Connecting…", "bg-slate-500"];

  return (
    <span className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
      <span className={`h-2 w-2 rounded-full ${color}`} /> {label}
    </span>
  );
}
