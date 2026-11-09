"use client";
// Dienstplan per Foto: Foto wählen → wird im Browser verkleinert → ausgelesen → Prüftabelle → erst dann speichern.
import { useState } from "react";
import { confirmPlanImport, readPlanPhoto } from "@/lib/admin-actions-plan-photo";
import type { CellKind, Proposal } from "@/lib/calc/plan-import";

const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const KIND: [CellKind, string][] = [["WORK", "Dienst"], ["OFF", "frei"], ["VACATION", "Urlaub"], ["SICK", "Krank"], ["UNCLEAR", "unklar"]];
const de = (ymd: string) => `${ymd.slice(8)}.${ymd.slice(5, 7)}.`;

/** Großes Handyfoto auf max. 2000 px langen Rand als JPEG verkleinern (schneller, unter 5 MB) */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const f = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * f); c.height = Math.round(bmp.height * f);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error("Bild nicht lesbar"))), "image/jpeg", 0.85));
}

export function PlanPhotoImport({ monday, employees, defLabel }: { monday: string; employees: { id: string; label: string }[]; defLabel: string }) {
  const [busy, setBusy] = useState<"" | "read" | "save">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [p, setP] = useState<Proposal | null>(null);
  const [replace, setReplace] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(""); setDone(""); setP(null); setBusy("read");
    try {
      const fd = new FormData();
      fd.set("photo", await shrink(file), "dienstplan.jpg");
      fd.set("originalName", file.name);
      fd.set("monday", monday);
      const r = await readPlanPhoto(fd);
      if (r.error) setError(r.error); else setP(r.proposal!);
    } catch { setError("Das Foto konnte nicht verarbeitet werden. Bitte ein anderes Foto versuchen."); }
    setBusy("");
  }

  const setRow = (i: number, patch: Partial<Proposal["rows"][number]>) => setP((x) => x && { ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setCell = (i: number, d: number, patch: Partial<Proposal["rows"][number]["cells"][number]>) =>
    setP((x) => x && { ...x, rows: x.rows.map((r, j) => (j === i ? { ...r, cells: r.cells.map((c, k) => (k === d ? { ...c, ...patch } : c)) } : r)) });

  const count = p ? p.rows.reduce((a, r) => a + (r.employeeId ? r.cells.filter((c) => c.kind === "WORK" && c.start).length : 0), 0) : 0;
  const unclear = p ? p.rows.reduce((a, r) => a + r.cells.filter((c) => c.kind === "UNCLEAR").length, 0) : 0;
  const unmatched = p ? p.rows.filter((r) => !r.employeeId).length : 0;

  async function save() {
    if (!p) return;
    setBusy("save"); setError("");
    const r = await confirmPlanImport({ monday: p.monday, replace, rows: p.rows.map((r) => ({ employeeId: r.employeeId, cells: r.cells })) });
    setBusy("");
    if (r.error) setError(r.error);
    else { setDone(r.ok!); setP(null); if (p.monday !== monday) window.location.href = `/admin/dienstplan?woche=${p.monday}`; }
  }

  return (
    <div className="grid gap-4">
      <label className="grid gap-1.5 text-sm text-mute">
        Foto vom Dienstplan (Handy-Kamera oder Datei)
        <input type="file" accept="image/*" capture="environment" disabled={!!busy} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
          className="min-h-12 rounded-xl border border-line bg-ink px-4 py-3 text-base text-paper file:mr-4 file:rounded-lg file:border-0 file:bg-gold file:px-4 file:py-2 file:font-semibold file:text-ink" />
      </label>
      {busy === "read" && <p role="status" className="text-mute">Foto wird gelesen … das dauert etwa 20–40 Sekunden.</p>}
      {error && <p role="alert" className="rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-bad">{error}</p>}
      {done && <p role="status" className="rounded-xl border border-good/40 bg-good/10 px-4 py-3 text-good">{done}</p>}

      {p && (
        <div className="grid gap-3">
          <p className="font-semibold">Bitte prüfen: Woche ab {de(p.monday)}{p.monday.slice(0, 4)}{p.department ? ` · ${p.department}` : ""}</p>
          {p.notes.map((n) => <p key={n} className="text-sm text-warn">{n}</p>)}
          <p className="text-sm text-mute">Nur Beginn = Standarddienst {defLabel}. Grau klein steht, was auf dem Foto erkannt wurde. Gespeichert wird erst mit dem Knopf unten.</p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[1100px] table-fixed text-sm">
              <thead><tr className="text-xs text-mute">
                <th className="w-56 px-2 py-2 text-left">AUF DEM FOTO → MITARBEITER</th>
                {p.rows[0]?.cells.map((c, d) => <th key={c.date} className="px-1 py-2 text-left">{WD[d]} {de(c.date)}</th>)}
              </tr></thead>
              <tbody>
                {p.rows.map((r, i) => (
                  <tr key={i} className={`border-t border-line align-top ${r.employeeId ? "" : "bg-warn/5"}`}>
                    <td className="px-2 py-2">
                      <span className="font-semibold">{r.name}</span>
                      <select aria-label={`Mitarbeiter für ${r.name}`} value={r.employeeId ?? ""} onChange={(e) => setRow(i, { employeeId: e.target.value || null, matchNote: null })}
                        className="mt-1 block w-full rounded-lg border border-line bg-ink px-2 py-1.5 text-paper">
                        <option value="">– nicht übernehmen –</option>
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
                      </select>
                      {r.matchNote && <span className="mt-1 block text-[11px] text-warn">{r.matchNote}</span>}
                    </td>
                    {r.cells.map((c, d) => (
                      <td key={c.date} className={`px-1 py-2 ${c.kind === "UNCLEAR" ? "bg-warn/10" : ""}`}>
                        <select aria-label={`${r.name} ${WD[d]} Art`} value={c.kind} onChange={(e) => setCell(i, d, { kind: e.target.value as CellKind })}
                          className="w-full rounded-md border border-line bg-ink px-1 py-1 text-paper">
                          {KIND.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                        {c.kind === "WORK" && (
                          <div className="mt-1 grid gap-1">
                            <input aria-label={`${r.name} ${WD[d]} Beginn`} type="time" value={c.start ?? ""} onChange={(e) => setCell(i, d, { start: e.target.value || null })} className="w-full rounded-md border border-line bg-ink px-1 py-1 text-paper tabular" />
                            <input aria-label={`${r.name} ${WD[d]} Ende`} type="time" value={c.end ?? ""} onChange={(e) => setCell(i, d, { end: e.target.value || null })} title="leer = Standarddienst" className="w-full rounded-md border border-line bg-ink px-1 py-1 text-paper tabular" />
                          </div>
                        )}
                        {c.raw && <span className="mt-1 block truncate text-[11px] text-mute" title={c.raw}>Foto: {c.raw}</span>}
                        {c.existing && <span className="mt-1 block text-[11px] text-warn">schon: {c.existing}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(unclear > 0 || unmatched > 0) && (
            <p className="text-sm text-warn">
              {unmatched > 0 && `${unmatched} Name(n) ohne Zuordnung werden nicht übernommen. `}
              {unclear > 0 && `${unclear} Feld(er) „unklar“ werden nicht übernommen – bitte korrigieren oder so lassen.`}
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="size-5 accent-gold" />
            Vorhandene Dienste an diesen Tagen ersetzen (sonst bleiben sie stehen und der Tag wird übersprungen)
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={save} disabled={!!busy || !count} className="min-h-12 rounded-xl bg-gold px-6 font-semibold text-ink disabled:opacity-50">
              {busy === "save" ? "Bitte warten …" : `${count} Dienste übernehmen`}
            </button>
            <button type="button" onClick={() => setP(null)} className="min-h-12 rounded-xl border border-line px-6 hover:bg-slate">Verwerfen</button>
          </div>
        </div>
      )}
    </div>
  );
}
