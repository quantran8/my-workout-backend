-- Rename Exercise.cues -> Exercise.instructions to match schema.prisma.
-- schema.prisma was edited to rename the column but no migration was ever
-- generated, so the DB kept "cues" while the Prisma client selected
-- "instructions" — every exercise query (buildGuardrail, program generate)
-- failed with `column Exercise.instructions does not exist`, surfacing as a 400.
ALTER TABLE "Exercise" RENAME COLUMN "cues" TO "instructions";
