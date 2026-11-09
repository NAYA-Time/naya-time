"use client";
import { useActionState } from "react";
import { regenerateRecoveryCodes } from "@/lib/admin-actions-auth";

export function RecoveryCodes() {
  const [state, run, pending] = useActionState(regenerateRecoveryCodes, undefined);
  if (state?.codes) {
    return (
      <div className="grid gap-4">
        <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn">Diese Codes werden nur jetzt angezeigt. Bitte ausdrucken oder im Passwort-Manager speichern – nicht auf dem Handy mit der Authenticator-App.</p>
        <ol className="grid grid-cols-2 gap-2 font-mono text-lg tracking-wider select-text sm:grid-cols-5">
          {state.codes.map((c) => <li key={c} className="rounded-lg border border-line bg-ink px-3 py-2 text-center">{c}</li>)}
        </ol>
        <button onClick={() => window.print()} className="min-h-12 justify-self-start rounded-xl border border-line px-5 hover:bg-slate">Drucken</button>
      </div>
    );
  }
  return (
    <form action={run} className="grid max-w-md gap-4">
      <label className="grid gap-1.5 text-sm text-mute">Zur Sicherheit: dein Kennwort
        <input name="password" type="password" required autoComplete="current-password" className="min-h-12 rounded-xl border border-line bg-ink px-4 text-base text-paper focus:border-gold focus:outline-none" />
      </label>
      {state?.error && <p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-bad">{state.error}</p>}
      <button disabled={pending} className="min-h-12 rounded-xl bg-gold px-6 font-semibold tracking-wide text-ink disabled:opacity-50">{pending ? "Bitte warten …" : "Neue Wiederherstellungscodes erzeugen"}</button>
    </form>
  );
}
