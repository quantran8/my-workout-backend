-- Add Program.durationWeeks, Program.startDate, Program.trainingDays.
-- Before this a program had no notion of how long it runs or which weekdays it
-- trains, so "today's workout" could not be resolved from the calendar. These
-- three columns + the existing PlannedSession.weekNumber/dayNumber are enough to
-- map any date -> a planned session without a row per calendar day.
--
-- trainingDays is ISO weekday numbers 1..7 (Mon=1..Sun=7), sorted ascending; its
-- 1-based index is the PlannedSession.dayNumber it maps to.

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "durationWeeks" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "startDate" DATE NOT NULL DEFAULT CURRENT_DATE,
ADD COLUMN     "trainingDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
