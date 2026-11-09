// Dienstplan-Foto auslesen (Claude, Bilderkennung). Ergebnis ist nur ein Vorschlag: gespeichert wird erst nach der Prüftabelle.
// Braucht ANTHROPIC_API_KEY in deploy/.env. Kosten ca. 1–5 Cent je Foto.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { ExtractedPlan } from "./calc/plan-import";

export const PLAN_MODEL = "claude-opus-5-5";

const PlanSchema = z.object({
  weekStart: z.string().nullable().describe("Montag der Woche als YYYY-MM-DD, falls auf dem Foto ein Datum steht, sonst null"),
  department: z.string().nullable().describe("Abteilung, falls erkennbar (z. B. Küche, Service), sonst null"),
  rows: z.array(z.object({
    name: z.string().describe("Name genau wie auf dem Plan"),
    days: z.array(z.object({
      weekday: z.number().int().describe("1 = Montag … 7 = Sonntag"),
      date: z.string().nullable().describe("YYYY-MM-DD, falls die Spalte ein Datum hat, sonst null"),
      kind: z.enum(["WORK", "OFF", "VACATION", "SICK", "UNCLEAR"]),
      start: z.string().nullable().describe("Beginn HH:MM, nur bei WORK"),
      end: z.string().nullable().describe("Ende HH:MM, nur wenn ausdrücklich eingetragen, sonst null"),
      raw: z.string().describe("Zelleninhalt wörtlich, leer wenn leer"),
    })),
  })),
});

const INSTRUCTIONS = `Du liest einen Wochen-Dienstplan eines Restaurants von einem Foto (oft handschriftlich oder ausgedruckt).
Gib für jede Mitarbeiterzeile alle sieben Wochentage zurück.
Regeln:
- Eine Uhrzeit (z. B. "13:30", "15", "18.00") = Dienst (WORK) mit diesem Beginn. Ein Ende nur angeben, wenn es ausdrücklich dasteht (z. B. "15–23"). Nichts erfinden.
- "FREI", "frei", "–", "/", "x" oder leere Zelle = OFF.
- "U", "Url.", "Urlaub" = VACATION. "K", "krank" = SICK.
- Wenn du eine Zelle nicht sicher lesen kannst: UNCLEAR, und den Inhalt in raw.
- Zahlen in einer Summenzeile oder -spalte (z. B. Anzahl Personen pro Tag) sind keine Mitarbeiter und werden ignoriert.
- Durchgestrichenes gilt nicht; wenn daneben eine neue Zeit steht, nimm die neue.
- Namen so übernehmen, wie sie dastehen. Die bekannten Mitarbeiter helfen nur beim Lesen schwer leserlicher Schrift.`;

export class PlanPhotoError extends Error {}

export async function extractPlanFromPhoto(image: Buffer, mediaType: "image/jpeg" | "image/png" | "image/webp", hints: { employeeNames: string[]; weekHint: string }): Promise<ExtractedPlan> {
  if (!process.env.ANTHROPIC_API_KEY) throw new PlanPhotoError("Die Foto-Übernahme ist noch nicht eingerichtet: Auf dem Server fehlt ANTHROPIC_API_KEY in /opt/naya-time/deploy/.env.");
  const client = new Anthropic();
  let res;
  try {
    res = await client.messages.parse({
      model: PLAN_MODEL,
      max_tokens: 8000,
      system: INSTRUCTIONS,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
          { type: "text", text: `Bekannte Mitarbeiter: ${hints.employeeNames.join(", ") || "–"}\nIm Backoffice ist gerade die Woche ab ${hints.weekHint} geöffnet (nur verwenden, wenn auf dem Foto kein Datum steht).\nBitte den Dienstplan auslesen.` },
        ],
      }],
      output_config: { format: zodOutputFormat(PlanSchema) },
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new PlanPhotoError("Der Anthropic-Schlüssel wurde abgelehnt. Bitte ANTHROPIC_API_KEY auf dem Server prüfen.");
    if (e instanceof Anthropic.RateLimitError) throw new PlanPhotoError("Zu viele Anfragen gerade. Bitte in einer Minute noch einmal versuchen.");
    if (e instanceof Anthropic.APIError) throw new PlanPhotoError(`Das Foto konnte nicht gelesen werden (Fehler ${e.status ?? "?"}). Bitte erneut versuchen.`);
    throw e;
  }
  if (res.stop_reason === "refusal") throw new PlanPhotoError("Das Foto wurde nicht ausgewertet. Bitte ein deutlicheres Foto nur vom Dienstplan aufnehmen.");
  if (res.stop_reason === "max_tokens" || !res.parsed_output) throw new PlanPhotoError("Das Ergebnis war unvollständig. Bitte erneut versuchen, notfalls den Plan in zwei Fotos aufteilen.");
  return res.parsed_output;
}
