-- Add Exercise.contentMode and Exercise.environments to match schema.prisma.
-- Both were declared in the schema but never migrated (schema drift), so the
-- Prisma client selected columns the DB did not have — every exercise query
-- failed and surfaced as a 400 on the program-generate path.

-- CreateEnum
CREATE TYPE "ContentMode" AS ENUM ('demonstration', 'instruction_only');

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "contentMode" "ContentMode" NOT NULL DEFAULT 'demonstration',
ADD COLUMN     "environments" JSONB NOT NULL DEFAULT '[]';
