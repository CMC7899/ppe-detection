export type PPEItem = "hardhat" | "safety_vest" | "gloves";

export type CheckStatus = "ALLOWED" | "DENIED";

export interface PPELog {
  id?: number;
  timestamp: number;
  snapshotBase64: string;
  detectedItems: PPEItem[];
  missingItems: PPEItem[];
  status: CheckStatus;
}

export interface AppSettings {
  id: number;
  confidenceThreshold: number;
  requiredPPE: PPEItem[];
  roiRect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface ChecklistState {
  person: boolean;
  hardhat: boolean;
  safety_vest: boolean;
  gloves: boolean;
}

export interface DetectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
  label: string;
}
