-- Interval / circuit support for cardio prescriptions (§3).
-- The models existed in schema.prisma but were never migrated; this brings the
-- database in line.

-- CreateEnum
CREATE TYPE "WorkoutBlockPhase" AS ENUM ('warmup', 'work', 'recovery', 'cooldown');

-- AlterTable: cardio pace target, compared against LoggedSet.actualPaceSecPerKm
ALTER TABLE "Prescription" ADD COLUMN "targetPaceSecPerKm" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PrescriptionBlock" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "prescriptionId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "phase" "WorkoutBlockPhase" NOT NULL,
    "durationSec" INTEGER,
    "distanceM" INTEGER,
    "targetRpeMin" INTEGER,
    "targetRpeMax" INTEGER,
    "targetPaceSecPerKm" DOUBLE PRECISION,
    "instruction" TEXT NOT NULL,

    CONSTRAINT "PrescriptionBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrescriptionBlock_prescriptionId_idx" ON "PrescriptionBlock"("prescriptionId");

-- The client runs blocks sequentially by `order`, so it must be unique per prescription.
CREATE UNIQUE INDEX "PrescriptionBlock_prescriptionId_order_key" ON "PrescriptionBlock"("prescriptionId", "order");

-- AddForeignKey
ALTER TABLE "PrescriptionBlock" ADD CONSTRAINT "PrescriptionBlock_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
