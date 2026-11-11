-- CreateEnum
CREATE TYPE "VacationRequestStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "employee_credentials" ADD COLUMN     "portalInviteExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "portalInviteHash" TEXT,
ADD COLUMN     "portalPasswordHash" TEXT;

-- AlterTable
ALTER TABLE "portal_visibility" ADD COLUMN     "vacationRequests" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "vacation_requests" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "note" TEXT,
    "status" "VacationRequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,
    "absenceId" UUID,

    CONSTRAINT "vacation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vacation_requests_status_createdAt_idx" ON "vacation_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "vacation_requests_employeeId_startDate_idx" ON "vacation_requests"("employeeId", "startDate");

-- AddForeignKey
ALTER TABLE "vacation_requests" ADD CONSTRAINT "vacation_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

