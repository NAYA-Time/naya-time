-- CreateTable
CREATE TABLE "shift_changes" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMPTZ(3),

    CONSTRAINT "shift_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shift_changes_employeeId_workDate_idx" ON "shift_changes"("employeeId", "workDate");

-- AddForeignKey
ALTER TABLE "shift_changes" ADD CONSTRAINT "shift_changes_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
