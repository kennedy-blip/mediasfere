import Dexie, { type EntityTable } from "dexie";
import type { Platform } from "./sanitizer";
import type { JobStatus, Quality } from "./api";

export interface HistoryEntry {
  id: string;
  url: string;
  platform: Platform | "unknown";
  title: string | null;
  thumbnail: string | null;
  quality: Quality;
  status: JobStatus;
  start: number | null;
  end: number | null;
  subtitles: boolean;
  fileName: string | null;
  fileSize: number | null;
  transcriptAvailable: boolean;
  error: string | null;
  demo: boolean;
  createdAt: number;
  updatedAt: number;
}

export const db = new Dexie("mediasphere") as Dexie & {
  history: EntityTable<HistoryEntry, "id">;
};

db.version(1).stores({
  history: "id, platform, status, createdAt, updatedAt",
});
