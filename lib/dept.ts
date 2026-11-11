import { cookies } from "next/headers";

// Reiter im Backend (Gunnar 09.11.2026): Bereiche Küche, Service, Spülküche, Büro + Aushilfen aus allen Bereichen
export const DEPT_FILTERS = ["ALL", "KUECHE", "SERVICE", "SPUELE", "BUERO", "AUSHILFEN"] as const;
export type DeptFilter = (typeof DEPT_FILTERS)[number];
export const FILTER_LABEL: Record<DeptFilter, string> = { ALL: "Alle", KUECHE: "Küche", SERVICE: "Service", SPUELE: "Spülküche", BUERO: "Büro", AUSHILFEN: "Aushilfen" };
export const MAIN_DEPTS = ["KUECHE", "SERVICE", "SPUELE", "BUERO"] as const;
export const AUSHILFE_TYPES = ["MINIJOB", "KURZFRISTIG", "TEILZEIT_STUNDENLOHN", "SONSTIGE_AUSHILFE"];
export const DEPT_COOKIE = "naya_dept";

export const asFilter = (v: unknown): DeptFilter => DEPT_FILTERS.find((f) => f === v) ?? "ALL";

export async function currentDeptFilter(): Promise<DeptFilter> {
  return asFilter((await cookies()).get(DEPT_COOKIE)?.value);
}

type D = { key: string; kind: string; parent?: { key: string } | null };
/** Hauptbereich einer Abteilung; Sushi → Küche, Bar → Service, Restaurantleitung → Büro; sonst null */
export function mainKey(d: D | null | undefined): string | null {
  if (!d) return null;
  if (d.kind === "MAIN") return d.key;
  return d.parent?.key ?? null;
}

/** Nur nach Abteilung (für Dienste/Schichten). Der Reiter Aushilfen hängt am Mitarbeiter → matchesEmp verwenden. */
export function matchesFilter(filter: DeptFilter, ...depts: (D | null | undefined)[]) {
  if (filter === "ALL") return true;
  if (filter === "AUSHILFEN") return false;
  return depts.some((d) => mainKey(d) === filter);
}

/** Mitarbeiter passt zum Reiter: Bereich (Haupt-/Unterabteilung oder weitere Abteilungen) bzw. Aushilfe */
export function matchesEmp(filter: DeptFilter, emp: { employmentType: string; primaryDept?: D | null; subDept?: D | null } | null | undefined, ...depts: (D | null | undefined)[]) {
  if (filter === "ALL") return true;
  if (!emp) return false;
  if (filter === "AUSHILFEN") return AUSHILFE_TYPES.includes(emp.employmentType);
  return matchesFilter(filter, emp.primaryDept, emp.subDept, ...depts);
}
