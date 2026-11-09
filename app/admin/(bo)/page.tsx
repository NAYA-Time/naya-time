import { PhotoButton } from "@/components/PhotoViewer";
import { requireAdmin } from "@/lib/admin-auth";
import { todayOverview, type LiveStatus } from "@/lib/dashboard";
import { currentDeptFilter } from "@/lib/dept";
import { berlinLongDate } from "@/lib/time";

export const dynamic = "force-dynamic";

const STATUS: Record<LiveStatus, { label: string; cls: string }> = {
  PRESENT: { label: "Anwesend", cls: "bg-good/15 text-good border-good/40" },
  BREAK: { label: "Pause", cls: "bg-warn/15 text-warn border-warn/40" },
  DONE: { label: "Ausgestempelt", cls: "bg-slate text-mute border-line" },
  LATE: { label: "Noch nicht eingestempelt", cls: "bg-bad/15 text-bad border-bad/40" },
  EXPECTED: { label: "Erwartet", cls: "bg-slate text-paper border-line" },
  SICK: { label: "Krank", cls: "bg-slate text-mute border-line" },
  VACATION: { label: "Urlaub", cls: "bg-slate text-mute border-line" },
  ABSENT_OTHER: { label: "Abwesend", cls: "bg-slate text-mute border-line" },
  UNPLANNED: { label: "Ohne Dienstplan", cls: "bg-warn/15 text-warn border-warn/40" },
};
const SEV = { INFO: "border-line", WARNING: "border-warn/60", CRITICAL: "border-bad/70" } as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const admin = await requireAdmin("dashboard.view");
  const canPhotos = admin.permissions.has("photos.view");
  const sp = await searchParams;
  const filter = await currentDeptFilter();
  const { stats, rows, findings } = await todayOverview(filter);
  const tiles = [
    ["Eingeplant", stats.planned], ["Anwesend", stats.present], ["Ausgestempelt", stats.done], ["Verspätet", stats.late],
    ["Noch nicht erschienen", stats.notYet], ["Krank", stats.sick], ["Urlaub", stats.vacation],
  ] as const;
  return (
    <div className="grid gap-8">
      {sp["kein-recht"] && <p className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-warn">Für diesen Bereich fehlt dir die Berechtigung.</p>}
      <div>
        <p className="text-sm tracking-[0.25em] text-gold">HEUTE IM NAYA</p>
        <h1 className="mt-1 text-3xl font-semibold">{berlinLongDate(new Date())}</h1>
        <p className="mt-1 text-mute">Hallo {admin.name.split(" ")[0]}. Stand: jetzt, Seite neu laden für aktuelle Werte.</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {tiles.map(([l, v]) => (
          <div key={l} className="rounded-2xl border border-line bg-coal px-4 py-4">
            <dt className="text-xs tracking-wider text-mute">{l.toUpperCase()}</dt>
            <dd className="mt-1 text-3xl font-semibold tabular">{v}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h2 className="mb-3 text-xl font-semibold">Live-Übersicht</h2>
        {rows.length === 0 ? <p className="text-mute">Für heute ist niemand eingeplant oder eingestempelt.</p> : (
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[640px] text-left tabular">
              <thead className="bg-coal text-xs tracking-wider text-mute">
                <tr><th className="px-4 py-3">MITARBEITER</th><th className="px-4 py-3">ABTEILUNG</th><th className="px-4 py-3">GEPLANT</th><th className="px-4 py-3">EIN</th><th className="px-4 py-3">AUS</th><th className="px-4 py-3">STATUS</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId} className="border-t border-line">
                    <td className="px-4 py-3 font-medium"><span className="flex flex-wrap items-center gap-2">{r.name}{canPhotos && <PhotoButton name={r.name} date="heute" photos={r.photos} />}</span></td>
                    <td className="px-4 py-3 text-mute">{r.dept}</td>
                    <td className="px-4 py-3">{r.planned ?? "–"}</td>
                    <td className="px-4 py-3">{r.clockIn ?? "–"}{r.lateMinutes > 5 && <span className="ml-2 text-sm text-warn">+{r.lateMinutes} Min.</span>}{r.photoMissing && <span className="ml-2 text-sm text-warn">Foto fehlt</span>}</td>
                    <td className="px-4 py-3">{r.clockOut ?? "–"}</td>
                    <td className="px-4 py-3"><span className={`inline-block rounded-full border px-3 py-1 text-sm ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-xl font-semibold">Prüfhinweise</h2>
        <p className="mb-3 text-sm text-mute">Hinweise zur sachlichen Prüfung, keine Bewertung. Gesetzliche Vorgaben sind als „ArbZG“ markiert, betriebliche Regeln als „Betrieb“.</p>
        {findings.length === 0 ? <p className="text-mute">Keine offenen Hinweise der letzten 7 Tage.</p> : (
          <ul className="grid gap-2">
            {findings.map((f) => (
              <li key={f.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-coal px-4 py-3 ${SEV[f.severity]}`}>
                <span><span className="font-medium">{f.name}</span> · {f.message}</span>
                <span className="text-sm text-mute">{f.isLegal ? "ArbZG" : "Betrieb"} · {f.date.toLocaleDateString("de-DE", { timeZone: "UTC" })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
