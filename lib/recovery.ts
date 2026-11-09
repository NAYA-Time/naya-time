// Wiederherstellungscodes für die Zwei-Faktor-Anmeldung (falls das Handy weg ist). Gespeichert werden nur Hashes; jeder Code gilt einmal.
import { randomInt } from "node:crypto";
import { hashSecret, verifySecret } from "./crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O, 1/I
export const RECOVERY_RE = /^[A-Z0-9]{4}-?[A-Z0-9]{4}$/i;
const norm = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function newRecoveryCodes(n = 10): Promise<{ plain: string[]; hashes: string[] }> {
  const plain = Array.from({ length: n }, () => {
    const s = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
  return { plain, hashes: await Promise.all(plain.map((c) => hashSecret(norm(c)))) };
}

/** Gibt die verbleibenden Hashes zurück, wenn der Code passte (dieser ist danach verbraucht), sonst null. */
export async function consumeRecoveryCode(hashes: string[], code: string): Promise<string[] | null> {
  const c = norm(code);
  for (let i = 0; i < hashes.length; i++) {
    if (await verifySecret(c, hashes[i])) return hashes.filter((_, j) => j !== i);
  }
  return null;
}
