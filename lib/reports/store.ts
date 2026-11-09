// Erzeugte Berichte werden verschlüsselt abgelegt (enthalten Personaldaten) und protokolliert.
import type ExcelJS from "exceljs";
import type { DeptFilter, PrismaClient, ReportType } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { decryptPhoto, encryptPhoto, sha256 } from "../crypto";
import { blobStore } from "../storage";
import { dbDate } from "../time";

export interface BuiltReport { wb: ExcelJS.Workbook; fileName: string; periodStart: string; periodEnd: string }

export async function saveReport(db: PrismaClient, built: BuiltReport, reportType: ReportType, deptFilter: DeptFilter, createdById: string | null, scheduleId: string | null = null) {
  const buffer = Buffer.from(await built.wb.xlsx.writeBuffer());
  const enc = encryptPhoto(buffer);
  const storageKey = `reports/${built.periodStart.slice(0, 7)}/${randomUUID()}.bin`;
  await blobStore.put(storageKey, Buffer.concat([enc.iv, enc.authTag, enc.ciphertext]));
  const report = await db.generatedReport.create({
    data: { reportType, deptFilter, periodStart: dbDate(built.periodStart), periodEnd: dbDate(built.periodEnd), fileName: built.fileName, storageKey, sha256: sha256(buffer), byteSize: buffer.length, createdById, scheduleId },
  });
  return { report, buffer };
}

export async function loadReportFile(storageKey: string): Promise<Buffer> {
  const raw = await blobStore.get(storageKey);
  return decryptPhoto(raw.subarray(28), raw.subarray(0, 12), raw.subarray(12, 28));
}
