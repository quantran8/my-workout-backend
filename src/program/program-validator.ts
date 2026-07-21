// program/program-validator.ts
// DETERMINISTIC. Không LLM. Đây là lớp "trust but verify":
// LLM sinh chương trình -> validator kiểm nó có TUÂN pool + policy không.
// Nếu vi phạm -> trả violations để re-prompt LLM (hoặc reject). LLM KHÔNG được tự do.

import { Program } from './program.types';
import { GuardrailResult } from '../profile/guardrail';
import { Exercise } from '../profile/guardrail';

export interface Violation {
  code:
    | 'EXERCISE_NOT_IN_POOL'      // LLM chọn bài ngoài pool (hallucinate/blocked)
    | 'VOLUME_CAP_EXCEEDED'       // vượt trần set/tuần/nhóm cơ
    | 'CARDIO_NOT_MINIMAL'        // goal-conflict yêu cầu cardio tối thiểu mà LLM kê nhiều
    | 'SESSION_COUNT_MISMATCH'    // số buổi khác lịch user
    | 'PHASE_PLAN_MISSING'        // phải phân giai đoạn mà không có
    | 'EMPTY_SESSION';
  detail: string;
  where?: string;
}

export interface ValidationResult {
  ok: boolean;
  violations: Violation[];
}

const CARDIO_MINIMAL_MAX_SESSIONS = 2; // khi phải giải goal-conflict: cardio ≤ 2 buổi/tuần

export function validateProgram(
  program: Program,
  guard: GuardrailResult,
  opts?: { expectedDaysPerWeek?: number | null },
): ValidationResult {
  const violations: Violation[] = [];
  const poolById = new Map<string, Exercise>(guard.allowedPool.map((e) => [e.exerciseId, e]));
  const sessions = program.revision.sessions;

  // 1) Mọi bài PHẢI ∈ pool
  for (const s of sessions) {
    if (!s.prescriptions.length) {
      violations.push({ code: 'EMPTY_SESSION', detail: 'buổi không có bài nào', where: s.plannedSessionId });
    }
    for (const p of s.prescriptions) {
      if (!poolById.has(p.exerciseId)) {
        violations.push({
          code: 'EXERCISE_NOT_IN_POOL',
          detail: `bài "${p.exerciseId}" không nằm trong allowedPool (bị guardrail loại hoặc LLM bịa)`,
          where: `${s.plannedSessionId}#${p.order}`,
        });
      }
    }
  }

  // 2) Trần volume/tuần/nhóm cơ (policy.maxWeeklySetsPerMuscle)
  const cap = guard.policy.maxWeeklySetsPerMuscle;
  if (cap != null) {
    // gom set theo (week, muscle) dựa primary_muscles của bài trong pool
    const setsByWeekMuscle = new Map<string, number>();
    for (const s of sessions) {
      for (const p of s.prescriptions) {
        const ex = poolById.get(p.exerciseId);
        const muscles = (ex?.['primaryMuscles'] as string[] | undefined) ?? [];
        for (const m of muscles) {
          const key = `${s.weekNumber}:${m}`;
          setsByWeekMuscle.set(key, (setsByWeekMuscle.get(key) ?? 0) + p.targetSets);
        }
      }
    }
    for (const [key, total] of setsByWeekMuscle) {
      if (total > cap) {
        const [week, muscle] = key.split(':');
        violations.push({
          code: 'VOLUME_CAP_EXCEEDED',
          detail: `tuần ${week}, nhóm ${muscle}: ${total} set > trần ${cap}`,
          where: key,
        });
      }
    }
  }

  // 3) Goal-conflict -> cardio phải tối thiểu + phải có phasePlan
  if (guard.policy.mustResolveGoalConflict) {
    if (!program.phasePlan || !program.phasePlan.length) {
      violations.push({ code: 'PHASE_PLAN_MISSING', detail: 'goal-conflict cần phân giai đoạn nhưng phasePlan trống' });
    }
    // đếm buổi có bài cardio theo tuần
    const cardioByWeek = new Map<number, number>();
    for (const s of sessions) {
      const hasCardio = s.prescriptions.some(
        (p) => poolById.get(p.exerciseId)?.exerciseType === 'cardio',
      );
      if (hasCardio) cardioByWeek.set(s.weekNumber, (cardioByWeek.get(s.weekNumber) ?? 0) + 1);
    }
    for (const [week, n] of cardioByWeek) {
      if (n > CARDIO_MINIMAL_MAX_SESSIONS) {
        violations.push({
          code: 'CARDIO_NOT_MINIMAL',
          detail: `tuần ${week}: ${n} buổi cardio > tối đa ${CARDIO_MINIMAL_MAX_SESSIONS} (đang ưu tiên tăng cân/cơ)`,
          where: `week ${week}`,
        });
      }
    }
  }

  // 4) Số buổi/tuần khớp lịch user
  const want = opts?.expectedDaysPerWeek;
  if (want != null) {
    const byWeek = new Map<number, number>();
    for (const s of sessions) byWeek.set(s.weekNumber, (byWeek.get(s.weekNumber) ?? 0) + 1);
    for (const [week, n] of byWeek) {
      if (n !== want) {
        violations.push({
          code: 'SESSION_COUNT_MISMATCH',
          detail: `tuần ${week}: ${n} buổi, lịch user là ${want} buổi/tuần`,
          where: `week ${week}`,
        });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}
