// Erzeugt einen einmaligen Kopplungscode (15 Min. gültig), um ein iPad als Terminal freizuschalten.
import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashSecret } from "../lib/crypto";

const prisma = new PrismaClient();
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
async function main() {
  const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("");
  const expiresAt = new Date(Date.now() + 15 * 60000).toISOString();
  const value = { hash: await hashSecret(code), expiresAt };
  await prisma.systemSetting.upsert({ where: { key: "terminal.pairingCode" }, update: { value }, create: { key: "terminal.pairingCode", value } });
  console.log(`Kopplungscode: ${code} (gültig bis ${expiresAt})`);
}
main().finally(() => prisma.$disconnect());
