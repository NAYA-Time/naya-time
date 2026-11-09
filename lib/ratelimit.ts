import { prisma } from "./db";

/** Einfaches festes Zeitfenster in der Datenbank (funktioniert auch bei mehreren Server-Instanzen). */
export async function hit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; retryAfter: number }> {
  const now = new Date();
  const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO rate_limit_buckets (key, count, "resetAt") VALUES (${key}, 1, ${new Date(now.getTime() + windowSeconds * 1000)})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit_buckets."resetAt" < ${now} THEN 1 ELSE rate_limit_buckets.count + 1 END,
      "resetAt" = CASE WHEN rate_limit_buckets."resetAt" < ${now} THEN ${new Date(now.getTime() + windowSeconds * 1000)} ELSE rate_limit_buckets."resetAt" END
    RETURNING count, "resetAt"`;
  const r = rows[0];
  return { ok: r.count <= limit, retryAfter: Math.max(0, Math.ceil((r.resetAt.getTime() - now.getTime()) / 1000)) };
}
