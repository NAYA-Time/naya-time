import { prisma } from "@/lib/db";
import { jsonError, requireTerminal } from "@/lib/terminal";
import { mainKey } from "@/lib/dept";

export const dynamic = "force-dynamic";

// Nur Anzeigename und Abteilung – keine Stunden, kein Status, keine Kontodaten.
export async function GET() {
  try {
    await requireTerminal();
    const list = await prisma.employee.findMany({
      where: { active: true, showOnTerminal: true },
      select: { id: true, displayName: true, primaryDept: { select: { key: true, name: true, kind: true, parent: { select: { key: true } } } }, credential: { select: { pinHash: true } } },
      orderBy: [{ primaryDept: { sortOrder: "asc" } }, { displayName: "asc" }],
    });
    return Response.json({
      employees: list.map((e) => ({ id: e.id, name: e.displayName, dept: mainKey(e.primaryDept) ?? e.primaryDept.key, deptName: e.primaryDept.name, needsSetup: !e.credential?.pinHash })),
    });
  } catch (e) {
    return jsonError(e);
  }
}
