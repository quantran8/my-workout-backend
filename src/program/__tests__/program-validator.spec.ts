import { validateProgram } from '../program-validator';
import type { Prescription, Program, PrescriptionBlock } from '../program.types';
import type { GuardrailResult, Exercise } from '../../profile/guardrail';

// ---- fixtures --------------------------------------------------------------

const cardio: Exercise = {
  exerciseId: '01919f00-0000-7000-8000-000000000001',
  slug: 'outdoor_run',
  name: 'Outdoor Run',
  exerciseType: 'cardio',
  equipment: [],
  difficulty: 2,
  contraindications: [],
  primaryMuscles: ['legs'],
  movementPattern: 'gait',
  goalFit: ['endurance'],
} as unknown as Exercise;

const resistance: Exercise = {
  ...(cardio as unknown as Record<string, unknown>),
  exerciseId: '01919f00-0000-7000-8000-000000000002',
  slug: 'goblet_squat',
  name: 'Goblet Squat',
  exerciseType: 'resistance',
  movementPattern: 'squat',
} as unknown as Exercise;

const guard: GuardrailResult = {
  flags: [],
  policy: {
    allowCalorieDeficit: true,
    allowAggressiveSurplus: true,
    conservativeStart: false,
    requireGuardian: false,
    mustResolveGoalConflict: false,
    maxWeeklySetsPerMuscle: null,
    blockedInjuryAreas: [],
    goalPhasePriority: null,
    adaptationVolumeCapPct: null,
    adaptationDifficultyCap: null,
    adaptationImpactCap: null,
  },
  allowedPool: [cardio, resistance],
  excluded: [],
  userMessages: [],
  safetyNote: '',
};

function prescription(over: Partial<Prescription> = {}): Prescription {
  return {
    prescriptionId: 'p1',
    exerciseId: cardio.exerciseId,
    exerciseSlug: 'outdoor_run',
    exerciseName: 'Outdoor Run',
    order: 1,
    targetSets: 1,
    restSec: 60,
    ...over,
  };
}

// 2-week program (durationWeeks phải ≥ 2 và phủ đủ 1..N) — cùng buổi lặp lại hai tuần,
// để các test block/pool không dính DURATION_OUT_OF_RANGE / WEEK_COVERAGE_MISMATCH.
function programWith(p: Prescription): Program {
  const session = (week: number) => ({
    plannedSessionId: `s${week}`,
    weekNumber: week,
    dayNumber: 1,
    focus: 'cardio',
    prescriptions: [p],
  });
  return {
    programId: 'prog',
    userId: 'u1',
    basedOnProfileVersion: 1,
    type: 'static',
    currentRevision: 1,
    goalSummary: '',
    durationWeeks: 2,
    startDate: '2026-07-23',
    trainingDays: [1],
    phasePlan: null,
    status: 'active',
    revision: {
      revisionId: 'rev',
      programId: 'prog',
      revisionNumber: 1,
      createdAt: '2026-07-23T00:00:00.000Z',
      adjustmentReason: null,
      sessions: [session(1), session(2)],
    },
  };
}

const block = (over: Partial<PrescriptionBlock> = {}): PrescriptionBlock => ({
  order: 1,
  phase: 'work',
  durationSec: 180,
  instruction: 'Chạy nhanh',
  ...over,
});

// ---- tests -----------------------------------------------------------------

describe('interval blocks', () => {
  it('accepts a well-formed cardio interval', () => {
    const result = validateProgram(
      programWith(
        prescription({
          blocks: [
            block({ order: 1, phase: 'warmup', durationSec: 300 }),
            block({ order: 2, phase: 'work', durationSec: 180 }),
            block({ order: 3, phase: 'recovery', durationSec: 120 }),
            block({ order: 4, phase: 'cooldown', durationSec: 600 }),
          ],
        }),
      ),
      guard,
    );
    expect(result.ok).toBe(true);
  });

  it('a prescription without blocks stays valid', () => {
    const result = validateProgram(programWith(prescription()), guard);
    expect(result.ok).toBe(true);
  });

  it('rejects blocks on a non-cardio exercise', () => {
    const result = validateProgram(
      programWith(
        prescription({
          exerciseId: resistance.exerciseId,
          exerciseSlug: 'goblet_squat',
          blocks: [block()],
        }),
      ),
      guard,
    );
    expect(result.ok).toBe(false);
    expect(result.violations.map((v) => v.code)).toContain(
      'BLOCKS_ON_NON_CARDIO',
    );
  });

  it('rejects a gap in block order', () => {
    // The client runs blocks sequentially by `order`; a gap would skip a step.
    const result = validateProgram(
      programWith(
        prescription({ blocks: [block({ order: 1 }), block({ order: 3 })] }),
      ),
      guard,
    );
    expect(result.violations.map((v) => v.code)).toContain(
      'BLOCK_ORDER_INVALID',
    );
  });

  it('rejects duplicate block order', () => {
    const result = validateProgram(
      programWith(
        prescription({ blocks: [block({ order: 1 }), block({ order: 1 })] }),
      ),
      guard,
    );
    expect(result.violations.map((v) => v.code)).toContain(
      'BLOCK_ORDER_INVALID',
    );
  });

  it('rejects a block with neither duration nor distance', () => {
    // Nothing tells the runner when the step ends.
    const result = validateProgram(
      programWith(
        prescription({
          blocks: [block({ durationSec: null, distanceM: null })],
        }),
      ),
      guard,
    );
    expect(result.violations.map((v) => v.code)).toContain('BLOCK_NO_DIMENSION');
  });

  it('accepts a distance-bounded block with no duration', () => {
    const result = validateProgram(
      programWith(
        prescription({
          blocks: [block({ durationSec: null, distanceM: 400 })],
        }),
      ),
      guard,
    );
    expect(result.ok).toBe(true);
  });
});

describe('program duration + week coverage', () => {
  it('rejects a duration below the minimum', () => {
    const p = programWith(prescription());
    p.durationWeeks = 1; // < MIN_PROGRAM_WEEKS
    const result = validateProgram(p, guard);
    expect(result.violations.map((v) => v.code)).toContain('DURATION_OUT_OF_RANGE');
  });

  it('rejects a duration above the maximum', () => {
    const p = programWith(prescription());
    p.durationWeeks = 25; // > MAX_PROGRAM_WEEKS
    const result = validateProgram(p, guard);
    expect(result.violations.map((v) => v.code)).toContain('DURATION_OUT_OF_RANGE');
  });

  it('rejects when a week has no sessions (coverage gap)', () => {
    const p = programWith(prescription());
    // programWith covers weeks 1..2; claim 3 weeks -> week 3 is uncovered.
    p.durationWeeks = 3;
    const result = validateProgram(p, guard);
    expect(result.violations.map((v) => v.code)).toContain('WEEK_COVERAGE_MISMATCH');
  });

  it('rejects a session in a week beyond the duration', () => {
    const p = programWith(prescription());
    p.durationWeeks = 1; // sessions include week 2 -> extra, and below min
    const result = validateProgram(p, guard);
    // below min short-circuits coverage, so assert the duration violation fires
    expect(result.violations.map((v) => v.code)).toContain('DURATION_OUT_OF_RANGE');
  });
});
