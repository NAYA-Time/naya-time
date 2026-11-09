import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { verifyAuditChain } from "@/lib/audit";

export default async function AuditPage() {
  await requireAdmin("settings.manage");
  const [rows, check] = await Promise.all([prisma.auditLog.findMany({ orderBy: { id: "desc" }, take: 200 }), verifyAuditChain(prisma)]);
  const admins = new Map((await prisma.adminUser.findMany({ select: { id: true, name: true } })).map((a) => [a.id, a.name]));
  const emps = new Map((await prisma.employee.findMany({ select: { id: true, firstName: true, lastName: true } })).map((e) => [e.id, `${e.firstName} ${e.lastName}`]));
  return (
    <div className="grid max-w-5xl gap-5">
      <h1 className="text-3xl font-semibold">Änderungsprotokoll</h1>
      <p className={`rounded-xl border px-4 py-3 ${check.ok ? "border-good/40 bg-good/10 text-good" : "border-bad/40 bg-bad/10 text-bad"}`}>
        {check.ok ? `Prüfkette in Ordnung: ${check.checked} Einträge, keine nachträgliche Veränderung erkennbar.` : `Prüfkette unterbrochen bei Eintrag ${check.brokenAt}. Bitte prüfen, ob die Datenbank außerhalb von NAYA TIME verändert wurde.`}
      </p>
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[720px] text-left text-sm tabular">
          <thead className="bg-coal text-xs tracking-wider text-mute"><tr><th className="px-4 py-3">ZEIT</th><th className="px-4 py-3">WER</th><th className="px-4 py-3">AKTION</th><th className="px-4 py-3">BETROFFEN</th><th className="px-4 py-3">GRUND</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id.toString()} className="border-t border-line align-top">
              <td className="px-4 py-2 whitespace-nowrap">{r.at.toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}</td>
              <td className="px-4 py-2">{r.actorKind === "ADMIN" ? admins.get(r.actorId ?? "") ?? "Admin" : r.actorKind === "TERMINAL" ? "Terminal" : r.actorKind === "EMPLOYEE" ? "Mitarbeiter" : "System"}</td>
              <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
              <td className="px-4 py-2">{r.employeeId ? emps.get(r.employeeId) ?? "–" : "–"}</td>
              <td className="px-4 py-2 text-mute">{r.reason ?? ""}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}
