/**
 * seed-exercises.ts — import movement_library_curated.json into the Exercise table.
 *
 * Two transforms matter:
 *  1. snake_case (JSON) -> camelCase (Prisma Exercise model) for top-level keys.
 *  2. SAFETY-CRITICAL: contraindications[].injury_area -> injuryArea. guardrail.ts reads
 *     `ci.injuryArea`; without this rename the injury filter silently blocks nothing.
 *
 * Review gate: everything imports with reviewedBy = null EXCEPT a curated core subset
 * (base movement patterns, bodyweight/dumbbell) which is marked reviewedBy = 'system' so
 * the free path can generate a program immediately. PTs review the rest via the admin
 * endpoint. Re-runnable: upserts by exerciseId.
 *
 * Run: npm run db:seed   (tsx prisma/seed/seed-exercises.ts)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient, ExerciseType } from '@prisma/client';

const prisma = new PrismaClient();

interface RawContraindication {
  injury_area: string;
  reason?: string;
}

interface RawExercise {
  exercise_id: string;
  name: string;
  aliases?: string[];
  exercise_type: string;
  primary_muscles: string[];
  secondary_muscles?: string[];
  equipment: string[];
  difficulty: number;
  is_compound?: boolean | null;
  cues?: string[] | null;
  media?: Record<string, unknown> | null;
  source?: Record<string, unknown> | null;
  movement_pattern?: string | null;
  goal_fit?: string[] | null;
  is_unilateral?: boolean | null;
  contraindications?: RawContraindication[];
  progression_of?: string | null;
  regression_of?: string | null;
  default_prescription?: Record<string, unknown> | null;
  needs_review?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Curated core subset marked reviewed so the free path works out of the box.
// Base patterns + a little mobility/cardio, restricted to bodyweight/dumbbell.
// ---------------------------------------------------------------------------
const REVIEWER = 'system';
const CORE_PATTERNS = new Set([
  'squat',
  'hinge',
  'push_h',
  'push_v',
  'pull_h',
  'pull_v',
  'lunge',
  'carry',
  'core',
]);
const CORE_EQUIPMENT = new Set(['bodyweight', 'dumbbell']);
const CORE_MAX_DIFFICULTY = 3;
const CORE_TARGET_COUNT = 45; // cap the auto-reviewed pool

function isCoreCandidate(raw: RawExercise): boolean {
  const pattern = raw.movement_pattern ?? '';
  const equip = raw.equipment ?? [];
  const type = raw.exercise_type;
  if (type === 'resistance') {
    return (
      CORE_PATTERNS.has(pattern) &&
      equip.some((e) => CORE_EQUIPMENT.has(e)) &&
      (raw.difficulty ?? 5) <= CORE_MAX_DIFFICULTY
    );
  }
  // a few bodyweight mobility + cardio to round out the pool
  if (type === 'mobility' || type === 'cardio') {
    return (
      equip.some((e) => CORE_EQUIPMENT.has(e)) &&
      (raw.difficulty ?? 5) <= CORE_MAX_DIFFICULTY
    );
  }
  return false;
}

function mapContraindications(raw: RawContraindication[] | undefined) {
  return (raw ?? []).map((c) => ({
    injuryArea: c.injury_area, // <-- safety-critical rename
    reason: c.reason ?? undefined,
  }));
}

function toExerciseType(v: string): ExerciseType {
  if (v === 'resistance' || v === 'cardio' || v === 'mobility') return v;
  return ExerciseType.resistance;
}

async function main() {
  const file = join(__dirname, 'movement_library_curated.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as RawExercise[];

  // Decide the reviewed core subset (cap the count, resistance-first for coverage).
  const candidates = raw.filter(isCoreCandidate);
  const resistanceFirst = [
    ...candidates.filter((e) => e.exercise_type === 'resistance'),
    ...candidates.filter((e) => e.exercise_type !== 'resistance'),
  ];
  const reviewedIds = new Set(
    resistanceFirst.slice(0, CORE_TARGET_COUNT).map((e) => e.exercise_id),
  );
  const reviewedAt = new Date();

  let count = 0;
  for (const r of raw) {
    const reviewed = reviewedIds.has(r.exercise_id);
    const data = {
      name: r.name,
      aliases: r.aliases ?? [],
      exerciseType: toExerciseType(r.exercise_type),
      primaryMuscles: r.primary_muscles ?? [],
      secondaryMuscles: r.secondary_muscles ?? [],
      equipment: r.equipment ?? [],
      difficulty: r.difficulty,
      isCompound: r.is_compound ?? null,
      cues: r.cues ?? undefined,
      media: r.media ?? undefined,
      source: r.source ?? undefined,
      movementPattern: r.movement_pattern ?? null,
      goalFit: r.goal_fit ?? undefined,
      isUnilateral: r.is_unilateral ?? null,
      contraindications: mapContraindications(r.contraindications),
      progressionOf: r.progression_of ?? null,
      regressionOf: r.regression_of ?? null,
      // default_prescription internals (rep_range/rest_sec) stay snake in the blob:
      // only the LLM reads them, and slimPool passes them through unchanged.
      defaultRx: r.default_prescription ?? undefined,
      reviewedBy: reviewed ? REVIEWER : null,
      reviewedAt: reviewed ? reviewedAt : null,
    };

    await prisma.exercise.upsert({
      where: { exerciseId: r.exercise_id },
      // Do NOT overwrite a human PT's review on re-seed.
      update: reviewed ? data : { ...data, reviewedBy: undefined, reviewedAt: undefined },
      create: { exerciseId: r.exercise_id, ...data },
    });
    count++;
  }

  console.log(
    `Seeded ${count} exercises; ${reviewedIds.size} marked reviewedBy='${REVIEWER}'.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
