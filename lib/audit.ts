import type { Prisma } from "@prisma/client";
import { sha256 } from "./crypto";

type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  actorKind: "ADMIN" | "EMPLOYEE" | "TERMINAL" | "SYSTEM";
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  employeeId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

/** JSON mit sortierten Schlüsseln – gleiche Daten ergeben immer denselben Text (unabhängig von der Speicherung in jsonb). */
export function canonical(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

const plain = (v: unknown) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))));

export function auditHash(row: { at: Date; actorKind: string; actorId: string | null; action: string; entityType: string; entityId: string | null; employeeId: string | null; before: unknown; after: unknown; reason: string | null; ip: string | null; prevHash: string | null }) {
  return sha256(canonical({ ...row, at: row.at.toISOString() }));
}

/** Fügt einen Eintrag mit Hash-Kette an. Muss innerhalb einer Transaktion laufen. */
export async function audit(tx: Tx, e: AuditEntry) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(424242)`; // Reihenfolge der Kette sichern
  const last = await tx.auditLog.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
  const row = {
    at: new Date(), actorKind: e.actorKind, actorId: e.actorId ?? null, action: e.action, entityType: e.entityType, entityId: e.entityId ?? null,
    employeeId: e.employeeId ?? null, before: plain(e.before), after: plain(e.after), reason: e.reason ?? null, ip: e.ip ?? null, prevHash: last?.hash ?? null,
  };
  await tx.auditLog.create({
    data: { ...row, before: row.before ?? undefined, after: row.after ?? undefined, hash: auditHash(row) },
  });
}

/** Prüft die Kette: jeder Eintrag muss zu seinem Inhalt und zum Vorgänger passen. */
export async function verifyAuditChain(db: { auditLog: { findMany: (a: object) => Promise<{ id: bigint; at: Date; actorKind: string; actorId: string | null; action: string; entityType: string; entityId: string | null; employeeId: string | null; before: unknown; after: unknown; reason: string | null; ip: string | null; prevHash: string | null; hash: string }[]> } }, fromId = BigInt(0)) {
  const rows = await db.auditLog.findMany({ where: { id: { gte: fromId } }, orderBy: { id: "asc" } });
  let prev: string | null | undefined = undefined;
  for (const r of rows) {
    if (prev !== undefined && r.prevHash !== prev) return { ok: false, brokenAt: r.id, checked: rows.length };
    const { id: _id, hash, ...rest } = r;
    if (auditHash(rest) !== hash) return { ok: false, brokenAt: r.id, checked: rows.length };
    prev = hash;
  }
  return { ok: true, brokenAt: null, checked: rows.length };
}
