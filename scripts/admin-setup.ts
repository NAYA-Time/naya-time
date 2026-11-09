// Sichere Ersteinrichtung: erzeugt einen einmaligen Link (24 Std. gültig), mit dem der Inhaber sein Konto anlegt.
// Es gibt keine fest einprogrammierten Kennwörter.
import { PrismaClient } from "@prisma/client";
import { hashSecret, randomToken } from "../lib/crypto";

const prisma = new PrismaClient();
async function main() {
  const token = randomToken(24);
  const value = { hash: await hashSecret(token), expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(), role: process.argv[2] === "manager" ? "MANAGER" : "OWNER" };
  await prisma.systemSetting.upsert({ where: { key: "admin.setupToken" }, update: { value }, create: { key: "admin.setupToken", value } });
  const base = process.env.APP_URL ?? "http://localhost:3000";
  console.log(`Einrichtungslink (einmalig, 24 Std.): ${base}/admin/setup?token=${token}`);
}
main().finally(() => prisma.$disconnect());
