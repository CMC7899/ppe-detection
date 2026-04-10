# PPE Detection Web (Offline-First)

A browser-based PPE (Personal Protective Equipment) inspection system built with Next.js.
It uses the laptop camera to evaluate worker safety gear before access is allowed.

## Overview

This app is designed for local-first operation:
- Camera input from the current device (`getUserMedia`)
- On-device inference with MediaPipe TFLite (when enabled)
- Fallback AI inference via Google Gemini API
- Local data persistence with IndexedDB (Dexie)
- No relay/controller integration

## Key Features

### 1. Dashboard (`/dashboard`)

- Real-time camera stream
- ROI (Region of Interest) drawing directly on the video
- PPE checklist status panel
- Access decision badge:
  - `Allowed`
  - `Denied`
- Last 5 inspection logs
- AI engine indicator:
  - Local TFLite
  - Google AI API fallback

#### PPE decision logic

Default pass condition:
- `Person` detected
- `Hardhat` detected
- `Safety Vest` detected

Optional:
- `Gloves` can be required in Settings

Special rule currently supported:
- `bossHat` (stylish/non-safety hat manager exception) can satisfy the hardhat requirement in Google AI mode.

### 2. History (`/history`)

- View logs from IndexedDB
- Filter by:
  - date range (`from`, `to`)
  - status (`ALL`, `ALLOWED`, `DENIED`)
- Export logs to Excel (`.xlsx`)
- Open captured snapshots

### 3. Settings (`/settings`)

- Configure confidence threshold
- Configure required PPE items
- Configure default ROI rectangle
- Persisted locally and restored on reload

## Data Model

### Logs
Each inspection entry stores:
- timestamp
- snapshotBase64
- detectedItems[]
- missingItems[]
- status (`ALLOWED` / `DENIED`)

### Settings
Stored locally in IndexedDB:
- confidenceThreshold
- requiredPPE[]
- roiRect

## Tech Stack

- Next.js (App Router)
- React + TypeScript
- Tailwind CSS
- Dexie.js (IndexedDB)
- MediaPipe Tasks Vision (`@mediapipe/tasks-vision`)
- Google Gemini API (fallback AI)
- `xlsx` + `file-saver` for Excel export

## UI / Design System

Theme direction (light industrial UI):
- Background: `#F8FAFC`
- Card: `#FFFFFF`
- Border: `#E2E8F0`
- Primary: `#3B82F6`
- Success: `#22C55E`
- Danger: `#EF4444`

UX goals:
- At-a-glance safety status
- Fast operator workflow
- Clear camera and AI state feedback

## Environment Variables

Create `.env.local` in project root:

```env
GOOGLE_AI_API_KEY=YOUR_API_KEY
# Optional alias:
# GEMINI_API_KEY=YOUR_API_KEY
```

## Run Locally

```bash
npm install
npm run dev
```

Open:
- `http://localhost:3000/dashboard`

## Notes

- This app is currently configured with local TFLite disabled in dashboard (`DISABLE_LOCAL_TFLITE = true`) and uses Google AI fallback flow.
- If you want to re-enable local inference, update `src/app/dashboard/page.tsx` accordingly.

## Repository

Public repo:
- https://github.com/CMC7899/ppe-detection
