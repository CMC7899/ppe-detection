"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const CORRECT_PIN = "1234";
const COOKIE_KEY = "ppe_pin_verified";

export default function LoginPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    const cookies = document.cookie.split("; ");
    if (cookies.find((c) => c.startsWith(`${COOKIE_KEY}=1`))) {
      router.replace("/dashboard");
    }
  }, [router]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (pin === CORRECT_PIN) {
        document.cookie = `${COOKIE_KEY}=1; path=/; max-age=${60 * 60 * 24}`;
        router.replace("/dashboard");
      } else {
        setError(true);
        setPin("");
      }
    },
    [pin, router],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 8);
    setPin(val);
    if (error) setError(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100">
            <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-slate-800">PPE Detection</h1>
          <p className="mt-1 text-sm text-slate-500">Enter PIN to access the dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="pin" className="sr-only">PIN</label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="current-password"
              maxLength={8}
              placeholder="Enter PIN"
              value={pin}
              onChange={handleChange}
              className={`w-full rounded-lg border bg-slate-50 px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono transition focus:outline-none ${
                error
                  ? "border-red-400 bg-red-50 text-red-700 focus:border-red-500"
                  : "border-slate-300 text-slate-800 focus:border-blue-500"
              }`}
              autoFocus
            />
            {error && (
              <p className="mt-2 text-center text-sm text-red-600">Incorrect PIN. Please try again.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={pin.length === 0}
            className="w-full rounded-lg bg-blue-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Access Dashboard
          </button>
        </form>
      </div>
    </div>
  );
}
