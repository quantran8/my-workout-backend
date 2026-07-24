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
    /** slug -> tên hiển thị của allowedPool; để client render mà không cần fetch pool. */
    nameBySlug?: Map<string, string>;
    /** ngày bắt đầu chương trình (CODE gán, không phải LLM). 'YYYY-MM-DD'. */
    startDate: string;
    /** ISO weekday 1..7 tập trong tuần (CODE derive từ profile). vd [1,3,5]. */
    trainingDays: number[];
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
      exerciseName: opts.nameBySlug?.get(p.exerciseId) ?? p.exerciseId,
      order: p.order,
      targetSets: p.targetSets,
      targetReps: p.targetReps ?? null,
      targetWeightKg: p.targetWeightKg ?? null,
      targetDurationSec: p.targetDurationSec ?? null,
      targetDistanceM: p.targetDistanceM ?? null,
      targetPaceSecPerKm: p.targetPaceSecPerKm ?? null,
      targetRpe: p.targetRpe ?? null,
      restSec: p.restSec,
      // Bài đơn giản -> null. Có blocks -> chuẩn hóa order về 1..n theo thứ tự
      // LLM trả, để validator và client không phụ thuộc vào việc LLM đánh số đúng.
      blocks: p.blocks?.length
        ? p.blocks.map((b, index) => ({
            order: index + 1,
            phase: b.phase,
            durationSec: b.durationSec ?? null,
            distanceM: b.distanceM ?? null,
            targetRpeMin: b.targetRpeMin ?? null,
            targetRpeMax: b.targetRpeMax ?? null,
            targetPaceSecPerKm: b.targetPaceSecPerKm ?? null,
            instruction: b.instruction,
          }))
        : null,
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
    durationWeeks: draft.durationWeeks,
    startDate: opts.startDate,
    trainingDays: opts.trainingDays,
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

// ISO weekday mặc định khi user KHÔNG nêu ngày cụ thể: rải đều Mon..Sun theo daysPerWeek.
// Mon=1..Sun=7. Với n buổi ta lấy n phần tử đầu — phủ nửa đầu tuần trước, đủ giãn cách.
const DEFAULT_WEEKDAY_ORDER = [1, 3, 5, 2, 4, 6, 7]; // T2,T4,T6 rồi lấp — tránh dồn 2 ngày liền

// Bảng chuẩn hoá tên thứ (LLM/onboarding có thể trả nhiều dạng) -> ISO weekday.
const WEEKDAY_ALIASES: Record<string, number> = {
  mon: 1, monday: 1, t2: 1, 'thu 2': 1, 'thứ 2': 1,
  tue: 2, tues: 2, tuesday: 2, t3: 2, 'thứ 3': 2,
  wed: 3, weds: 3, wednesday: 3, t4: 3, 'thứ 4': 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, t5: 4, 'thứ 5': 4,
  fri: 5, friday: 5, t6: 5, 'thứ 6': 5,
  sat: 6, saturday: 6, t7: 6, 'thứ 7': 6,
  sun: 7, sunday: 7, cn: 7, 'chủ nhật': 7,
};

/**
 * trainingDaysFromProfile: ISO weekday (1..7, Mon=1) chương trình tập trong tuần.
 * Ưu tiên preferredDays user nêu (chuẩn hoá qua alias); nếu thiếu/không đủ, lấp bằng
 * DEFAULT_WEEKDAY_ORDER cho tới khi đủ daysPerWeek. Luôn sắp tăng dần và unique —
 * index (1-based) của mảng này = PlannedSession.dayNumber tương ứng.
 */
export function trainingDaysFromProfile(profile: Profile): number[] {
  const s = profile.constraint.schedule;
  const want = s?.daysPerWeek ?? 0;
  const picked = new Set<number>();

  for (const raw of s?.preferredDays ?? []) {
    const iso = WEEKDAY_ALIASES[String(raw).trim().toLowerCase()];
    if (iso && picked.size < want) picked.add(iso);
  }
  for (const iso of DEFAULT_WEEKDAY_ORDER) {
    if (picked.size >= want) break;
    picked.add(iso);
  }
  return [...picked].sort((a, b) => a - b);
}
