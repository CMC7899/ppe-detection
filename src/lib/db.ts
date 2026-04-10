import Dexie, { Table } from "dexie";
import { AppSettings, PPEItem, PPELog } from "./types";

const DEFAULT_SETTINGS: AppSettings = {
  id: 1,
  confidenceThreshold: 0.6,
  requiredPPE: ["hardhat", "safety_vest"],
  roiRect: { x: 0.2, y: 0.15, width: 0.6, height: 0.75 },
};

class PPEDatabase extends Dexie {
  logs!: Table<PPELog, number>;
  settings!: Table<AppSettings, number>;

  constructor() {
    super("ppe_detection_db");
    this.version(1).stores({
      logs: "++id,timestamp,status",
      settings: "id",
    });
  }
}

export const db = new PPEDatabase();

export async function getSettings(): Promise<AppSettings> {
  const found = await db.settings.get(1);
  if (found) return found;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put(settings);
  notifyDataChanged();
}

export async function addLog(log: PPELog): Promise<void> {
  await db.logs.add(log);
  notifyDataChanged();
}

export async function getLatestLogs(limit = 5): Promise<PPELog[]> {
  return db.logs.orderBy("timestamp").reverse().limit(limit).toArray();
}

export async function getFilteredLogs(params: {
  from?: number;
  to?: number;
  status?: "ALL" | "ALLOWED" | "DENIED";
}): Promise<PPELog[]> {
  const all = await db.logs.orderBy("timestamp").reverse().toArray();
  return all.filter((item) => {
    if (params.from && item.timestamp < params.from) return false;
    if (params.to && item.timestamp > params.to) return false;
    if (params.status && params.status !== "ALL" && item.status !== params.status)
      return false;
    return true;
  });
}

export function ppeLabel(item: PPEItem): string {
  switch (item) {
    case "hardhat":
      return "Mũ bảo hộ";
    case "safety_vest":
      return "Áo phản quang";
    case "gloves":
      return "Găng tay";
    default:
      return item;
  }
}

export function notifyDataChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("ppe-data-changed"));
  }
}
