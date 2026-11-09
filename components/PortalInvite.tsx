"use client";
import { useActionState, useState } from "react";
import { createPortalInviteAction } from "@/lib/admin-actions-portal";

export function PortalInvite({ id, hasPassword }: { id: string; hasPassword: boolean }) {
  const [state, run, pending] = useActionState(createPortalInviteAction, undefined);
  const [copied, setCopied] = useState(false);
  return (
    <form action={run} className="grid gap-3">
      <input type="hidden" name="id" value={id} />
      <button disabled={pending} className="min-h-12 rounded-xl border border-gold px-6 font-semibold text-gold disabled:opacity-50">
        {pending ? "Bitte warten …" : hasPassword ? "Neuen Einladungslink erzeugen (Passwort vergessen)" : "Einladungslink fürs Handy erzeugen"}
      </button>
      {state?.error && <p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-bad">{state.error}</p>}
      {state?.link && (
        <div className="grid gap-3 rounded-xl border border-line bg-ink p-4 sm:grid-cols-[auto_1fr] sm:items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.qr} alt="QR-Code zum Einladungslink" className="size-40 rounded-lg bg-white p-1" />
          <div className="grid min-w-0 gap-2 text-sm">
            <p>Mitarbeiter scannt den Code mit dem Handy oder du schickst ihm den Link (z. B. per WhatsApp). Gültig 7 Tage, nur einmal benutzbar.</p>
            <p className="break-all rounded-lg border border-line px-3 py-2 font-mono text-xs select-all">{state.link}</p>
            <button type="button" onClick={() => { navigator.clipboard?.writeText(state.link!); setCopied(true); }} className="min-h-11 justify-self-start rounded-lg border border-line px-4 hover:bg-slate">{copied ? "Kopiert ✓" : "Link kopieren"}</button>
          </div>
        </div>
      )}
    </form>
  );
}
