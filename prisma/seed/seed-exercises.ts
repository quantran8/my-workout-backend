/**
 * seed-exercises.ts — import movement_library_curated.json into the Exercise table.
 *
 * Four transforms matter:
 *  1. snake_case (JSON) -> camelCase (Prisma Exercise model) for top-level keys.
 *  2. SAFETY-CRITICAL: contraindications[].injury_area -> injuryArea. guardrail.ts reads
 *     `ci.injuryArea`; without this rename the injury filter silently blocks nothing.
 *  3. cues (JSON) -> instructions (model). The source blob is step-by-step text, which is
 *     what `instructions` means; the column was misnamed.
 *  4. media is normalized to a fixed shape (see normalizeMedia) so every row carries
 *     provenance/review state instead of just image URLs.
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
import { PrismaClient, ExerciseType, ContentMode } from '@prisma/client';

const prisma = new PrismaClient();

interface RawContraindication {
  injury_area: string;
  reason?: string;
}

interface RawMedia {
  start_img?: string | null;
  end_img?: string | null;
  video_url?: string | null;
}

interface RawExercise {
  slug: string;
  name: string;
  aliases?: string[];
  exercise_type: string;
  primary_muscles: string[];
  secondary_muscles?: string[];
  equipment: string[];
  difficulty: number;
  is_compound?: boolean | null;
  cues?: string[] | null; // -> instructions
  media?: RawMedia | null;
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

// ---------------------------------------------------------------------------
// environments — derived from equipment, the only location signal in the source.
// Bodyweight-only travels everywhere; heavy/rack equipment is gym-bound. Unknown
// equipment stays gym-only (conservative: never promise a movement works at home).
// ---------------------------------------------------------------------------
const GYM_ONLY_EQUIPMENT = new Set(['barbell', 'other', 'unknown']);
const PORTABLE_EQUIPMENT = new Set([
  'bodyweight',
  'dumbbell',
  'kettlebell',
  'resistance_band',
  'medicine_ball',
  'stability_ball',
  'foam_roller',
]);

function deriveEnvironments(raw: RawExercise): string[] {
  const equip = raw.equipment ?? [];
  if (equip.some((e) => GYM_ONLY_EQUIPMENT.has(e))) return ['gym'];
  const portable = equip.length > 0 && equip.every((e) => PORTABLE_EQUIPMENT.has(e));
  if (!portable) return ['gym'];
  // Bodyweight-only also works outdoors; loaded-but-portable is gym+home.
  const bodyweightOnly = equip.every((e) => e === 'bodyweight');
  return bodyweightOnly ? ['gym', 'home', 'outdoor'] : ['gym', 'home'];
}

/**
 * normalizeMedia — every row gets the same shape so consumers never branch on
 * missing keys. The source repo is a single uniform import (all 585 rows: two
 * stills, no video, Unlicense), so provenance is constant here; these fields
 * exist to carry NON-constant values once first-party media lands.
 *
 *  - instructorKey      who demonstrates (null = no human, stock illustration)
 *  - productionStyleKey visual treatment, for mixing sources without a jarring feed
 *  - ownership          'third_party' | 'licensed' | 'first_party' — drives takedown risk
 *  - reviewStatus       gates display the same way Exercise.reviewedBy gates the pool
 */
function normalizeMedia(raw: RawExercise) {
  const m = raw.media ?? {};
  return {
    startImg: m.start_img ?? null,
    endImg: m.end_img ?? null,
    videoUrl: m.video_url ?? null,
    instructorKey: null, // stock stills from free-exercise-db — no named instructor
    productionStyleKey: 'stock_still',
    ownership: 'third_party',
    reviewStatus: 'unreviewed',
  };
}

/**
 * contentMode — demonstration requires at least one still to show the movement;
 * otherwise the client can only render the text steps.
 */
function deriveContentMode(raw: RawExercise): ContentMode {
  const m = raw.media ?? {};
  return m.start_img || m.video_url
    ? ContentMode.demonstration
    : ContentMode.instruction_only;
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
  const reviewedSlugs = new Set(
    resistanceFirst.slice(0, CORE_TARGET_COUNT).map((e) => e.slug),
  );
  const reviewedAt = new Date();

  let count = 0;
  for (const r of raw) {
    const reviewed = reviewedSlugs.has(r.slug);
    const data = {
      name: r.name,
      aliases: r.aliases ?? [],
      exerciseType: toExerciseType(r.exercise_type),
      primaryMuscles: r.primary_muscles ?? [],
      secondaryMuscles: r.secondary_muscles ?? [],
      equipment: r.equipment ?? [],
      difficulty: r.difficulty,
      isCompound: r.is_compound ?? null,
      instructions: r.cues ?? undefined, // JSON key stays `cues`; column is `instructions`
      media: normalizeMedia(r),
      source: r.source ?? undefined,
      contentMode: deriveContentMode(r),
      environments: deriveEnvironments(r),
      movementPattern: r.movement_pattern ?? null,
      goalFit: r.goal_fit ?? undefined,
      isUnilateral: r.is_unilateral ?? null,
      contraindications: mapContraindications(r.contraindications),
      // default_prescription internals (rep_range/rest_sec) stay snake in the blob:
      // only the LLM reads them, and slimPool passes them through unchanged.
      defaultRx: r.default_prescription ?? undefined,
      reviewedBy: reviewed ? REVIEWER : null,
      reviewedAt: reviewed ? reviewedAt : null,
    };

    await prisma.exercise.upsert({
      where: { slug: r.slug },
      // Do NOT overwrite a human PT's review on re-seed.
      update: reviewed ? data : { ...data, reviewedBy: undefined, reviewedAt: undefined },
      create: { slug: r.slug, ...data },
    });
    count++;
  }

  // Pass 2: progression_of/regression_of are slugs in the JSON but uuid FKs in the DB,
  // so they can only be resolved once every row above exists.
  const idBySlug = new Map(
    (await prisma.exercise.findMany({ select: { id: true, slug: true } })).map(
      (e) => [e.slug, e.id] as const,
    ),
  );
  let linked = 0;
  const dangling: string[] = [];
  for (const r of raw) {
    if (!r.progression_of && !r.regression_of) continue;
    const resolve = (slug: string | null | undefined) => {
      if (!slug) return null;
      const id = idBySlug.get(slug);
      if (!id) dangling.push(`${r.slug} -> ${slug}`);
      return id ?? null;
    };
    await prisma.exercise.update({
      where: { slug: r.slug },
      data: {
        progressionOf: resolve(r.progression_of),
        regressionOf: resolve(r.regression_of),
      },
    });
    linked++;
  }
  if (dangling.length) {
    console.warn(
      `WARN ${dangling.length} unresolved progression/regression slug(s): ${dangling.slice(0, 10).join(', ')}`,
    );
  }

  console.log(
    `Seeded ${count} exercises; ${reviewedSlugs.size} marked reviewedBy='${REVIEWER}'; ${linked} progression/regression link(s) resolved.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
