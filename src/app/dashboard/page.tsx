"use client";

import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { addLog, getLatestLogs, getSettings, ppeLabel, saveSettings } from "@/lib/db";
import { buildChecklist, evaluateStatus, formatDateTime, isPersonInRoi, mapLabelToItem, normalizeRoi } from "@/lib/ppe";
import { AppSettings, ChecklistState, DetectionBox, PPELog } from "@/lib/types";

type CameraState = "connecting" | "ready" | "denied" | "not_found" | "error";
type DetectorState = "loading" | "ready" | "unavailable";

type DetectorLike = {
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => {
    detections?: Array<{
      boundingBox?: { originX?: number; originY?: number; width?: number; height?: number };
      categories?: Array<{ categoryName?: string; score?: number }>;
    }>;
  };
  close?: () => void;
};

const EMPTY_CHECKLIST: ChecklistState = {
  person: false,
  hardhat: false,
  safety_vest: false,
  gloves: false,
};

const LOG_COOLDOWN_MS = 3000;
const ROI_HOLD_MS = 2000;
const API_POLL_MS = 1500;
const DISABLE_LOCAL_TFLITE = true;

export default function DashboardPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<DetectorLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const roiEnteredAtRef = useRef<number | null>(null);
  const lastLoggedAtRef = useRef(0);
  const roiStartRef = useRef<{ x: number; y: number } | null>(null);
  const apiBusyRef = useRef(false);
  const lastApiAtRef = useRef(0);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [latestLogs, setLatestLogs] = useState<PPELog[]>([]);

  const [cameraState, setCameraState] = useState<CameraState>("connecting");
  const [detectorState, setDetectorState] = useState<DetectorState>("loading");
  const [detectorError, setDetectorError] = useState<string>("");
  const [engine, setEngine] = useState<"tflite" | "google_ai">("tflite");

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("default");

  const [checklist, setChecklist] = useState<ChecklistState>(EMPTY_CHECKLIST);
  const [inRoiForMs, setInRoiForMs] = useState(0);
  const [isAllowed, setIsAllowed] = useState(false);
  const [roiDraft, setRoiDraft] = useState<AppSettings["roiRect"] | null>(null);
  const [dragging, setDragging] = useState(false);

  const loadLatestLogs = useCallback(async () => {
    setLatestLogs(await getLatestLogs(5));
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const s = await getSettings();
      if (!mounted) return;
      setSettings(s);
      setRoiDraft(s.roiRect);
      await loadLatestLogs();
    })();

    const handler = () => void loadLatestLogs();
    window.addEventListener("ppe-data-changed", handler);
    return () => {
      mounted = false;
      window.removeEventListener("ppe-data-changed", handler);
    };
  }, [loadLatestLogs]);

  const roi = useMemo(
    () => roiDraft ?? settings?.roiRect ?? { x: 0.2, y: 0.15, width: 0.6, height: 0.75 },
    [roiDraft, settings],
  );

  useEffect(() => {
    if (DISABLE_LOCAL_TFLITE) {
      setDetectorState("unavailable");
      setEngine("google_ai");
      setDetectorError("");
      return;
    }

    let active = true;
    void (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
        const detector = await ObjectDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath: "/models/gear_guard_net-tflite-float/gear_guard_net.tflite" },
          scoreThreshold: 0.4,
          runningMode: "VIDEO",
          maxResults: 20,
        });

        if (!active) return detector.close();
        detectorRef.current = detector as unknown as DetectorLike;
        setDetectorState("ready");
        setEngine("tflite");
      } catch (error) {
        setDetectorError(error instanceof Error ? error.message : "Detector error");
        setDetectorState("unavailable");
        setEngine("google_ai");
      }
    })();

    return () => {
      active = false;
      detectorRef.current?.close?.();
      detectorRef.current = null;
    };
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const queryDevices = useCallback(async () => {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    setDevices(cams);
    if (cams.length === 0) setCameraState("not_found");
  }, []);

  const startCamera = useCallback(async (wantedDeviceId?: string) => {
    try {
      setCameraState("connecting");
      stopStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video:
          wantedDeviceId && wantedDeviceId !== "default"
            ? { deviceId: { exact: wantedDeviceId }, width: { ideal: 960 }, height: { ideal: 540 } }
            : { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } },
      });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      await queryDevices();
      setCameraState("ready");
    } catch (error) {
      const name = (error as DOMException)?.name;
      setCameraState(name === "NotAllowedError" ? "denied" : name === "NotFoundError" ? "not_found" : "error");
    }
  }, [queryDevices, stopStream]);

  useEffect(() => {
    void startCamera(deviceId);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopStream();
    };
  }, [deviceId, startCamera, stopStream]);

  const captureSnapshot = useCallback(() => {
    const video = videoRef.current;
    const canvas = snapshotRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return "";
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  }, []);

  const persistRoi = useCallback(async (nextRoi: AppSettings["roiRect"]) => {
    if (!settings) return;
    const next = { ...settings, roiRect: normalizeRoi(nextRoi) };
    setSettings(next);
    setRoiDraft(next.roiRect);
    await saveSettings(next);
  }, [settings]);

  const applyChecklist = useCallback(async (nextChecklist: ChecklistState, personInRoi: boolean) => {
    if (!settings) return;
    const now = Date.now();
    const status = evaluateStatus(nextChecklist, settings);

    if (personInRoi) {
      if (!roiEnteredAtRef.current) roiEnteredAtRef.current = now;
    } else {
      roiEnteredAtRef.current = null;
    }

    const hold = roiEnteredAtRef.current ? now - roiEnteredAtRef.current : 0;
    const gateReached = hold >= ROI_HOLD_MS;

    setChecklist(nextChecklist);
    setInRoiForMs(hold);
    setIsAllowed(gateReached && status.isAllowed);

    if (gateReached && now - lastLoggedAtRef.current >= LOG_COOLDOWN_MS) {
      lastLoggedAtRef.current = now;
      await addLog({
        timestamp: now,
        snapshotBase64: captureSnapshot(),
        detectedItems: status.detectedItems,
        missingItems: status.missingItems,
        status: status.isAllowed ? "ALLOWED" : "DENIED",
      });
    }
  }, [captureSnapshot, settings]);

  useEffect(() => {
    const tick = () => {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      const detector = detectorRef.current;
      const currentSettings = settings;

      if (!video || !overlay || !currentSettings || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const w = video.videoWidth;
      const h = video.videoHeight;
      overlay.width = w;
      overlay.height = h;
      const ctx = overlay.getContext("2d");
      if (!ctx || !w || !h) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      ctx.clearRect(0, 0, w, h);
      const roiPx = { x: roi.x * w, y: roi.y * h, width: roi.width * w, height: roi.height * h };
      ctx.strokeStyle = "#3B82F6";
      ctx.lineWidth = 2;
      ctx.strokeRect(roiPx.x, roiPx.y, roiPx.width, roiPx.height);

      if (detectorState === "ready" && detector) {
        const detections = detector.detectForVideo(video, performance.now())?.detections ?? [];
        const items = new Set<"person" | "hardhat" | "safety_vest" | "gloves">();
        const personBoxes: DetectionBox[] = [];

        for (const d of detections) {
          const box = d.boundingBox;
          const cat = d.categories?.[0];
          const score = cat?.score ?? 0;
          const label = cat?.categoryName ?? "Unknown";
          if (!box || score < currentSettings.confidenceThreshold) continue;

          const b: DetectionBox = {
            x: (box.originX ?? 0) / w,
            y: (box.originY ?? 0) / h,
            width: (box.width ?? 0) / w,
            height: (box.height ?? 0) / h,
            score,
            label,
          };

          const mapped = mapLabelToItem(label);
          if (mapped) {
            items.add(mapped);
            if (mapped === "person") personBoxes.push(b);
          }
        }

        void applyChecklist(buildChecklist(items), isPersonInRoi(personBoxes, roi));
      } else {
        const now = Date.now();
        if (now - lastApiAtRef.current >= API_POLL_MS && !apiBusyRef.current) {
          lastApiAtRef.current = now;
          apiBusyRef.current = true;

          void fetch("/api/ppe-detect", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64: captureSnapshot(), roiRect: roi }),
          })
            .then((r) => r.json())
            .then((data: {
              ok?: boolean;
              checklist?: {
                person?: boolean;
                personInRoi?: boolean;
                hardhat?: boolean;
                safety_vest?: boolean;
                gloves?: boolean;
                bossHat?: boolean;
              };
              error?: string;
            }) => {
              if (!data.ok || !data.checklist) {
                if (data.error) setDetectorError(data.error);
                return;
              }

              const nextChecklist: ChecklistState = {
                person: Boolean(data.checklist.person),
                hardhat: Boolean(data.checklist.hardhat) || Boolean(data.checklist.bossHat),
                safety_vest: Boolean(data.checklist.safety_vest),
                gloves: Boolean(data.checklist.gloves),
              };

              void applyChecklist(nextChecklist, Boolean(data.checklist.personInRoi));
              setEngine("google_ai");
            })
            .catch((error: unknown) => {
              setDetectorError(error instanceof Error ? error.message : "Google AI request failed");
            })
            .finally(() => {
              apiBusyRef.current = false;
            });
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [applyChecklist, captureSnapshot, detectorState, roi, settings]);

  const getNormPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };

  const onDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const p = getNormPoint(event);
    if (!p) return;
    roiStartRef.current = p;
    setDragging(true);
    setRoiDraft({ x: p.x, y: p.y, width: 0.02, height: 0.02 });
  }, []);

  const onMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging || !roiStartRef.current) return;
    const p = getNormPoint(event);
    if (!p) return;
    const s = roiStartRef.current;
    setRoiDraft(normalizeRoi({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      width: Math.max(Math.abs(p.x - s.x), 0.02),
      height: Math.max(Math.abs(p.y - s.y), 0.02),
    }));
  }, [dragging]);

  const onUp = useCallback(async () => {
    setDragging(false);
    roiStartRef.current = null;
    if (roiDraft) await persistRoi(roiDraft);
  }, [persistRoi, roiDraft]);

  const cameraMessage = useMemo(() => {
    if (cameraState === "connecting") return "Connecting camera";
    if (cameraState === "ready") return "Camera ready";
    if (cameraState === "denied") return "Camera permission denied";
    if (cameraState === "not_found") return "No camera found";
    return "Camera error";
  }, [cameraState]);

  return (
    <AppShell>
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold text-slate-800">Monitoring Camera</h2>
            <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">{cameraMessage}</span>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">Engine: {engine === "tflite" ? "TFLite local" : "Google AI API"}</span>
          </div>

          <div className="mb-3 flex items-center gap-2">
            <label htmlFor="cameraSelect" className="text-sm text-slate-600">Camera</label>
            <select id="cameraSelect" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="default">Default</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0, 6)}`}</option>
              ))}
            </select>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            <video ref={videoRef} className="h-auto w-full" muted playsInline />
            <canvas ref={overlayRef} className="absolute inset-0 h-full w-full cursor-crosshair" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
          </div>
          <p className="mt-2 text-xs text-slate-500">Draw ROI on the video. PPE checks trigger only when a person stays in ROI for more than 2 seconds.</p>
          {detectorState === "unavailable" && (
            <p className="mt-1 text-xs text-amber-700">Local TFLite is temporarily disabled. Using Google AI API. {detectorError ? `Error: ${detectorError}` : ""}</p>
          )}
          <canvas ref={snapshotRef} className="hidden" />
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">PPE Checklist</h3>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isAllowed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{isAllowed ? "Allowed" : "Denied"}</span>
            </div>
            <ul className="space-y-2 text-sm">
              <li>{checklist.hardhat ? "[x]" : "[ ]"} Hardhat</li>
              <li>{checklist.safety_vest ? "[x]" : "[ ]"} Safety Vest</li>
              <li>{checklist.gloves ? "[x]" : "[ ]"} Gloves</li>
            </ul>
            <p className="mt-3 text-xs text-slate-500">Person in ROI: {(inRoiForMs / 1000).toFixed(1)}s / 2.0s</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Latest 5 Logs</h3>
            <div className="space-y-2 text-sm">
              {latestLogs.length === 0 && <p className="text-slate-500">No data yet.</p>}
              {latestLogs.map((log) => (
                <div key={log.id ?? log.timestamp} className="rounded-lg border border-slate-200 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{formatDateTime(log.timestamp)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${log.status === "ALLOWED" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{log.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">Missing: {log.missingItems.length ? log.missingItems.map(ppeLabel).join(", ") : "None"}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
