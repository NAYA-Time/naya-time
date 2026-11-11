-- CreateTable
CREATE TABLE "employee_reminders" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "remindDaysBefore" INTEGER NOT NULL DEFAULT 14,
    "repeatMonths" INTEGER,
    "showOnTerminal" BOOLEAN NOT NULL DEFAULT false,
    "terminalText" TEXT,
    "doneAt" TIMESTAMPTZ(3),
    "doneById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "employee_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_reminders_employeeId_dueDate_idx" ON "employee_reminders"("employeeId", "dueDate");

-- AddForeignKey
ALTER TABLE "employee_reminders" ADD CONSTRAINT "employee_reminders_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

