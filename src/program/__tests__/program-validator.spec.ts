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

function programWith(p: Prescription): Program {
  return {
    programId: 'prog',
    userId: 'u1',
    basedOnProfileVersion: 1,
    type: 'static',
    currentRevision: 1,
    goalSummary: '',
    phasePlan: null,
    status: 'active',
    revision: {
      revisionId: 'rev',
      programId: 'prog',
      revisionNumber: 1,
      createdAt: '2026-07-23T00:00:00.000Z',
      adjustmentReason: null,
      sessions: [
        {
          plannedSessionId: 's1',
          weekNumber: 1,
          dayNumber: 1,
          focus: 'cardio',
          prescriptions: [p],
        },
      ],
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
