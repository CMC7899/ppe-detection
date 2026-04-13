# PPE Detection Web (Offline-First)

A browser-based PPE (Personal Protective Equipment) inspection system built with Next.js.
It uses the current device camera to evaluate worker safety gear before access is allowed.

---

## 1) Product Summary

PPE Detection Web is designed for **local-first / edge-first** operation:

- Camera input from the current device (`getUserMedia`)
- ROI-based inspection trigger
- Real-time checklist and gate decision
- Local persistence in IndexedDB (Dexie)
- Browser-side report export (Excel)
- Optional local TFLite inference + Google AI fallback

This implementation currently prioritizes **Google AI API flow** in Dashboard (`DISABLE_LOCAL_TFLITE = true`), while the code path for local TFLite remains available.

---

## 2) Functional Scope

### Dashboard (`/dashboard`)

Left panel:
- Live camera preview
- ROI rectangle drawing/editing on overlay canvas
- Camera selector for multi-camera devices
- Camera status message (`connecting`, `ready`, `denied`, `not_found`, `error`)

Right panel:
- Real-time PPE checklist
- Gate decision badge (`Allowed` / `Denied`)
- Person-in-ROI timer (must hold for 2 seconds)
- Latest 5 inspection logs

Core behavior:
- Inspection only counts when a person remains in ROI for at least `2s`
- Debounced logging (`3s` cooldown) prevents frame-by-frame spam logs
- Snapshot is captured and saved with each finalized inspection event

### History (`/history`)

- View inspection logs from IndexedDB
- Filters:
  - Date range (`From`, `To`)
  - Status (`ALL`, `ALLOWED`, `DENIED`)
- Export filtered rows to Excel (`.xlsx`)
- Open stored snapshots

### Settings (`/settings`)

- Adjust confidence threshold (`0.0`–`1.0`)
- Toggle required PPE items
- Edit default ROI (`x`, `y`, `width`, `height`, normalized)
- Save locally and auto-restore on reload

---

## 3) PPE Decision Rules

Default pass requirements:
1. `person = true`
2. `hardhat = true`
3. `safety_vest = true`

Optional requirement:
- `gloves` can be enabled as required in Settings

Additional business exception implemented:
- `bossHat = true` (stylish/non-safety manager hat) can satisfy hardhat requirement in Google AI response mapping.

Final status:
- `Allowed` if required checklist is satisfied after ROI hold condition
- `Denied` otherwise

---

## 4) Data & Storage Design

### IndexedDB Database (`ppe_detection_db`)

#### `logs` table
Stores each finalized inspection event:
- `timestamp`
- `snapshotBase64`
- `detectedItems[]`
- `missingItems[]`
- `status` (`ALLOWED` / `DENIED`)

#### `settings` table
Stores runtime configuration:
- `confidenceThreshold`
- `requiredPPE[]`
- `roiRect`

Everything is read/written locally for offline-first behavior.

---

## 5) AI / Inference Design

### Local inference path
- MediaPipe Tasks Vision (`@mediapipe/tasks-vision`)
- Object detector + overlay + label mapping
- Currently disabled by flag in Dashboard for stability in current release

### Google AI fallback path
- API route: `src/app/api/ppe-detect/route.ts`
- Image snapshot + ROI sent to model prompt
- Stream parsing with safe JSON extraction
- Parse failures are returned explicitly as `ok: false` with debug context

Model currently configured in route:
- `gemini-3.1-pro-preview`

---

## 6) UI / Visual Design

Design language: **clean industrial dashboard**

Palette:
- Background: `#F8FAFC`
- Card: `#FFFFFF`
- Border: `#E2E8F0`
- Primary: `#3B82F6`
- Success: `#22C55E`
- Danger: `#EF4444`

UX goals:
- One-glance safety decision
- Clear camera/AI state visibility
- Fast operator flow on laptop devices

---

## 7) Tech Stack

- Next.js (App Router)
- React + TypeScript
- Tailwind CSS
- Dexie.js (IndexedDB)
- MediaPipe Tasks Vision (`@mediapipe/tasks-vision`)
- Google AI (Gemini) API
- `xlsx` + `file-saver` for report export

---

## 8) Environment Variables

Create `.env.local` in project root:

```env
GOOGLE_AI_API_KEY=YOUR_API_KEY
# Optional alias:
# GEMINI_API_KEY=YOUR_API_KEY
```

---

## 9) Run Locally

```bash
npm install
npm run dev
```

Open:
- `http://localhost:3000/dashboard`

---

## 10) Current Status

- UI language: **English** across navigation and pages
- Dashboard / History / Settings implemented
- Local storage + export flow implemented
- Google AI route hardened for common parse/runtime failures

Public repository:
- https://github.com/CMC7899/ppe-detection
