"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { getSettings, saveSettings } from "@/lib/db";
import { normalizeRoi } from "@/lib/ppe";
import { AppSettings, PPEItem } from "@/lib/types";

const PPE_OPTIONS: { key: PPEItem; label: string }[] = [
  { key: "hardhat", label: "Mũ bảo hộ (hardhat)" },
  { key: "safety_vest", label: "Áo phản quang (safety_vest)" },
  { key: "gloves", label: "Găng tay (gloves)" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const data = await getSettings();
      setSettings(data);
    })();
  }, []);

  const toggleRequired = useCallback((item: PPEItem) => {
    setSettings((prev) => {
      if (!prev) return prev;
      const has = prev.requiredPPE.includes(item);
      const requiredPPE = has
        ? prev.requiredPPE.filter((p) => p !== item)
        : [...prev.requiredPPE, item];
      return { ...prev, requiredPPE };
    });
  }, []);

  const onSave = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    const normalized: AppSettings = {
      ...settings,
      confidenceThreshold: Math.min(1, Math.max(0, settings.confidenceThreshold)),
      roiRect: normalizeRoi(settings.roiRect),
    };
    await saveSettings(normalized);
    setSettings(normalized);
    setSaving(false);
  }, [settings]);

  if (!settings) {
    return (
      <AppShell>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
          Đang tải cài đặt...
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-800">Cài đặt hệ thống</h2>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Confidence Threshold (0 - 1)
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={settings.confidenceThreshold}
              onChange={(e) =>
                setSettings((prev) =>
                  prev
                    ? { ...prev, confidenceThreshold: Number(e.target.value) }
                    : prev,
                )
              }
            />
          </label>

          <div className="rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">PPE bắt buộc</p>
            <div className="space-y-2 text-sm">
              {PPE_OPTIONS.map((option) => (
                <label key={option.key} className="flex items-center gap-2 text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.requiredPPE.includes(option.key)}
                    onChange={() => toggleRequired(option.key)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3 md:col-span-2">
            <p className="mb-2 text-sm font-medium text-slate-700">ROI mặc định (tọa độ tương đối 0 - 1)</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(["x", "y", "width", "height"] as const).map((key) => (
                <label key={key} className="flex flex-col gap-1 text-xs text-slate-600">
                  {key}
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    max={1}
                    className="rounded-lg border border-slate-300 px-2 py-1.5"
                    value={settings.roiRect[key]}
                    onChange={(e) =>
                      setSettings((prev) =>
                        prev
                          ? {
                              ...prev,
                              roiRect: {
                                ...prev.roiRect,
                                [key]: Number(e.target.value),
                              },
                            }
                          : prev,
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => void onSave()}
            disabled={saving}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-60"
          >
            {saving ? "Đang lưu..." : "Lưu cài đặt"}
          </button>
          <p className="text-xs text-slate-500">Cài đặt được lưu local và áp dụng lại sau khi reload.</p>
        </div>
      </section>
    </AppShell>
  );
}
