$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$baseDir = "C:\Users\green\Downloads\OCR-Labor Protection\ppe-detection"
$dashDir = Join-Path $baseDir "src\app\dashboard"
$pageFile = Join-Path $dashDir "page.tsx"

if (-not (Test-Path $dashDir)) {
    New-Item -ItemType Directory -Path $dashDir -Force | Out-Null
}

$content = @'
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { addLog, getLatestLogs, getSettings, ppeLabel, saveSettings } from "@/lib/db";
import { buildChecklist, evaluateStatus, formatDateTime, normalizeRoi } from "@/lib/ppe";
import { AppSettings, ChecklistState, PPELog } from "@/lib/types";

type CameraState = "connecting" | "ready" | "denied" | "not_found" | "error";

const EMPTY: ChecklistState = { person: false, hardhat: false, safety_vest: false, gloves: false };
const LOG_MS = 3000, ROI_HOLD = 2000, API_POLL = 1500, PAUSE_IDLE = 3 * 60 * 1000;

export default function DashboardPage() {
  const videoRef = useRef<HTMLVideoElement>(null!);
  const overlayRef = useRef<HTMLCanvasElement>(null!);
  const snapshotRef = useRef<HTMLCanvasElement>(null!);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const roiEnteredAtRef = useRef<number | null>(null);
  const lastLoggedAtRef = useRef(0);
  const roiStartRef = useRef<{ x: number; y: number } | null>(null);
  const apiBusyRef = useRef(false);
  const lastApiAtRef = useRef(0);
  const lastInteractAtRef = useRef(Date.now());

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [latestLogs, setLatestLogs] = useState<PPELog[]>([]);
  const [cameraState, setCameraState] = useState<CameraState>("connecting");
  const [detectorError, setDetectorError] = useState<string>("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("default");
  const [checklist, setChecklist] = useState<ChecklistState>(EMPTY);
  const [inRoiForMs, setInRoiForMs] = useState(0);
  const [isAllowed, setIsAllowed] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [roiDraft, setRoiDraft] = useState<AppSettings["roiRect"] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [detectedBoxes, setDetectedBoxes] = useState<Array<{ x: number; y: number; width: number; height: number; label: string; ok: boolean }>>([]);

  const autoPauseEnabled = useMemo(() => settings?.autoPauseEnabled ?? true, [settings]);

  const loadLatestLogs = useCallback(async () => { setLatestLogs(await getLatestLogs(5)); }, []);

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
    return () => { mounted = false; window.removeEventListener("ppe-data-changed", handler); };
  }, [loadLatestLogs]);

  const roi = useMemo(() => roiDraft ?? settings?.roiRect ?? { x: 0.2, y: 0.15, width: 0.6, height: 0.75 }, [roiDraft, settings]);

  const stopStream = useCallback(() => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; }, []);

  const queryDevices = useCallback(async () => {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    setDevices(cams);
    if (cams.length === 0) setCameraState("not_found");
  }, []);

  const startCamera = useCallback(async (wantedDeviceId?: string) => {
    try {
      setCameraState("connecting");
      stopStream();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: wantedDeviceId && wantedDeviceId !== "default" ? { deviceId: { exact: wantedDeviceId }, width: { ideal: 960 }, height: { ideal: 540 } } : { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 } } });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      await queryDevices();
      setCameraState("ready");
      lastInteractAtRef.current = Date.now();
      setIsPaused(false);
    } catch (error) {
      const name = (error as DOMException)?.name;
      setCameraState(name === "NotAllowedError" ? "denied" : name === "NotFoundError" ? "not_found" : "error");
    }
  }, [queryDevices, stopStream]);

  useEffect(() => { void startCamera(deviceId); return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); stopStream(); }; }, [deviceId, startCamera, stopStream]);

  const captureSnapshot = useCallback(() => {
    const video = videoRef.current, canvas = snapshotRef.current;
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) return "";
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  }, []);

  const persistRoi = useCallback(async (nextRoi: AppSettings["roiRect"]) => {
    if (!settings) return;
    const next = { ...settings, roiRect: normalizeRoi(nextRoi) };
    setSettings(next); setRoiDraft(next.roiRect);
    await saveSettings(next);
    lastInteractAtRef.current = Date.now(); setIsPaused(false);
  }, [settings]);

  const applyChecklist = useCallback(async (nextChecklist: ChecklistState, personInRoi: boolean) => {
    if (!settings) return;
    const now = Date.now();
    const status = evaluateStatus(nextChecklist, settings);
    if (personInRoi) { if (!roiEnteredAtRef.current) roiEnteredAtRef.current = now; } else { roiEnteredAtRef.current = null; }
    const hold = roiEnteredAtRef.current ? now - roiEnteredAtRef.current : 0;
    const gateReached = hold >= ROI_HOLD;
    setChecklist(nextChecklist); setInRoiForMs(hold); setIsAllowed(gateReached && status.isAllowed);
    if (gateReached && now - lastLoggedAtRef.current >= LOG_MS) {
      lastLoggedAtRef.current = now;
      await addLog({ timestamp: now, snapshotBase64: captureSnapshot(), detectedItems: status.detectedItems, missingItems: status.missingItems, status: status.isAllowed ? "ALLOWED" : "DENIED" });
    }
  }, [captureSnapshot, settings]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!autoPauseEnabled) return;
      if (Date.now() - lastInteractAtRef.current >= PAUSE_IDLE) setIsPaused(true);
    }, 1000);
    return () => clearInterval(interval);
  }, [autoPauseEnabled]);

  useEffect(() => {
    if (!autoPauseEnabled) return;
    let lastX = 0, lastY = 0;
    const mouseHandler = (e: MouseEvent) => { if (e.clientX !== lastX || e.clientY !== lastY) { lastX = e.clientX; lastY = e.clientY; lastInteractAtRef.current = Date.now(); } };
    const simpleHandler = () => { lastInteractAtRef.current = Date.now(); };
    window.addEventListener("mousemove", mouseHandler, { passive: true });
    ["mousedown", "keydown", "touchstart", "scroll"].forEach((e) => window.addEventListener(e, simpleHandler, { passive: true }));
    return () => { window.removeEventListener("mousemove", mouseHandler); ["mousedown", "keydown", "touchstart", "scroll"].forEach((e) => window.removeEventListener(e, simpleHandler)); };
  }, [autoPauseEnabled]);

  useEffect(() => {
    const tick = () => {
      const video = videoRef.current, overlay = overlayRef.current;
      if (!video || !overlay || video.readyState < 2) { rafRef.current = requestAnimationFrame(tick); return; }
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) { rafRef.current = requestAnimationFrame(tick); return; }
      overlay.width = w; overlay.height = h;
      const ctx = overlay.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      const roiPx = { x: roi.x * w, y: roi.y * h, width: roi.width * w, height: roi.height * h };
      ctx.strokeStyle = isPaused ? "#94A3B8" : "#3B82F6";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(roiPx.x, roiPx.y, roiPx.width, roiPx.height);
      ctx.setLineDash([]);
      for (const box of detectedBoxes) {
        const bx = box.x * w, by = box.y * h, bw = box.width * w, bh = box.height * h;
        ctx.strokeStyle = box.ok ? "#22C55E" : "#EF4444";
        ctx.lineWidth = 3;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = box.ok ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.font = "bold 14px system-ui";
        const tw = ctx.measureText(box.label).width;
        ctx.fillStyle = box.ok ? "rgba(34,197,94,0.85)" : "rgba(239,68,68,0.85)";
        ctx.fillRect(bx, by - 22, tw + 14, 20);
        ctx.fillStyle = "#fff";
        ctx.fillText(box.label, bx + 7, by - 7);
      }
      if (!isPaused) {
        const now = Date.now();
        if (now - lastApiAtRef.current >= API_POLL && !apiBusyRef.current) {
          lastApiAtRef.current = now; apiBusyRef.current = true;
          void fetch("/api/ppe-detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: captureSnapshot(), roiRect: roi }) })
            .then((r) => r.json())
            .then((data: { ok?: boolean; checklist?: { person?: boolean; personInRoi?: boolean; hardhat?: boolean; safety_vest?: boolean; gloves?: boolean; bossHat?: boolean }; error?: string }) => {
              if (!data.ok || !data.checklist) { if (data.error) setDetectorError(data.error); return; }
              const nc: ChecklistState = { person: Boolean(data.checklist.person), hardhat: Boolean(data.checklist.hardhat) || Boolean(data.checklist.bossHat), safety_vest: Boolean(data.checklist.safety_vest), gloves: Boolean(data.checklist.gloves) };
              const boxes: typeof detectedBoxes = [];
              if (nc.person) boxes.push({ x: 0.2, y: 0.15, width: 0.6, height: 0.75, label: "Person", ok: true });
              if (nc.hardhat) boxes.push({ x: 0.35, y: 0.08, width: 0.1, height: 0.1, label: "Hardhat", ok: true });
              if (nc.safety_vest) boxes.push({ x: 0.3, y: 0.25, width: 0.15, height: 0.25, label: "Safety Vest", ok: true });
              if (nc.gloves) boxes.push({ x: 0.62, y: 0.55, width: 0.08, height: 0.1, label: "Gloves", ok: true });
              setDetectedBoxes(boxes);
              void applyChecklist(nc, Boolean(data.checklist.personInRoi));
            })
            .catch((e: unknown) => { setDetectorError(e instanceof Error ? e.message : "Request failed"); })
            .finally(() => { apiBusyRef.current = false; });
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [applyChecklist, captureSnapshot, isPaused, roi, settings]);

  const getNormPoint = (e: React.PointerEvent<HTMLCanvasElement>) => { const rect = overlayRef.current?.getBoundingClientRect(); if (!rect) return null; return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height }; };
  const onDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => { const p = getNormPoint(e); if (!p) return; roiStartRef.current = p; setDragging(true); setRoiDraft({ x: p.x, y: p.y, width: 0.02, height: 0.02 }); lastInteractAtRef.current = Date.now(); }, []);
  const onMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => { if (!dragging || !roiStartRef.current) return; const p = getNormPoint(e); if (!p) return; const s = roiStartRef.current; setRoiDraft(normalizeRoi({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), width: Math.max(Math.abs(p.x - s.x), 0.02), height: Math.max(Math.abs(p.y - s.y), 0.02) })); }, [dragging]);
  const onUp = useCallback(async () => { setDragging(false); roiStartRef.current = null; if (roiDraft) await persistRoi(roiDraft); }, [persistRoi, roiDraft]);

  const cameraMessage = cameraState === "ready" ? "Live" : cameraState === "connecting" ? "Connecting..." : cameraState === "denied" ? "Camera Denied" : cameraState === "not_found" ? "No Camera" : "Error";
  const requiredPPE = settings?.requiredPPE ?? ["hardhat", "safety_vest"];
  const missingCount = requiredPPE.filter((k) => !checklist[k as keyof ChecklistState]).length;

  return (
    <AppShell>
      {isPaused && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-sm cursor-pointer" onClick={() => { lastInteractAtRef.current = Date.now(); setIsPaused(false); }}>
          <div className="rounded-2xl bg-white p-12 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-amber-100">
              <svg className="h-10 w-10 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <h2 className="mb-2 text-3xl font-black text-slate-800">Session Paused</h2>
            <p className="mb-2 text-base text-slate-500">No activity detected for 3 minutes.</p>
            <p className="mb-8 text-base text-slate-500">Click anywhere to resume.</p>
            <button className="rounded-xl bg-blue-500 px-8 py-4 text-lg font-bold text-white hover:bg-blue-600 transition shadow-lg">Resume Session</button>
          </div>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-black text-slate-800">Live Camera</h2>
            <span className={"rounded-full px-3 py-1 text-xs font-bold " + (cameraState === "ready" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>{cameraMessage}</span>
            {isPaused && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">Paused</span>}
          </div>
          <div className="mb-3 flex items-center gap-3">
            <label className="text-sm font-semibold text-slate-600">Camera:</label>
            <select className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="default">Default</option>
              {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Camera " + d.deviceId.slice(0, 6)}</option>)}
            </select>
          </div>
          <div className="relative overflow-hidden rounded-xl border-2 border-slate-200 bg-slate-900">
            <video ref={videoRef} className="h-auto w-full" muted playsInline />
            <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
          </div>
          <p className="mt-2 text-xs text-slate-500">Draw ROI to define inspection zone. Person must stay in ROI for 2+ seconds.</p>
          {detectorError && <p className="mt-1 text-xs text-red-600">Error: {detectorError}</p>}
          <canvas ref={snapshotRef} className="hidden" />
        </section>
        <section className="space-y-4">
          <div className={"rounded-2xl border-2 p-6 shadow-lg " + (isAllowed ? "border-emerald-400 bg-emerald-50" : "border-red-400 bg-red-50")}>
            <div className="mb-6 text-center">
              <div className={"mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full " + (isAllowed ? "bg-emerald-500" : "bg-red-500")}>
                {isAllowed ? (
                  <svg className="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="h-12 w-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                )}
              </div>
              <span className={"inline-block rounded-xl px-6 py-3 text-2xl font-black tracking-wider " + (isAllowed ? "bg-emerald-500 text-white" : "bg-red-500 text-white")}>{isAllowed ? "ALLOWED" : "DENIED"}</span>
              <p className="mt-3 text-sm text-slate-500">{isAllowed ? "All required PPE detected." : missingCount > 0 ? "Missing " + missingCount + " required item" + (missingCount > 1 ? "s" : "") + "." : "Scanning..."}</p>
            </div>
            <div className="space-y-3">
              {[{ key: "hardhat", label: "Hardhat", icon: "H", required: requiredPPE.includes("hardhat") }, { key: "safety_vest", label: "Safety Vest", icon: "V", required: requiredPPE.includes("safety_vest") }, { key: "gloves", label: "Gloves", icon: "G", required: requiredPPE.includes("gloves") }].map(({ key, label, icon, required }) => {
                const checked = checklist[key as keyof ChecklistState];
                return (
                  <div key={key} className={"flex items-center gap-4 rounded-xl px-5 py-4 " + (checked ? "bg-emerald-100" : required ? "bg-red-100" : "bg-slate-100")}>
                    <div className={"flex h-12 w-12 items-center justify-center rounded-xl text-xl font-black " + (checked ? "bg-emerald-500 text-white" : required ? "bg-red-500 text-white" : "bg-slate-300 text-slate-600")}>{icon}</div>
                    <div className="flex-1">
                      <p className={"text-lg font-bold " + (checked ? "text-emerald-800" : required ? "text-red-800" : "text-slate-500")}>{label}</p>
                      {!required && <p className="text-xs text-slate-400">Optional</p>}
                    </div>
                    <div className={"flex h-10 w-10 items-center justify-center rounded-full " + (checked ? "bg-emerald-500" : required ? "bg-red-500" : "bg-slate-300")}>
                      {checked ? (
                        <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                      ) : required ? (
                        <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      ) : <span className="text-xs font-bold text-white">-</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex items-center gap-3 rounded-xl bg-white/70 px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-slate-500">Person in ROI</p>
                <p className={"text-2xl font-black " + (inRoiForMs >= ROI_HOLD ? "text-emerald-600" : "text-slate-700")}>{(inRoiForMs / 1000).toFixed(1)}s</p>
              </div>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-200">
                <div className={"h-full rounded-full transition-all " + (inRoiForMs >= ROI_HOLD ? "bg-emerald-500" : "bg-blue-500")} style={{ width: Math.min((inRoiForMs / ROI_HOLD) * 100, 100) + "%" }} />
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-slate-500">Required</p>
                <p className="text-lg font-black text-slate-700">2.0s</p>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-bold text-slate-700">Recent Inspections</h3>
            <div className="space-y-2">
              {latestLogs.length === 0 && <p className="text-sm text-slate-400">No records yet.</p>}
              {latestLogs.map((log) => (
                <div key={log.id ?? log.timestamp} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <div>
                    <p className="text-xs text-slate-500">{formatDateTime(log.timestamp)}</p>
                    <p className="text-xs text-slate-400">Missing: {log.missingItems.length ? log.missingItems.map(ppeLabel).join(", ") : "-"}</p>
                  </div>
                  <span className={"rounded-full px-2 py-0.5 text-xs font-bold " + (log.status === "ALLOWED" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>{log.status === "ALLOWED" ? "OK" : "FAIL"}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
'@

Set-Content -Path $pageFile -Value $content -Encoding UTF8
Write-Host "Written: $pageFile"
Write-Host "Size: $((Get-Item $pageFile).Length) bytes"
