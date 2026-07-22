-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('resistance', 'cardio', 'mobility');

-- CreateEnum
CREATE TYPE "ProgramType" AS ENUM ('static', 'living');

-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('planned', 'in_progress', 'completed', 'aborted', 'held');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('outdoor', 'indoor', 'unknown');

-- CreateEnum
CREATE TYPE "DistanceSource" AS ENUM ('gps', 'smart_trainer', 'bike_sensor', 'machine_manual', 'none');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('manual', 'healthkit_phone', 'wearable');

-- CreateEnum
CREATE TYPE "EnergyLevel" AS ENUM ('low', 'ok', 'high');

-- CreateEnum
CREATE TYPE "FeedbackFlag" AS ENUM ('too_easy', 'too_hard', 'uncomfortable', 'ok');

-- CreateEnum
CREATE TYPE "SessionReadinessStatus" AS ENUM ('completed', 'skipped');

-- CreateEnum
CREATE TYPE "ResidualSoreness" AS ENUM ('none', 'mild', 'moderate', 'severe');

-- CreateEnum
CREATE TYPE "ReadinessEnergyLevel" AS ENUM ('very_low', 'low', 'normal', 'high');

-- CreateEnum
CREATE TYPE "ReadinessVerdict" AS ENUM ('ready', 'modify', 'hold', 'unknown');

-- CreateEnum
CREATE TYPE "ExecutionItemStatus" AS ENUM ('planned', 'in_progress', 'completed', 'skipped', 'stopped');

-- CreateEnum
CREATE TYPE "FeedbackEventType" AS ENUM ('too_easy', 'too_hard', 'uncomfortable', 'pain_stop', 'ok');

-- CreateEnum
CREATE TYPE "FeedbackActionTaken" AS ENUM ('none', 'reduce_remaining_sets', 'reduce_target', 'use_regression', 'substitute_exercise', 'stop_exercise', 'stop_related_pattern', 'end_session');

-- CreateEnum
CREATE TYPE "FollowupStatus" AS ENUM ('scheduled', 'sent', 'completed', 'skipped', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "AssessmentStage" AS ENUM ('immediate', 'final_after_followup');

-- CreateEnum
CREATE TYPE "ToleranceVerdict" AS ENUM ('well_tolerated', 'tolerated', 'borderline', 'not_tolerated', 'pending');

-- CreateEnum
CREATE TYPE "MovementToleranceVerdict" AS ENUM ('tolerating', 'borderline', 'not_tolerating', 'insufficient_data');

-- CreateEnum
CREATE TYPE "AdaptationPhaseStatus" AS ENUM ('not_required', 'active', 'completed', 'paused', 'cancelled');

-- CreateEnum
CREATE TYPE "ImpactCap" AS ENUM ('low', 'moderate', 'high');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('progressing', 'plateau', 'insufficient_data');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "RecommendedAction" AS ENUM ('hold', 'increase', 'decrease', 'change_program');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tier" "Tier" NOT NULL DEFAULT 'FREE',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "userId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL DEFAULT 1,
    "rawOnboarding" TEXT NOT NULL,
    "constraint" JSONB NOT NULL,
    "target" JSONB NOT NULL,
    "redFlags" JSONB NOT NULL DEFAULT '[]',
    "bmi" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ProfileHistory" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL DEFAULT '[]',
    "exerciseType" "ExerciseType" NOT NULL,
    "primaryMuscles" JSONB NOT NULL,
    "secondaryMuscles" JSONB NOT NULL DEFAULT '[]',
    "equipment" JSONB NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "isCompound" BOOLEAN,
    "cues" JSONB,
    "media" JSONB,
    "source" JSONB,
    "movementPattern" TEXT,
    "goalFit" JSONB,
    "isUnilateral" BOOLEAN,
    "contraindications" JSONB NOT NULL DEFAULT '[]',
    "progressionOf" UUID,
    "regressionOf" UUID,
    "defaultRx" JSONB,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "basedOnProfileVersion" INTEGER NOT NULL,
    "adaptationPhaseId" UUID,
    "type" "ProgramType" NOT NULL DEFAULT 'static',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "goalSummary" TEXT NOT NULL,
    "phasePlan" JSONB,
    "status" "ProgramStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramRevision" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "programId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "adjustmentReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannedSession" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "revisionId" UUID NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "focus" TEXT NOT NULL,

    CONSTRAINT "PlannedSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "plannedSessionId" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "targetSets" INTEGER NOT NULL,
    "targetReps" JSONB,
    "targetWeightKg" DOUBLE PRECISION,
    "targetDurationSec" INTEGER,
    "targetDistanceM" INTEGER,
    "targetRpe" INTEGER,
    "restSec" INTEGER NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "plannedSessionId" UUID,
    "programRevisionId" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'completed',
    "environment" "Environment" NOT NULL DEFAULT 'unknown',
    "distanceSource" "DistanceSource" NOT NULL DEFAULT 'none',
    "dataSource" "DataSource" NOT NULL DEFAULT 'manual',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "completionPct" DOUBLE PRECISION,
    "sessionRpe" INTEGER,
    "energyAfter" "EnergyLevel",
    "notes" TEXT,
    "wearable" JSONB,

    CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoggedSet" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sessionId" UUID NOT NULL,
    "prescriptionId" UUID,
    "executionItemId" UUID,
    "movementPattern" TEXT,
    "exerciseId" UUID NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "actualReps" INTEGER,
    "actualWeightKg" DOUBLE PRECISION,
    "actualDurationSec" INTEGER,
    "actualDistanceM" INTEGER,
    "actualPaceSecPerKm" DOUBLE PRECISION,
    "stroke" TEXT,
    "actualRom" TEXT,
    "actualRpe" INTEGER,
    "feedbackFlag" "FeedbackFlag",
    "fieldSources" JSONB,

    CONSTRAINT "LoggedSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionReadiness" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sessionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "SessionReadinessStatus" NOT NULL,
    "currentDiscomforts" JSONB NOT NULL DEFAULT '[]',
    "residualSoreness" "ResidualSoreness" NOT NULL DEFAULT 'none',
    "energyLevel" "ReadinessEnergyLevel" NOT NULL DEFAULT 'normal',
    "externalLoads" JSONB NOT NULL DEFAULT '{}',
    "verdict" "ReadinessVerdict" NOT NULL DEFAULT 'unknown',
    "modifications" JSONB NOT NULL DEFAULT '[]',
    "ruleVersion" TEXT NOT NULL,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionReadiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionExecutionItem" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sessionId" UUID NOT NULL,
    "sourcePrescriptionId" UUID,
    "originalExerciseId" UUID,
    "exerciseId" UUID NOT NULL,
    "movementPattern" TEXT,
    "order" INTEGER NOT NULL,
    "plannedRx" JSONB,
    "effectiveRx" JSONB,
    "appliedModifications" JSONB NOT NULL DEFAULT '[]',
    "status" "ExecutionItemStatus" NOT NULL DEFAULT 'planned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionExecutionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseFeedbackEvent" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sessionId" UUID NOT NULL,
    "executionItemId" UUID,
    "setId" UUID,
    "exerciseId" UUID NOT NULL,
    "movementPattern" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "FeedbackEventType" NOT NULL,
    "bodyArea" TEXT,
    "severity" INTEGER,
    "notes" TEXT,
    "actionTaken" "FeedbackActionTaken" NOT NULL DEFAULT 'none',
    "triggeredFollowup" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExerciseFeedbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostSessionFollowup" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "sourceSessionId" UUID NOT NULL,
    "status" "FollowupStatus" NOT NULL DEFAULT 'scheduled',
    "triggerReasons" JSONB NOT NULL DEFAULT '[]',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "reactions" JSONB NOT NULL DEFAULT '[]',
    "requiresConservativeAction" BOOLEAN NOT NULL DEFAULT false,
    "requiresProfessionalSupportPrompt" BOOLEAN NOT NULL DEFAULT false,
    "ruleVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostSessionFollowup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionToleranceAssessment" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "sessionId" UUID NOT NULL,
    "assessmentStage" "AssessmentStage" NOT NULL,
    "readinessSignal" JSONB,
    "duringSessionSignal" JSONB,
    "delayedSignal" JSONB,
    "sessionToleranceVerdict" "ToleranceVerdict" NOT NULL DEFAULT 'pending',
    "affectedPatterns" JSONB NOT NULL DEFAULT '[]',
    "affectedBodyAreas" JSONB NOT NULL DEFAULT '[]',
    "evidenceRefs" JSONB NOT NULL DEFAULT '[]',
    "ruleVersion" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessionToleranceAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovementToleranceRollup" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "movementPattern" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "exposureCount" INTEGER NOT NULL DEFAULT 0,
    "toleratedExposureCount" INTEGER NOT NULL DEFAULT 0,
    "borderlineExposureCount" INTEGER NOT NULL DEFAULT 0,
    "notToleratedExposureCount" INTEGER NOT NULL DEFAULT 0,
    "consecutiveTolerated" INTEGER NOT NULL DEFAULT 0,
    "painStopCount" INTEGER NOT NULL DEFAULT 0,
    "recentToleratedLoad" JSONB,
    "painStopFrequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "toleranceVerdict" "MovementToleranceVerdict" NOT NULL DEFAULT 'insufficient_data',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "confidence" "Confidence" NOT NULL DEFAULT 'low',
    "calculationVersion" TEXT NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovementToleranceRollup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingDecision" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "sessionId" UUID,
    "scope" TEXT NOT NULL DEFAULT 'safety',
    "readinessVerdict" "ReadinessVerdict",
    "toleranceVerdict" "MovementToleranceVerdict",
    "actions" JSONB NOT NULL DEFAULT '[]',
    "safetyOverrideActive" BOOLEAN NOT NULL DEFAULT false,
    "neverIncreaseLoad" BOOLEAN NOT NULL DEFAULT false,
    "evidenceRefs" JSONB NOT NULL DEFAULT '[]',
    "ruleVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdaptationPhase" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "profileVersion" INTEGER NOT NULL,
    "status" "AdaptationPhaseStatus" NOT NULL DEFAULT 'not_required',
    "triggerReasons" JSONB NOT NULL DEFAULT '[]',
    "consecutiveToleratedSessions" INTEGER NOT NULL DEFAULT 0,
    "volumeCapPct" DOUBLE PRECISION,
    "difficultyCap" INTEGER,
    "impactCap" "ImpactCap",
    "exitCriteria" JSONB NOT NULL DEFAULT '{}',
    "ruleVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdaptationPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressRollup" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "userId" UUID NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "perExercise" JSONB NOT NULL,
    "domainSummary" JSONB NOT NULL,
    "verdict" "Verdict" NOT NULL,
    "verdictEvidence" JSONB NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "recommendedAction" "RecommendedAction" NOT NULL,
    "interpretation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressRollup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileHistory_userId_profileVersion_key" ON "ProfileHistory"("userId", "profileVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_slug_key" ON "Exercise"("slug");

-- CreateIndex
CREATE INDEX "Exercise_movementPattern_idx" ON "Exercise"("movementPattern");

-- CreateIndex
CREATE INDEX "Exercise_exerciseType_idx" ON "Exercise"("exerciseType");

-- CreateIndex
CREATE INDEX "Exercise_difficulty_idx" ON "Exercise"("difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramRevision_programId_revisionNumber_key" ON "ProgramRevision"("programId", "revisionNumber");

-- CreateIndex
CREATE INDEX "WorkoutSession_userId_startedAt_idx" ON "WorkoutSession"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "LoggedSet_exerciseId_idx" ON "LoggedSet"("exerciseId");

-- CreateIndex
CREATE INDEX "LoggedSet_sessionId_idx" ON "LoggedSet"("sessionId");

-- CreateIndex
CREATE INDEX "LoggedSet_executionItemId_idx" ON "LoggedSet"("executionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionReadiness_sessionId_key" ON "SessionReadiness"("sessionId");

-- CreateIndex
CREATE INDEX "SessionReadiness_userId_assessedAt_idx" ON "SessionReadiness"("userId", "assessedAt");

-- CreateIndex
CREATE INDEX "SessionExecutionItem_sessionId_order_idx" ON "SessionExecutionItem"("sessionId", "order");

-- CreateIndex
CREATE INDEX "SessionExecutionItem_exerciseId_idx" ON "SessionExecutionItem"("exerciseId");

-- CreateIndex
CREATE INDEX "SessionExecutionItem_movementPattern_idx" ON "SessionExecutionItem"("movementPattern");

-- CreateIndex
CREATE INDEX "ExerciseFeedbackEvent_sessionId_idx" ON "ExerciseFeedbackEvent"("sessionId");

-- CreateIndex
CREATE INDEX "ExerciseFeedbackEvent_executionItemId_idx" ON "ExerciseFeedbackEvent"("executionItemId");

-- CreateIndex
CREATE INDEX "ExerciseFeedbackEvent_exerciseId_movementPattern_idx" ON "ExerciseFeedbackEvent"("exerciseId", "movementPattern");

-- CreateIndex
CREATE INDEX "ExerciseFeedbackEvent_type_idx" ON "ExerciseFeedbackEvent"("type");

-- CreateIndex
CREATE INDEX "PostSessionFollowup_userId_status_idx" ON "PostSessionFollowup"("userId", "status");

-- CreateIndex
CREATE INDEX "PostSessionFollowup_scheduledFor_idx" ON "PostSessionFollowup"("scheduledFor");

-- CreateIndex
CREATE INDEX "PostSessionFollowup_sourceSessionId_idx" ON "PostSessionFollowup"("sourceSessionId");

-- CreateIndex
CREATE INDEX "SessionToleranceAssessment_sessionToleranceVerdict_idx" ON "SessionToleranceAssessment"("sessionToleranceVerdict");

-- CreateIndex
CREATE UNIQUE INDEX "SessionToleranceAssessment_sessionId_assessmentStage_key" ON "SessionToleranceAssessment"("sessionId", "assessmentStage");

-- CreateIndex
CREATE INDEX "MovementToleranceRollup_userId_toleranceVerdict_idx" ON "MovementToleranceRollup"("userId", "toleranceVerdict");

-- CreateIndex
CREATE UNIQUE INDEX "MovementToleranceRollup_userId_movementPattern_windowStart_key" ON "MovementToleranceRollup"("userId", "movementPattern", "windowStart");

-- CreateIndex
CREATE INDEX "TrainingDecision_userId_createdAt_idx" ON "TrainingDecision"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TrainingDecision_sessionId_idx" ON "TrainingDecision"("sessionId");

-- CreateIndex
CREATE INDEX "AdaptationPhase_userId_status_idx" ON "AdaptationPhase"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressRollup_userId_weekStart_key" ON "ProgressRollup"("userId", "weekStart");

-- AddForeignKey
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileHistory" ADD CONSTRAINT "ProfileHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_adaptationPhaseId_fkey" FOREIGN KEY ("adaptationPhaseId") REFERENCES "AdaptationPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramRevision" ADD CONSTRAINT "ProgramRevision_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannedSession" ADD CONSTRAINT "PlannedSession_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProgramRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_plannedSessionId_fkey" FOREIGN KEY ("plannedSessionId") REFERENCES "PlannedSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSession" ADD CONSTRAINT "WorkoutSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoggedSet" ADD CONSTRAINT "LoggedSet_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoggedSet" ADD CONSTRAINT "LoggedSet_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoggedSet" ADD CONSTRAINT "LoggedSet_executionItemId_fkey" FOREIGN KEY ("executionItemId") REFERENCES "SessionExecutionItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionReadiness" ADD CONSTRAINT "SessionReadiness_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionReadiness" ADD CONSTRAINT "SessionReadiness_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExecutionItem" ADD CONSTRAINT "SessionExecutionItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionExecutionItem" ADD CONSTRAINT "SessionExecutionItem_sourcePrescriptionId_fkey" FOREIGN KEY ("sourcePrescriptionId") REFERENCES "Prescription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseFeedbackEvent" ADD CONSTRAINT "ExerciseFeedbackEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseFeedbackEvent" ADD CONSTRAINT "ExerciseFeedbackEvent_executionItemId_fkey" FOREIGN KEY ("executionItemId") REFERENCES "SessionExecutionItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseFeedbackEvent" ADD CONSTRAINT "ExerciseFeedbackEvent_setId_fkey" FOREIGN KEY ("setId") REFERENCES "LoggedSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSessionFollowup" ADD CONSTRAINT "PostSessionFollowup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSessionFollowup" ADD CONSTRAINT "PostSessionFollowup_sourceSessionId_fkey" FOREIGN KEY ("sourceSessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionToleranceAssessment" ADD CONSTRAINT "SessionToleranceAssessment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovementToleranceRollup" ADD CONSTRAINT "MovementToleranceRollup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingDecision" ADD CONSTRAINT "TrainingDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingDecision" ADD CONSTRAINT "TrainingDecision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdaptationPhase" ADD CONSTRAINT "AdaptationPhase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressRollup" ADD CONSTRAINT "ProgressRollup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
