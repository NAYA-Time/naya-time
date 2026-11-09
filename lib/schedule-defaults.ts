// Standarddienst, wenn im Plan nur eine Anfangszeit steht (Gunnar 09.11.2026: 8,5 Std. inkl. 30 Min. Pause = Mindest-Tagessoll).
import { prisma } from "./db";

export const DEFAULT_SHIFT_KEY = "schedule.defaultShift";
export interface DefaultShift { minutes: number; breakMinutes: number } // minutes = Dauer von Beginn bis Ende, inkl. Pause

export async function defaultShift(): Promise<DefaultShift> {
  const s = await prisma.systemSetting.findUnique({ where: { key: DEFAULT_SHIFT_KEY } });
  const v = s?.value as Partial<DefaultShift> | null;
  return { minutes: Number(v?.minutes) || 510, breakMinutes: Number.isInteger(v?.breakMinutes) ? (v!.breakMinutes as number) : 30 };
}
