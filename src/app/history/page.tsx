"use client";

import { saveAs } from "file-saver";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { AppShell } from "@/components/app-shell";
import { getFilteredLogs, ppeLabel } from "@/lib/db";
import { formatDateTime } from "@/lib/ppe";
import { CheckStatus, PPELog } from "@/lib/types";

type FilterStatus = "ALL" | CheckStatus;

export default function HistoryPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<FilterStatus>("ALL");
  const [logs, setLogs] = useState<PPELog[]>([]);
  const [loading, setLoading] = useState(true);

  const fromTs = useMemo(() => (from ? new Date(from).getTime() : undefined), [from]);
  const toTs = useMemo(() => {
    if (!to) return undefined;
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    return end.getTime();
  }, [to]);

  const loadLogs = useCallback(async () => {
    setLoading(true);
    const data = await getFilteredLogs({ from: fromTs, to: toTs, status });
    setLogs(data);
    setLoading(false);
  }, [fromTs, status, toTs]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadLogs();
    const handler = () => void loadLogs();
    window.addEventListener("ppe-data-changed", handler);
    return () => window.removeEventListener("ppe-data-changed", handler);
  }, [loadLogs]);

  const onExport = useCallback(() => {
    const rows = logs.map((log) => ({
      "Thời gian": formatDateTime(log.timestamp),
      "Trạng thái": log.status,
      "PPE phát hiện": log.detectedItems.length
        ? log.detectedItems.map(ppeLabel).join(", ")
        : "Không",
      "PPE thiếu": log.missingItems.length ? log.missingItems.map(ppeLabel).join(", ") : "Không",
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PPE Logs");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });

    const blob = new Blob([out], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(blob, `ppe-logs-${Date.now()}.xlsx`);
  }, [logs]);

  return (
    <AppShell>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-slate-800">Lịch sử kiểm tra PPE</h2>

        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Từ ngày
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Đến ngày
            <input
              type="date"
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Trạng thái
            <select
              className="rounded-lg border border-slate-300 px-3 py-2"
              value={status}
              onChange={(e) => setStatus(e.target.value as FilterStatus)}
            >
              <option value="ALL">ALL</option>
              <option value="ALLOWED">ALLOWED</option>
              <option value="DENIED">DENIED</option>
            </select>
          </label>

          <div className="flex items-end gap-2">
            <button
              className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
              onClick={() => void loadLogs()}
            >
              Lọc
            </button>
            <button
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={onExport}
              disabled={logs.length === 0}
            >
              Export Excel
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="px-3 py-2">Thời gian</th>
                <th className="px-3 py-2">Trạng thái</th>
                <th className="px-3 py-2">PPE phát hiện</th>
                <th className="px-3 py-2">PPE thiếu</th>
                <th className="px-3 py-2">Snapshot</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={5}>
                    Đang tải...
                  </td>
                </tr>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-slate-500" colSpan={5}>
                    Không có dữ liệu phù hợp.
                  </td>
                </tr>
              )}
              {!loading &&
                logs.map((log) => (
                  <tr key={log.id ?? log.timestamp} className="border-t border-slate-200">
                    <td className="px-3 py-2">{formatDateTime(log.timestamp)}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          log.status === "ALLOWED"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {log.detectedItems.length ? log.detectedItems.map(ppeLabel).join(", ") : "Không"}
                    </td>
                    <td className="px-3 py-2">
                      {log.missingItems.length ? log.missingItems.map(ppeLabel).join(", ") : "Không"}
                    </td>
                    <td className="px-3 py-2">
                      {log.snapshotBase64 ? (
                        <a
                          href={log.snapshotBase64}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline"
                        >
                          Xem ảnh
                        </a>
                      ) : (
                        <span className="text-slate-400">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
