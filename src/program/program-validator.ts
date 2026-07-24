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
    | 'EMPTY_SESSION'
    | 'BLOCKS_ON_NON_CARDIO'      // interval block gắn vào bài không phải cardio
    | 'BLOCK_ORDER_INVALID'       // order không liên tục từ 1
    | 'BLOCK_NO_DIMENSION'        // block không có cả durationSec lẫn distanceM
    | 'DURATION_OUT_OF_RANGE'     // durationWeeks ngoài [MIN,MAX]
    | 'WEEK_COVERAGE_MISMATCH';   // sessions không phủ đúng 1..durationWeeks
  detail: string;
  where?: string;
}

// Chương trình static phải dài ít nhất MIN và không quá MAX tuần. LLM chọn trong khoảng này;
// ngoài khoảng -> re-prompt (không tự sửa, theo PROGRAM-2).
export const MIN_PROGRAM_WEEKS = 2;
export const MAX_PROGRAM_WEEKS = 24;

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
  // Key theo SLUG: đó là thứ LLM trả về, và uuid chỉ được gán sau khi map thành công.
  const poolBySlug = new Map<string, Exercise>(guard.allowedPool.map((e) => [e.slug, e]));
  const sessions = program.revision.sessions;

  // 0) Độ dài chương trình trong khoảng cho phép, và sessions phủ ĐÚNG mọi tuần 1..durationWeeks.
  //    Thiếu tuần -> user có ngày không có bài; thừa tuần -> lịch dương lệch với thực tế.
  const weeks = program.durationWeeks;
  if (weeks < MIN_PROGRAM_WEEKS || weeks > MAX_PROGRAM_WEEKS) {
    violations.push({
      code: 'DURATION_OUT_OF_RANGE',
      detail: `durationWeeks=${weeks} ngoài khoảng [${MIN_PROGRAM_WEEKS}, ${MAX_PROGRAM_WEEKS}]`,
    });
  } else {
    const present = new Set(sessions.map((s) => s.weekNumber));
    const missing: number[] = [];
    for (let w = 1; w <= weeks; w++) if (!present.has(w)) missing.push(w);
    const extra = [...present].filter((w) => w < 1 || w > weeks);
    if (missing.length || extra.length) {
      violations.push({
        code: 'WEEK_COVERAGE_MISMATCH',
        detail: `sessions phải phủ tuần 1..${weeks}. Thiếu [${missing.join(', ')}], thừa [${extra.join(', ')}]`,
      });
    }
  }

  // 1) Mọi bài PHẢI ∈ pool
  for (const s of sessions) {
    if (!s.prescriptions.length) {
      violations.push({ code: 'EMPTY_SESSION', detail: 'buổi không có bài nào', where: s.plannedSessionId });
    }
    for (const p of s.prescriptions) {
      if (!poolBySlug.has(p.exerciseSlug)) {
        violations.push({
          code: 'EXERCISE_NOT_IN_POOL',
          detail: `bài "${p.exerciseSlug}" không nằm trong allowedPool (bị guardrail loại hoặc LLM bịa)`,
          where: `${s.plannedSessionId}#${p.order}`,
        });
      }
    }
  }

  // 1b) Interval blocks: chỉ cho cardio, order liên tục, mỗi chặng phải đo được
  for (const s of sessions) {
    for (const p of s.prescriptions) {
      const blocks = p.blocks;
      if (!blocks || blocks.length === 0) continue;

      const where = `${s.plannedSessionId}#${p.order}`;
      const ex = poolBySlug.get(p.exerciseSlug);
      // Bài ngoài pool đã bị bắt ở (1); ở đây chỉ chặn khi biết chắc KHÔNG phải cardio.
      if (ex && ex.exerciseType !== 'cardio') {
        violations.push({
          code: 'BLOCKS_ON_NON_CARDIO',
          detail: `bài "${p.exerciseSlug}" là ${ex.exerciseType} nhưng có interval blocks`,
          where,
        });
      }

      // Client chạy tuần tự theo order -> phải là 1..n, không trùng, không hụt.
      const orders = blocks.map((b) => b.order).sort((a, b) => a - b);
      const contiguous = orders.every((o, i) => o === i + 1);
      if (!contiguous) {
        violations.push({
          code: 'BLOCK_ORDER_INVALID',
          detail: `order các chặng phải liên tục 1..${blocks.length}, nhận [${orders.join(', ')}]`,
          where,
        });
      }

      for (const b of blocks) {
        // Không có thời lượng lẫn quãng đường thì client không biết khi nào chặng kết thúc.
        if ((b.durationSec ?? 0) <= 0 && (b.distanceM ?? 0) <= 0) {
          violations.push({
            code: 'BLOCK_NO_DIMENSION',
            detail: `chặng ${b.order} (${b.phase}) không có durationSec lẫn distanceM`,
            where,
          });
        }
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
        const ex = poolBySlug.get(p.exerciseSlug);
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
        (p) => poolBySlug.get(p.exerciseSlug)?.exerciseType === 'cardio',
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
