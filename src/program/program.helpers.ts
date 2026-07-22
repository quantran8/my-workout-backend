// program/program.helpers.ts
// Ghép ProgramDraft (LLM, chưa id) -> Program (đủ id, type='static', rev=1) để validator kiểm.
// Backend gán MỌI id + set static/rev — LLM không sinh (program_generation.md §Output Schema).
//
// LLM nói bằng SLUG ("Barbell_Squat"), DB nói bằng uuid v7. assembleProgram giữ NGUYÊN slug
// trong Prescription.exerciseSlug để validator đối chiếu với pool, và dịch sang uuid
// (exerciseId) qua idBySlug. Slug lạ -> exerciseId = '' và validator bắt EXERCISE_NOT_IN_POOL.

import { randomUUID } from 'node:crypto';
import { Program, PlannedSession, Prescription } from './program.types';
import type { ProgramDraft } from '../llm/llm.types';
import type { Profile } from '../profile/profile.types';

export function assembleProgram(
  draft: ProgramDraft,
  opts: {
    userId: string;
    basedOnProfileVersion: number;
    programId?: string;
    revisionId?: string;
    /** slug -> uuid của allowedPool; thiếu map thì exerciseId để rỗng cho validator bắt. */
    idBySlug?: Map<string, string>;
  },
): Program {
  const programId = opts.programId ?? randomUUID();
  const revisionId = opts.revisionId ?? randomUUID();

  const sessions: PlannedSession[] = draft.sessions.map((s) => {
    const plannedSessionId = randomUUID();
    const prescriptions: Prescription[] = s.prescriptions.map((p) => ({
      prescriptionId: randomUUID(),
      // LLM trả slug; giữ lại để validator/thông báo lỗi đọc được, và dịch sang uuid.
      exerciseSlug: p.exerciseId,
      exerciseId: opts.idBySlug?.get(p.exerciseId) ?? '',
      order: p.order,
      targetSets: p.targetSets,
      targetReps: p.targetReps ?? null,
      targetWeightKg: p.targetWeightKg ?? null,
      targetDurationSec: p.targetDurationSec ?? null,
      targetDistanceM: p.targetDistanceM ?? null,
      targetRpe: p.targetRpe ?? null,
      restSec: p.restSec,
    }));
    return {
      plannedSessionId,
      weekNumber: s.weekNumber,
      dayNumber: s.dayNumber,
      focus: s.focus,
      prescriptions,
    };
  });

  return {
    programId,
    userId: opts.userId,
    basedOnProfileVersion: opts.basedOnProfileVersion,
    type: 'static',
    currentRevision: 1,
    goalSummary: draft.goalSummary,
    phasePlan: draft.phasePlan ?? null,
    status: 'active',
    revision: {
      revisionId,
      programId,
      revisionNumber: 1,
      createdAt: new Date().toISOString(),
      adjustmentReason: null, // null cho static v1
      sessions,
    },
  };
}

/** daysPerWeek từ profile (để validator kiểm số buổi/tuần). */
export function scheduleFromProfile(profile: Profile): {
  daysPerWeek?: number | null;
  minutesPerSession?: number | null;
} {
  const s = profile.constraint.schedule;
  return {
    daysPerWeek: s?.daysPerWeek ?? null,
    minutesPerSession: s?.minutesPerSession ?? null,
  };
}
