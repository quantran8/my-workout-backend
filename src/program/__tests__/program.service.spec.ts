import { UnprocessableEntityException } from '@nestjs/common';
import { ProgramService } from '../program.service';
import type { ProgramDraft } from '../../llm/llm.types';
import type { Profile } from '../../profile/profile.types';
import type { GuardrailResult, Exercise } from '../../profile/guardrail';

// ---- fixtures --------------------------------------------------------------

const profile: Profile = {
  constraint: {
    sex: 'male',
    age: 30,
    heightCm: 175,
    weightKg: 75,
    experienceLevel: 'beginner',
    equipment: ['dumbbell', 'bodyweight'],
    injuries: [],
    mobilityLimits: [],
    schedule: { daysPerWeek: 1, minutesPerSession: 45 },
  },
  target: {
    statedGoals: ['khỏe hơn'],
    problems: [],
    inferredNeeds: [{ type: 'strength' }],
  },
};

const pool: Exercise[] = [
  {
    exerciseId: 'goblet_squat',
    name: 'Goblet Squat',
    exerciseType: 'resistance',
    equipment: ['dumbbell'],
    difficulty: 2,
    contraindications: [],
    primaryMuscles: ['quads'],
    movementPattern: 'squat',
    goalFit: ['strength'],
  } as unknown as Exercise,
];

const guard: GuardrailResult = {
  flags: [],
  policy: {
    allowCalorieDeficit: true,
    allowAggressiveSurplus: true,
    conservativeStart: true,
    requireGuardian: false,
    mustResolveGoalConflict: false,
    maxWeeklySetsPerMuscle: null,
    blockedInjuryAreas: [],
    goalPhasePriority: null,
  },
  allowedPool: pool,
  excluded: [],
  userMessages: [],
  safetyNote: '',
};

// 1 buổi/tuần, 1 bài trong pool -> hợp lệ
const cleanDraft: ProgramDraft = {
  goalSummary: 'Chương trình sức mạnh cơ bản.',
  phasePlan: [],
  sessions: [
    {
      weekNumber: 1,
      dayNumber: 1,
      focus: 'Full body',
      prescriptions: [
        {
          exerciseId: 'goblet_squat',
          order: 1,
          targetSets: 3,
          targetReps: [8, 12],
          restSec: 90,
        },
      ],
    },
  ],
};

// bài ngoài pool -> EXERCISE_NOT_IN_POOL
const violatingDraft: ProgramDraft = {
  goalSummary: 'Bịa bài.',
  phasePlan: [],
  sessions: [
    {
      weekNumber: 1,
      dayNumber: 1,
      focus: 'Full body',
      prescriptions: [
        {
          exerciseId: 'made_up_exercise',
          order: 1,
          targetSets: 3,
          targetReps: [8, 12],
          restSec: 90,
        },
      ],
    },
  ],
};

// ---- helpers to build the service with mocks -------------------------------

function makeService(drafts: ProgramDraft[]) {
  const generateProgram = jest
    .fn()
    .mockImplementation(() => Promise.resolve(drafts.shift()));
  const llm = { generateProgram } as any;

  const persist = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    userProfile: { findUnique: jest.fn().mockResolvedValue({ profileVersion: 1 }) },
    $transaction: persist,
  } as any;

  const profileService = {
    getProfile: jest.fn().mockResolvedValue({ profile, flags: [], bmi: null }),
    buildGuardrail: jest.fn().mockResolvedValue(guard),
  } as any;

  const service = new ProgramService(prisma, llm, profileService);
  return { service, generateProgram, persist };
}

// ---- tests -----------------------------------------------------------------

describe('ProgramService.generateStaticProgram (validate/repair loop)', () => {
  it('persists on the first clean draft', async () => {
    const { service, generateProgram, persist } = makeService([cleanDraft]);
    const program = await service.generateStaticProgram('user-1');
    expect(generateProgram).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(program.type).toBe('static');
    expect(program.currentRevision).toBe(1);
    expect(program.revision.sessions[0].prescriptions[0].exerciseId).toBe(
      'goblet_squat',
    );
  });

  it('repairs: violating draft then clean draft -> succeeds on attempt 2', async () => {
    const { service, generateProgram, persist } = makeService([
      violatingDraft,
      cleanDraft,
    ]);
    const program = await service.generateStaticProgram('user-1');
    expect(generateProgram).toHaveBeenCalledTimes(2);
    // 2nd call must carry the previous violations
    const secondCallArg = generateProgram.mock.calls[1][0];
    expect(secondCallArg.previousViolations.length).toBeGreaterThan(0);
    expect(secondCallArg.previousViolations[0].code).toBe('EXERCISE_NOT_IN_POOL');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(program.goalSummary).toBe(cleanDraft.goalSummary);
  });

  it('soft-fails after 3 violating drafts (never persists)', async () => {
    const { service, generateProgram, persist } = makeService([
      violatingDraft,
      violatingDraft,
      violatingDraft,
    ]);
    await expect(service.generateStaticProgram('user-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(generateProgram).toHaveBeenCalledTimes(3);
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects when the reviewed pool is empty', async () => {
    const { service } = makeService([cleanDraft]);
    (service as any).profileService.buildGuardrail = jest
      .fn()
      .mockResolvedValue({ ...guard, allowedPool: [] });
    await expect(service.generateStaticProgram('user-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
