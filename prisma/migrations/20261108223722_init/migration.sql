-- CreateEnum
CREATE TYPE "DepartmentKind" AS ENUM ('MAIN', 'SUB');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FESTANGESTELLT', 'MINIJOB', 'KURZFRISTIG', 'TEILZEIT_STUNDENLOHN', 'SONSTIGE_AUSHILFE');

-- CreateEnum
CREATE TYPE "PayModel" AS ENUM ('SALARIED', 'HOURLY');

-- CreateEnum
CREATE TYPE "MonthlyTargetMethod" AS ENUM ('WEEKLY_AVERAGE', 'CALENDAR_EXACT', 'FIXED_MONTHLY');

-- CreateEnum
CREATE TYPE "SessionKind" AS ENUM ('ADMIN', 'PORTAL');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ShiftKind" AS ENUM ('WORK', 'FREE');

-- CreateEnum
CREATE TYPE "ClockEventType" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_START', 'BREAK_END');

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('CAPTURED', 'MISSING_TECHNICAL', 'FEATURE_DISABLED');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED', 'MISSING_CLOCK_OUT');

-- CreateEnum
CREATE TYPE "BreakConfirmation" AS ENUM ('NOT_ASKED', 'YES', 'NO');

-- CreateEnum
CREATE TYPE "BreakSource" AS ENUM ('CLOCKED', 'CONFIRMED_AT_CLOCKOUT', 'ADMIN_CORRECTION');

-- CreateEnum
CREATE TYPE "CorrectionField" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'BREAK_MINUTES', 'PAYABLE_START', 'SESSION_VOID', 'ADD_SESSION');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('EARLY_START_WORKED', 'FORGOT_CLOCK_OUT', 'FORGOT_CLOCK_IN', 'BREAK_NOT_TAKEN', 'OTHER');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AbsenceType" AS ENUM ('VACATION', 'SICK', 'SICK_CHILD', 'SPECIAL_LEAVE', 'UNPAID', 'TIME_OFF_IN_LIEU');

-- CreateEnum
CREATE TYPE "AbsenceStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreditBasis" AS ENUM ('SCHEDULE_SNAPSHOT', 'CONTRACT_DAILY_AVG', 'NONE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AccountTxType" AS ENUM ('OPENING_BALANCE', 'MONTH_CLOSING', 'CLOSING_CORRECTION', 'PAYOUT', 'TIME_OFF', 'MANUAL_CORRECTION');

-- CreateEnum
CREATE TYPE "ClosingStatus" AS ENUM ('DRAFT', 'CLOSED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DeficitDecision" AS ENUM ('NONE', 'PENDING', 'EMPLOYEE_CAUSED', 'EMPLOYER_CAUSED');

-- CreateEnum
CREATE TYPE "PayrollPeriodStatus" AS ENUM ('PREPARED', 'SETTLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollItemKind" AS ENUM ('WORK', 'PAID_ABSENCE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('NOT_SETTLED', 'PREPARED', 'SETTLED', 'PAYMENT_SCHEDULED', 'PARTIALLY_PAID', 'PAID', 'NEEDS_CORRECTION');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('WEEKLY', 'MONTHLY', 'PAYROLL_HOURLY');

-- CreateEnum
CREATE TYPE "DeptFilter" AS ENUM ('ALL', 'KUECHE', 'SERVICE');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DepartmentKind" NOT NULL,
    "parentId" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "personnelNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "position" TEXT,
    "employmentType" "EmploymentType" NOT NULL,
    "primaryDeptId" UUID NOT NULL,
    "subDeptId" UUID,
    "entryDate" DATE NOT NULL,
    "exitDate" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "showOnTerminal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_departments" (
    "employeeId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,

    CONSTRAINT "employee_departments_pkey" PRIMARY KEY ("employeeId","departmentId")
);

-- CreateTable
CREATE TABLE "employee_department_history" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,

    CONSTRAINT "employee_department_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_contracts" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "payModel" "PayModel" NOT NULL,
    "contractModel" TEXT,
    "weeklyMinutes" INTEGER,
    "monthlyMinutes" INTEGER,
    "monthlyTargetMethod" "MonthlyTargetMethod" NOT NULL DEFAULT 'WEEKLY_AVERAGE',
    "workdaysMask" INTEGER NOT NULL DEFAULT 31,
    "workdaysPerWeek" INTEGER NOT NULL DEFAULT 5,
    "vacationDaysPerYear" INTEGER NOT NULL DEFAULT 0,
    "vacationBasisDays" INTEGER NOT NULL DEFAULT 5,
    "accountLimitPlus" INTEGER,
    "accountLimitMinus" INTEGER,
    "calcLaborCostCents" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "employee_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_rules" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "includedMinutesPerMonth" INTEGER NOT NULL DEFAULT 0,
    "contractuallyAgreed" BOOLEAN NOT NULL DEFAULT false,
    "legallyReviewed" BOOLEAN NOT NULL DEFAULT false,
    "settlementPeriod" TEXT NOT NULL DEFAULT 'CALENDAR_MONTH',
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "overtime_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hourly_wage_history" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "centsPerHour" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "hourly_wage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_credentials" (
    "employeeId" UUID NOT NULL,
    "pinHash" TEXT,
    "pinSetAt" TIMESTAMPTZ(3),
    "mustSetPin" BOOLEAN NOT NULL DEFAULT true,
    "setupCodeHash" TEXT,
    "setupCodeExpiresAt" TIMESTAMPTZ(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "portalEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employee_credentials_pkey" PRIMARY KEY ("employeeId")
);

-- CreateTable
CREATE TABLE "pin_history" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "pinHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pin_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pin_escrow" (
    "employeeId" UUID NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pin_escrow_pkey" PRIMARY KEY ("employeeId")
);

-- CreateTable
CREATE TABLE "portal_visibility" (
    "employeeId" UUID NOT NULL,
    "schedule" BOOLEAN NOT NULL DEFAULT true,
    "weeklyTarget" BOOLEAN NOT NULL DEFAULT false,
    "weeklyHours" BOOLEAN NOT NULL DEFAULT false,
    "monthlyHours" BOOLEAN NOT NULL DEFAULT false,
    "monthlyTarget" BOOLEAN NOT NULL DEFAULT false,
    "accountBalance" BOOLEAN NOT NULL DEFAULT false,
    "overtime" BOOLEAN NOT NULL DEFAULT false,
    "minusHours" BOOLEAN NOT NULL DEFAULT false,
    "includedOvertime" BOOLEAN NOT NULL DEFAULT false,
    "vacationRemaining" BOOLEAN NOT NULL DEFAULT false,
    "ownReports" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "portal_visibility_pkey" PRIMARY KEY ("employeeId")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionKey" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionKey")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecretEnc" BYTEA,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "recoveryCodes" TEXT[],
    "roleId" UUID NOT NULL,
    "employeeId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "kind" "SessionKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "adminUserId" UUID,
    "employeeId" UUID,
    "mfaPassed" BOOLEAN NOT NULL DEFAULT false,
    "reauthAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_devices" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "pairedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pairedById" UUID,
    "lastSeenAt" TIMESTAMPTZ(3),

    CONSTRAINT "terminal_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_schedules" (
    "id" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "departmentId" UUID,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionNo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_versions" (
    "id" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" UUID,
    "changeNote" TEXT,

    CONSTRAINT "schedule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_shifts" (
    "id" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "kind" "ShiftKind" NOT NULL DEFAULT 'WORK',
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "plannedBreakMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scheduled_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "plannedBreakMinutes" INTEGER NOT NULL DEFAULT 30,
    "departmentId" UUID,

    CONSTRAINT "shift_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_clock_events" (
    "id" UUID NOT NULL,
    "bookingNo" BIGSERIAL NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "employeeId" UUID NOT NULL,
    "terminalId" UUID NOT NULL,
    "type" "ClockEventType" NOT NULL,
    "serverReceivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "isOffline" BOOLEAN NOT NULL DEFAULT false,
    "clientRecordedAt" TIMESTAMPTZ(3),
    "offlineEvidence" JSONB,
    "offlineTrust" TEXT,
    "photoStatus" "PhotoStatus" NOT NULL,
    "photoMissingReason" TEXT,
    "scheduledShiftId" UUID,

    CONSTRAINT "time_clock_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clock_event_photos" (
    "id" UUID NOT NULL,
    "clockEventId" UUID NOT NULL,
    "storageKey" TEXT NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "deleteAfter" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "clock_event_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_sessions" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "scheduledShiftId" UUID,
    "clockInEventId" UUID NOT NULL,
    "clockOutEventId" UUID,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "breakConfirmation" "BreakConfirmation" NOT NULL DEFAULT 'NOT_ASKED',
    "earlyStartApproved" BOOLEAN NOT NULL DEFAULT false,
    "plannedStartAt" TIMESTAMPTZ(3),
    "plannedEndAt" TIMESTAMPTZ(3),
    "effectiveStartAt" TIMESTAMPTZ(3),
    "effectiveEndAt" TIMESTAMPTZ(3),
    "presenceMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "payableMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyArrivalMinutes" INTEGER NOT NULL DEFAULT 0,
    "overrunMinutes" INTEGER NOT NULL DEFAULT 0,
    "calcVersion" INTEGER NOT NULL DEFAULT 1,
    "computedAt" TIMESTAMPTZ(3),

    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_records" (
    "id" UUID NOT NULL,
    "workSessionId" UUID NOT NULL,
    "source" "BreakSource" NOT NULL,
    "startEventId" UUID,
    "endEventId" UUID,
    "startAt" TIMESTAMPTZ(3),
    "endAt" TIMESTAMPTZ(3),
    "minutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "break_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_corrections" (
    "id" UUID NOT NULL,
    "workSessionId" UUID NOT NULL,
    "field" "CorrectionField" NOT NULL,
    "originalValue" TEXT,
    "correctedValue" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" UUID,
    "requestId" UUID,

    CONSTRAINT "time_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correction_requests" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "workSessionId" UUID,
    "type" "RequestType" NOT NULL,
    "requestedValue" TEXT,
    "message" TEXT,
    "createdByKind" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "RequestStatus" NOT NULL DEFAULT 'OPEN',
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionNote" TEXT,

    CONSTRAINT "correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absences" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "AbsenceType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AbsenceStatus" NOT NULL DEFAULT 'CONFIRMED',
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMPTZ(3),

    CONSTRAINT "absences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "absence_days" (
    "id" UUID NOT NULL,
    "absenceId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "creditedMinutes" INTEGER NOT NULL,
    "vacationDayValue" INTEGER NOT NULL DEFAULT 0,
    "basis" "CreditBasis" NOT NULL,
    "shiftSnapshot" JSONB,
    "manualReason" TEXT,

    CONSTRAINT "absence_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sick_leave_records" (
    "absenceId" UUID NOT NULL,
    "certificateStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "continuedPayUntil" DATE,
    "note" TEXT,

    CONSTRAINT "sick_leave_records_pkey" PRIMARY KEY ("absenceId")
);

-- CreateTable
CREATE TABLE "vacation_balances" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "entitlementHalfDays" INTEGER NOT NULL,
    "carryOverHalfDays" INTEGER NOT NULL DEFAULT 0,
    "carryOverExpiresAt" DATE,
    "manualAdjustHalfDays" INTEGER NOT NULL DEFAULT 0,
    "adjustReason" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vacation_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL DEFAULT 'HH',

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "working_time_accounts" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "openedAt" DATE NOT NULL,

    CONSTRAINT "working_time_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_time_transactions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "bookingDate" DATE NOT NULL,
    "type" "AccountTxType" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "closingId" UUID,
    "reason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "working_time_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_time_closings" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "month" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "ClosingStatus" NOT NULL DEFAULT 'DRAFT',
    "targetMinutes" INTEGER NOT NULL,
    "avgContractMinutes" INTEGER NOT NULL,
    "workedMinutes" INTEGER NOT NULL,
    "sickCreditMinutes" INTEGER NOT NULL,
    "vacationCreditMinutes" INTEGER NOT NULL,
    "holidayCreditMinutes" INTEGER NOT NULL,
    "otherCreditMinutes" INTEGER NOT NULL,
    "plannedMinutes" INTEGER NOT NULL,
    "overtimeMinutes" INTEGER NOT NULL,
    "includedOvertimeMinutes" INTEGER NOT NULL,
    "compensableMinutes" INTEGER NOT NULL,
    "deficitMinutes" INTEGER NOT NULL,
    "deficitDecision" "DeficitDecision" NOT NULL DEFAULT 'NONE',
    "minusMinutesBooked" INTEGER NOT NULL,
    "accountChangeMinutes" INTEGER NOT NULL,
    "balanceBeforeMinutes" INTEGER NOT NULL,
    "balanceAfterMinutes" INTEGER NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "closedById" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "supersedesId" UUID,
    "correctionReason" TEXT,

    CONSTRAINT "monthly_time_closings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_periods" (
    "id" UUID NOT NULL,
    "cutoffDate" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'PREPARED',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMPTZ(3),
    "settledById" UUID,

    CONSTRAINT "payroll_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_items" (
    "id" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "PayrollItemKind" NOT NULL,
    "workSessionId" UUID,
    "absenceDayId" UUID,
    "workDate" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "centsPerHour" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "isCarryOver" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payroll_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_settlements" (
    "id" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "minutes" INTEGER NOT NULL,
    "grossCents" INTEGER NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PREPARED',
    "note" TEXT,

    CONSTRAINT "payroll_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "settlementId" UUID,
    "accountTxId" UUID,
    "amountCents" INTEGER NOT NULL,
    "paidOn" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedById" UUID,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_recipients" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "deptFilter" "DeptFilter" NOT NULL DEFAULT 'ALL',
    "individual" BOOLEAN NOT NULL DEFAULT false,
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "timeOfDay" TEXT NOT NULL DEFAULT '08:00',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMPTZ(3),
    "nextRunAt" TIMESTAMPTZ(3),

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedule_recipients" (
    "scheduleId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,

    CONSTRAINT "report_schedule_recipients_pkey" PRIMARY KEY ("scheduleId","recipientId")
);

-- CreateTable
CREATE TABLE "generated_reports" (
    "id" UUID NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "deptFilter" "DeptFilter" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "scheduleId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_delivery_logs" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_delivery_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_findings" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "isLegal" BOOLEAN NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "employeeId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "status" "FindingStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorKind" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "employeeId" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_protection_approvals" (
    "id" UUID NOT NULL,
    "feature" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "documentRef" TEXT,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_protection_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_revenues" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "departmentId" UUID,
    "amountCents" INTEGER NOT NULL,
    "createdById" UUID NOT NULL,

    CONSTRAINT "daily_revenues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_key_key" ON "departments"("key");

-- CreateIndex
CREATE UNIQUE INDEX "employees_personnelNumber_key" ON "employees"("personnelNumber");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE INDEX "employees_primaryDeptId_active_idx" ON "employees"("primaryDeptId", "active");

-- CreateIndex
CREATE INDEX "employee_department_history_employeeId_validFrom_idx" ON "employee_department_history"("employeeId", "validFrom");

-- CreateIndex
CREATE INDEX "employee_contracts_employeeId_validFrom_idx" ON "employee_contracts"("employeeId", "validFrom");

-- CreateIndex
CREATE INDEX "overtime_rules_employeeId_validFrom_idx" ON "overtime_rules"("employeeId", "validFrom");

-- CreateIndex
CREATE INDEX "hourly_wage_history_employeeId_validFrom_idx" ON "hourly_wage_history"("employeeId", "validFrom");

-- CreateIndex
CREATE INDEX "pin_history_employeeId_createdAt_idx" ON "pin_history"("employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_employeeId_key" ON "admin_users"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "terminal_devices_tokenHash_key" ON "terminal_devices"("tokenHash");

-- CreateIndex
CREATE INDEX "work_schedules_periodStart_idx" ON "work_schedules"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "schedule_versions_scheduleId_versionNo_key" ON "schedule_versions"("scheduleId", "versionNo");

-- CreateIndex
CREATE INDEX "scheduled_shifts_employeeId_workDate_idx" ON "scheduled_shifts"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "scheduled_shifts_workDate_departmentId_idx" ON "scheduled_shifts"("workDate", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "time_clock_events_bookingNo_key" ON "time_clock_events"("bookingNo");

-- CreateIndex
CREATE UNIQUE INDEX "time_clock_events_idempotencyKey_key" ON "time_clock_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "time_clock_events_employeeId_effectiveAt_idx" ON "time_clock_events"("employeeId", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "clock_event_photos_clockEventId_key" ON "clock_event_photos"("clockEventId");

-- CreateIndex
CREATE UNIQUE INDEX "clock_event_photos_storageKey_key" ON "clock_event_photos"("storageKey");

-- CreateIndex
CREATE INDEX "clock_event_photos_deleteAfter_idx" ON "clock_event_photos"("deleteAfter");

-- CreateIndex
CREATE UNIQUE INDEX "work_sessions_clockInEventId_key" ON "work_sessions"("clockInEventId");

-- CreateIndex
CREATE UNIQUE INDEX "work_sessions_clockOutEventId_key" ON "work_sessions"("clockOutEventId");

-- CreateIndex
CREATE INDEX "work_sessions_employeeId_workDate_idx" ON "work_sessions"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "work_sessions_workDate_status_idx" ON "work_sessions"("workDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "time_corrections_supersedesId_key" ON "time_corrections"("supersedesId");

-- CreateIndex
CREATE INDEX "time_corrections_workSessionId_idx" ON "time_corrections"("workSessionId");

-- CreateIndex
CREATE INDEX "correction_requests_status_createdAt_idx" ON "correction_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "absences_employeeId_startDate_idx" ON "absences"("employeeId", "startDate");

-- CreateIndex
CREATE INDEX "absence_days_date_idx" ON "absence_days"("date");

-- CreateIndex
CREATE UNIQUE INDEX "absence_days_absenceId_date_key" ON "absence_days"("absenceId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "vacation_balances_employeeId_year_key" ON "vacation_balances"("employeeId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "working_time_accounts_employeeId_key" ON "working_time_accounts"("employeeId");

-- CreateIndex
CREATE INDEX "working_time_transactions_accountId_bookingDate_idx" ON "working_time_transactions"("accountId", "bookingDate");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_time_closings_supersedesId_key" ON "monthly_time_closings"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_time_closings_employeeId_month_version_key" ON "monthly_time_closings"("employeeId", "month", "version");

-- CreateIndex
CREATE INDEX "payroll_items_workSessionId_idx" ON "payroll_items"("workSessionId");

-- CreateIndex
CREATE INDEX "payroll_items_absenceDayId_idx" ON "payroll_items"("absenceDayId");

-- CreateIndex
CREATE INDEX "payroll_items_employeeId_workDate_idx" ON "payroll_items"("employeeId", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_settlements_periodId_employeeId_key" ON "payroll_settlements"("periodId", "employeeId");

-- CreateIndex
CREATE INDEX "payment_records_employeeId_paidOn_idx" ON "payment_records"("employeeId", "paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "email_recipients_email_key" ON "email_recipients"("email");

-- CreateIndex
CREATE INDEX "generated_reports_reportType_periodStart_idx" ON "generated_reports"("reportType", "periodStart");

-- CreateIndex
CREATE INDEX "compliance_findings_status_workDate_idx" ON "compliance_findings"("status", "workDate");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_findings_code_employeeId_workDate_refId_key" ON "compliance_findings"("code", "employeeId", "workDate", "refId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_employeeId_at_idx" ON "audit_logs"("employeeId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "daily_revenues_date_departmentId_key" ON "daily_revenues"("date", "departmentId");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_primaryDeptId_fkey" FOREIGN KEY ("primaryDeptId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_subDeptId_fkey" FOREIGN KEY ("subDeptId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_departments" ADD CONSTRAINT "employee_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_department_history" ADD CONSTRAINT "employee_department_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_department_history" ADD CONSTRAINT "employee_department_history_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_contracts" ADD CONSTRAINT "employee_contracts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_rules" ADD CONSTRAINT "overtime_rules_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hourly_wage_history" ADD CONSTRAINT "hourly_wage_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_credentials" ADD CONSTRAINT "employee_credentials_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pin_history" ADD CONSTRAINT "pin_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pin_escrow" ADD CONSTRAINT "pin_escrow_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_visibility" ADD CONSTRAINT "portal_visibility_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionKey_fkey" FOREIGN KEY ("permissionKey") REFERENCES "permissions"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_versions" ADD CONSTRAINT "schedule_versions_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "work_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_shifts" ADD CONSTRAINT "scheduled_shifts_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "work_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_shifts" ADD CONSTRAINT "scheduled_shifts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_shifts" ADD CONSTRAINT "scheduled_shifts_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_clock_events" ADD CONSTRAINT "time_clock_events_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_clock_events" ADD CONSTRAINT "time_clock_events_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "terminal_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_clock_events" ADD CONSTRAINT "time_clock_events_scheduledShiftId_fkey" FOREIGN KEY ("scheduledShiftId") REFERENCES "scheduled_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clock_event_photos" ADD CONSTRAINT "clock_event_photos_clockEventId_fkey" FOREIGN KEY ("clockEventId") REFERENCES "time_clock_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_scheduledShiftId_fkey" FOREIGN KEY ("scheduledShiftId") REFERENCES "scheduled_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_clockInEventId_fkey" FOREIGN KEY ("clockInEventId") REFERENCES "time_clock_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_clockOutEventId_fkey" FOREIGN KEY ("clockOutEventId") REFERENCES "time_clock_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_records" ADD CONSTRAINT "break_records_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_records" ADD CONSTRAINT "break_records_startEventId_fkey" FOREIGN KEY ("startEventId") REFERENCES "time_clock_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_records" ADD CONSTRAINT "break_records_endEventId_fkey" FOREIGN KEY ("endEventId") REFERENCES "time_clock_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_corrections" ADD CONSTRAINT "time_corrections_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_corrections" ADD CONSTRAINT "time_corrections_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "time_corrections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absences" ADD CONSTRAINT "absences_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "absence_days" ADD CONSTRAINT "absence_days_absenceId_fkey" FOREIGN KEY ("absenceId") REFERENCES "absences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sick_leave_records" ADD CONSTRAINT "sick_leave_records_absenceId_fkey" FOREIGN KEY ("absenceId") REFERENCES "absences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacation_balances" ADD CONSTRAINT "vacation_balances_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_time_accounts" ADD CONSTRAINT "working_time_accounts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_time_transactions" ADD CONSTRAINT "working_time_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "working_time_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_time_transactions" ADD CONSTRAINT "working_time_transactions_closingId_fkey" FOREIGN KEY ("closingId") REFERENCES "monthly_time_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_time_closings" ADD CONSTRAINT "monthly_time_closings_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_time_closings" ADD CONSTRAINT "monthly_time_closings_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "monthly_time_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "payroll_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_workSessionId_fkey" FOREIGN KEY ("workSessionId") REFERENCES "work_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_absenceDayId_fkey" FOREIGN KEY ("absenceDayId") REFERENCES "absence_days"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "payroll_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_settlements" ADD CONSTRAINT "payroll_settlements_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "payroll_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_accountTxId_fkey" FOREIGN KEY ("accountTxId") REFERENCES "working_time_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedule_recipients" ADD CONSTRAINT "report_schedule_recipients_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "report_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedule_recipients" ADD CONSTRAINT "report_schedule_recipients_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "email_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_reports" ADD CONSTRAINT "generated_reports_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "report_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_delivery_logs" ADD CONSTRAINT "email_delivery_logs_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "generated_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_findings" ADD CONSTRAINT "compliance_findings_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_revenues" ADD CONSTRAINT "daily_revenues_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Manipulationsschutz: Rohbuchungen und Audit-Log sind unveränderlich ──
CREATE OR REPLACE FUNCTION naya_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'NAYA TIME: % auf % ist nicht erlaubt (unveränderliche Tabelle)', TG_OP, TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER time_clock_events_immutable BEFORE UPDATE OR DELETE ON "time_clock_events"
  FOR EACH ROW EXECUTE FUNCTION naya_forbid_change();
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION naya_forbid_change();
CREATE TRIGGER time_corrections_immutable BEFORE UPDATE OR DELETE ON "time_corrections"
  FOR EACH ROW EXECUTE FUNCTION naya_forbid_change();
CREATE TRIGGER account_tx_immutable BEFORE UPDATE OR DELETE ON "working_time_transactions"
  FOR EACH ROW EXECUTE FUNCTION naya_forbid_change();

-- Fotos: nur Löschmarkierung (deletedAt) darf gesetzt werden, sonst nichts geändert
CREATE OR REPLACE FUNCTION naya_photo_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'NAYA TIME: Foto-Datensätze werden nicht gelöscht, nur markiert'; END IF;
  IF NEW."clockEventId" <> OLD."clockEventId" OR NEW."storageKey" <> OLD."storageKey" OR NEW."sha256" <> OLD."sha256"
     OR NEW."capturedAt" <> OLD."capturedAt" THEN
    RAISE EXCEPTION 'NAYA TIME: Foto-Zuordnung ist unveränderlich';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER clock_event_photos_guard BEFORE UPDATE OR DELETE ON "clock_event_photos"
  FOR EACH ROW EXECUTE FUNCTION naya_photo_guard();

-- Plausibilität
ALTER TABLE "scheduled_shifts" ADD CONSTRAINT shift_end_after_start CHECK ("endAt" IS NULL OR "startAt" IS NULL OR "endAt" > "startAt");
ALTER TABLE "absences" ADD CONSTRAINT absence_dates CHECK ("endDate" >= "startDate");
ALTER TABLE "employee_contracts" ADD CONSTRAINT contract_dates CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");
ALTER TABLE "hourly_wage_history" ADD CONSTRAINT wage_positive CHECK ("centsPerHour" > 0);
ALTER TABLE "overtime_rules" ADD CONSTRAINT included_nonneg CHECK ("includedMinutesPerMonth" >= 0);
ALTER TABLE "payment_records" ADD CONSTRAINT payment_positive CHECK ("amountCents" > 0);
-- Höchstens eine offene Schicht je Mitarbeiter
CREATE UNIQUE INDEX one_open_session_per_employee ON "work_sessions" ("employeeId") WHERE "status" = 'OPEN';
-- Nur ein gültiger Monatsabschluss je Mitarbeiter und Monat
CREATE UNIQUE INDEX one_active_closing ON "monthly_time_closings" ("employeeId","month") WHERE "status" <> 'SUPERSEDED';
