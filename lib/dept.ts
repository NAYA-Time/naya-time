import { cookies } from "next/headers";

export type DeptFilter = "ALL" | "KUECHE" | "SERVICE";
export const DEPT_COOKIE = "naya_dept";

export async function currentDeptFilter(): Promise<DeptFilter> {
  const v = (await cookies()).get(DEPT_COOKIE)?.value;
  return v === "KUECHE" || v === "SERVICE" ? v : "ALL";
}

type D = { key: string; kind: string; parent?: { key: string } | null };
/** Hauptabteilung (Küche/Service) einer Abteilung; Sushi → Küche, Bar → Service; Büro/Leitung → null */
export function mainKey(d: D | null | undefined): string | null {
  if (!d) return null;
  if (d.kind === "MAIN") return d.key;
  return d.parent?.key ?? null;
}

export function matchesFilter(filter: DeptFilter, ...depts: (D | null | undefined)[]) {
  if (filter === "ALL") return true;
  return depts.some((d) => mainKey(d) === filter);
}
