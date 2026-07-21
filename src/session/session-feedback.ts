// session/session-feedback.ts
// DETERMINISTIC. Không LLM. Phản hồi ngay sau buổi (free, ~$0).
// So buổi này với LẦN GẦN NHẤT cùng bài -> câu ngắn dễ hiểu.
// Hướng đã chuẩn hóa: 'better' = tiến bộ, bất kể metric tăng hay giảm.

import { WorkoutSession, LoggedSet } from './session.types';

type ExType = 'resistance' | 'cardio' | 'mobility';

export interface ExerciseFeedback {
  exerciseId: string;
  status: 'better' | 'same' | 'lower' | 'baseline';
  metric: string;         // "tạ nặng nhất" | "pace" | ...
  detail: string;         // câu hiển thị
}

export interface SessionFeedback {
  completionPct: number;
  perExercise: ExerciseFeedback[];
  summary: string;        // 1 câu tổng, template thuần
}

// ---- helpers ----
function bestResistance(sets: LoggedSet[]): number {
  // proxy đơn giản: max (weight * reps) trong các set — đủ cho phản hồi tức thời
  return Math.max(0, ...sets.map((s) => (s.actualWeightKg ?? 0) * (s.actualReps ?? 0)));
}
function totalDistance(sets: LoggedSet[]): number {
  return sets.reduce((a, s) => a + (s.actualDistanceM ?? 0), 0);
}
function bestPace(sets: LoggedSet[]): number | null {
  const paces = sets.map((s) => s.actualPaceSecPerKm).filter((p): p is number => p != null);
  return paces.length ? Math.min(...paces) : null; // pace thấp = nhanh
}
function totalHold(sets: LoggedSet[]): number {
  return sets.reduce((a, s) => a + (s.actualDurationSec ?? 0), 0);
}

/**
 * @param current   buổi vừa xong
 * @param exTypeOf  map exerciseId -> exercise_type (từ movement library)
 * @param priorByExercise  với mỗi exerciseId: các set của LẦN GẦN NHẤT trước đó (rỗng nếu chưa có)
 * @param prescribedSetCount tổng số set đã kê của buổi (để tính completion)
 */
export function computeSessionFeedback(
  current: WorkoutSession,
  exTypeOf: (id: string) => ExType,
  priorByExercise: Map<string, LoggedSet[]>,
  prescribedSetCount: number,
): SessionFeedback {
  const completionPct = prescribedSetCount > 0
    ? Math.round((current.sets.length / prescribedSetCount) * 100)
    : 100;

  // gom set buổi này theo exercise
  const nowByEx = new Map<string, LoggedSet[]>();
  for (const s of current.sets) {
    (nowByEx.get(s.exerciseId) ?? nowByEx.set(s.exerciseId, []).get(s.exerciseId)!).push(s);
  }

  const perExercise: ExerciseFeedback[] = [];
  for (const [exId, nowSets] of nowByEx) {
    const prior = priorByExercise.get(exId) ?? [];
    const type = exTypeOf(exId);

    if (!prior.length) {
      perExercise.push({ exerciseId: exId, status: 'baseline', metric: '-',
        detail: 'Lần đầu ghi nhận bài này — đã lưu làm mốc so sánh.' });
      continue;
    }

    if (type === 'resistance') {
      const now = bestResistance(nowSets), was = bestResistance(prior);
      const status = now > was ? 'better' : now < was ? 'lower' : 'same';
      perExercise.push({ exerciseId: exId, status, metric: 'khối lượng set tốt nhất',
        detail: status === 'better' ? `Nặng/nhiều hơn lần trước (${was}→${now}).`
              : status === 'same'   ? 'Bằng lần trước — giữ phong độ.'
              : `Thấp hơn lần trước (${was}→${now}).` });
    } else if (type === 'cardio') {
      // ưu tiên pace; không có pace thì dùng distance
      const nowP = bestPace(nowSets), wasP = bestPace(prior);
      if (nowP != null && wasP != null) {
        const status = nowP < wasP ? 'better' : nowP > wasP ? 'lower' : 'same';
        perExercise.push({ exerciseId: exId, status, metric: 'pace',
          detail: status === 'better' ? `Nhanh hơn lần trước (pace ${wasP}s→${nowP}s/km).`
                : status === 'same'   ? 'Pace bằng lần trước.'
                : `Chậm hơn lần trước (pace ${wasP}s→${nowP}s/km).` });
      } else {
        const now = totalDistance(nowSets), was = totalDistance(prior);
        const status = now > was ? 'better' : now < was ? 'lower' : 'same';
        perExercise.push({ exerciseId: exId, status, metric: 'quãng đường',
          detail: status === 'better' ? `Xa hơn lần trước (${was}→${now}m).`
                : status === 'same'   ? 'Bằng lần trước.' : `Ngắn hơn lần trước (${was}→${now}m).` });
      }
    } else { // mobility
      const now = totalHold(nowSets), was = totalHold(prior);
      const status = now > was ? 'better' : now < was ? 'lower' : 'same';
      perExercise.push({ exerciseId: exId, status, metric: 'thời gian giữ',
        detail: status === 'better' ? `Giữ lâu hơn lần trước (${was}→${now}s).`
              : status === 'same'   ? 'Bằng lần trước.' : `Ngắn hơn lần trước (${was}→${now}s).` });
    }
  }

  const improved = perExercise.filter((e) => e.status === 'better').length;
  const measured = perExercise.filter((e) => e.status !== 'baseline').length;
  const summary =
    measured === 0 ? 'Buổi đầu tiên đã được ghi nhận — từ buổi sau sẽ có so sánh tiến bộ.'
    : improved > 0 ? `Hoàn thành ${completionPct}% chương trình. Tiến bộ ở ${improved}/${measured} bài so với lần trước.`
    : `Hoàn thành ${completionPct}% chương trình. Giữ phong độ so với lần trước.`;

  return { completionPct, perExercise, summary };
}
