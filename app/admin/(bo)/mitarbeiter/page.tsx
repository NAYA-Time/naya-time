import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";
import { currentDeptFilter, matchesFilter } from "@/lib/dept";
import { EMPLOYMENT_LABEL } from "@/lib/labels";
import { fmtMinutes } from "@/lib/time";

export default async function Employees({ searchParams }: { searchParams: Promise<{ inaktiv?: string }> }) {
  const admin = await requireAdmin("employees.view");
  const { inaktiv } = await searchParams;
  const filter = await currentDeptFilter();
  const list = await prisma.employee.findMany({
    where: inaktiv ? {} : { active: true },
    include: { primaryDept: { include: { parent: true } }, subDept: true, credential: { select: { pinHash: true, lockedUntil: true } }, contracts: { orderBy: { validFrom: "desc" }, take: 1 } },
    orderBy: [{ lastName: "asc" }],
  });
  const rows = list.filter((e) => matchesFilter(filter, e.primaryDept, e.subDept));
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Mitarbeiter</h1>
          <p className="text-mute">{rows.length} {inaktiv ? "insgesamt" : "aktiv"}{filter !== "ALL" ? ` · ${filter === "KUECHE" ? "Küche" : "Service"}` : ""}</p>
        </div>
        <div className="flex gap-2">
          <Link href={inaktiv ? "/admin/mitarbeiter" : "/admin/mitarbeiter?inaktiv=1"} className="rounded-xl border border-line px-4 py-3 text-mute hover:text-paper">{inaktiv ? "Nur aktive" : "Auch inaktive zeigen"}</Link>
          {admin.permissions.has("employees.manage") && <Link href="/admin/mitarbeiter/neu" className="rounded-xl bg-gold px-5 py-3 font-semibold text-ink">Mitarbeiter anlegen</Link>}
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[720px] text-left tabular">
          <thead className="bg-coal text-xs tracking-wider text-mute">
            <tr><th className="px-4 py-3">NAME</th><th className="px-4 py-3">NR.</th><th className="px-4 py-3">ABTEILUNG</th><th className="px-4 py-3">BESCHÄFTIGUNG</th><th className="px-4 py-3">WOCHENSOLL</th><th className="px-4 py-3">PIN</th></tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={`border-t border-line ${e.active ? "" : "opacity-50"}`}>
                <td className="px-4 py-3"><Link href={`/admin/mitarbeiter/${e.id}`} className="font-medium text-gold hover:underline">{e.lastName}, {e.firstName}</Link>{!e.active && <span className="ml-2 text-xs text-mute">inaktiv</span>}</td>
                <td className="px-4 py-3 text-mute">{e.personnelNumber}</td>
                <td className="px-4 py-3">{e.primaryDept.name}{e.subDept ? ` · ${e.subDept.name}` : ""}</td>
                <td className="px-4 py-3">{EMPLOYMENT_LABEL[e.employmentType]}</td>
                <td className="px-4 py-3">{e.contracts[0]?.weeklyMinutes != null ? fmtMinutes(e.contracts[0].weeklyMinutes) : "variabel"}</td>
                <td className="px-4 py-3 text-sm">{!e.credential?.pinHash ? <span className="text-warn">Ersteinrichtung offen</span> : e.credential.lockedUntil && e.credential.lockedUntil > new Date() ? <span className="text-bad">gesperrt</span> : <span className="text-good">eingerichtet</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
