import { AppSettings, ChecklistState, DetectionBox, PPEItem } from "./types";

export const DEFAULT_ROI = { x: 0.2, y: 0.15, width: 0.6, height: 0.75 };

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function normalizeRoi(roi: {
  x: number;
  y: number;
  width: number;
  height: number;
}): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const x = clamp01(roi.x);
  const y = clamp01(roi.y);
  const width = clamp01(roi.width);
  const height = clamp01(roi.height);

  return {
    x,
    y,
    width: Math.min(width, 1 - x),
    height: Math.min(height, 1 - y),
  };
}

export function normalizeLabel(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function mapLabelToItem(label: string): "person" | PPEItem | null {
  const normalized = normalizeLabel(label);

  if (normalized.includes("person") || normalized === "worker") return "person";
  if (
    normalized.includes("hardhat") ||
    normalized.includes("helmet") ||
    normalized.includes("hard_hat")
  ) {
    return "hardhat";
  }
  if (
    normalized.includes("safety_vest") ||
    normalized.includes("vest") ||
    normalized.includes("reflective_vest")
  ) {
    return "safety_vest";
  }
  if (normalized.includes("glove") || normalized.includes("gloves")) {
    return "gloves";
  }

  return null;
}

export function buildChecklist(
  detections: Set<"person" | PPEItem>,
): ChecklistState {
  return {
    person: detections.has("person"),
    hardhat: detections.has("hardhat"),
    safety_vest: detections.has("safety_vest"),
    gloves: detections.has("gloves"),
  };
}

export function evaluateStatus(checklist: ChecklistState, settings: AppSettings): {
  detectedItems: PPEItem[];
  missingItems: PPEItem[];
  isAllowed: boolean;
} {
  const detectedItems = (Object.keys(checklist) as (keyof ChecklistState)[])
    .filter((k) => k !== "person")
    .filter((k) => checklist[k]) as PPEItem[];

  const missingItems = settings.requiredPPE.filter((item) => !checklist[item]);

  const isAllowed = checklist.person && missingItems.length === 0;

  return { detectedItems, missingItems, isAllowed };
}

export function isPersonInRoi(personBoxes: DetectionBox[], roi: AppSettings["roiRect"]): boolean {
  return personBoxes.some((box) => {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    return (
      centerX >= roi.x &&
      centerX <= roi.x + roi.width &&
      centerY >= roi.y &&
      centerY <= roi.y + roi.height
    );
  });
}

export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(timestamp));
}
