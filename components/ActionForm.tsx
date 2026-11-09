"use client";
import { useActionState } from "react";
import type { FormState } from "@/lib/admin-actions-auth";

/** Formular für Server-Aktionen mit Fehlermeldung und Lade-Zustand */
export function ActionForm({ action, children, submit, className = "grid gap-4" }: {
  action: (s: FormState, fd: FormData) => Promise<FormState>; children: React.ReactNode; submit: string; className?: string;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className={className}>
      {children}
      {state?.error && <p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-bad">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-xl border border-good/40 bg-good/10 px-4 py-3 text-good">{state.ok}</p>}
      <button disabled={pending} className="min-h-12 rounded-xl bg-gold px-6 font-semibold tracking-wide text-ink active:bg-gold-deep disabled:opacity-50">
        {pending ? "Bitte warten …" : submit}
      </button>
    </form>
  );
}

export function Field({ label, name, type = "text", defaultValue, required, autoComplete, hint, inputMode, min, step }: {
  label: string; name: string; type?: string; defaultValue?: string | number | null; required?: boolean; autoComplete?: string; hint?: string;
  inputMode?: "numeric" | "decimal" | "text" | "email"; min?: number; step?: number | string;
}) {
  return (
    <label className="grid gap-1.5 text-sm text-mute">
      {label}
      <input name={name} type={type} defaultValue={defaultValue ?? undefined} required={required} autoComplete={autoComplete} inputMode={inputMode} min={min} step={step}
        className="min-h-12 w-full min-w-0 rounded-xl border border-line bg-ink px-4 text-base text-paper select-text focus:border-gold focus:outline-none" />
      {hint && <span className="text-xs">{hint}</span>}
    </label>
  );
}
