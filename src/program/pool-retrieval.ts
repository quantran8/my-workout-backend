// program/pool-retrieval.ts
// DETERMINISTIC. Không LLM, không I/O. Pure — dễ test (như session-feedback.ts).
//
// Hai việc:
//  - slimPool(): chiếu mỗi exercise xuống ĐÚNG các field LLM cần, đổi camelCase -> snake_case
//    để khớp input example trong program_generation.md. BỎ cues/media/source/aliases/secondary.
//  - buildSlots(): CHỌN từ allowedPool (đã qua guardrail) để phủ pattern/goal cho lịch. Input
//    đã lọc an toàn rồi -> đây là CHỌN, không phải an toàn. Thuật toán v1 đơn giản, ghi rõ dưới.

import { Exercise } from '../profile/guardrail';
import { SlimExercise } from '../llm/llm.types';

// Base patterns ưu tiên phủ (squat/hinge/push/pull/lunge...) — thứ tự = độ ưu tiên.
const BASE_PATTERNS = [
  'squat',
  'hinge',
  'push_h',
  'push_v',
  'pull_h',
  'pull_v',
  'lunge',
  'core',
  'carry',
];

// Ước lượng thời gian mỗi bài (phút) để suy số slot/buổi từ minutesPerSession.
const MINUTES_PER_EXERCISE = 8;
const DEFAULT_SLOTS_PER_SESSION = 5;
const MIN_SLOTS_PER_SESSION = 3;
const MAX_SLOTS_PER_SESSION = 8;

function ex<K extends keyof Exercise>(e: Exercise, k: K): Exercise[K] {
  return e[k];
}
function asStrArr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

/**
 * slimPool: chiếu xuống 9 field LLM cần, đổi sang snake_case. defaultRx (camel trong DB)
 * -> default_prescription; nội dung blob giữ nguyên (rep_range/rest_sec... LLM tự đọc).
 */
export function slimPool(exercises: Exercise[]): SlimExercise[] {
  return exercises.map((e) => ({
    exercise_id: e.exerciseId,
    name: e.name,
    movement_pattern: (ex(e, 'movementPattern') as string | undefined) ?? null,
    primary_muscles: asStrArr(ex(e, 'primaryMuscles')),
    goal_fit: asStrArr(ex(e, 'goalFit')),
    equipment: e.equipment ?? [],
    difficulty: e.difficulty,
    exercise_type: e.exerciseType,
    default_prescription: ex(e, 'defaultRx'),
  }));
}

/**
 * buildSlots: chọn tập bài phủ pattern nền + goal ưu tiên, giới hạn theo slot/buổi.
 *
 * Thuật toán v1 (deterministic, ghi rõ để đổi sau khi có spec):
 *  1. slotsPerSession ≈ minutesPerSession/8, kẹp [3,8], mặc định 5.
 *  2. Ưu tiên phủ mỗi BASE_PATTERN 1 bài (nếu pool có), match goal trước.
 *  3. Còn slot -> lấp thêm bài match goal (goal_fit ∩ targetGoals), rồi bài bất kỳ trong pool.
 *  4. KHÔNG BAO GIỜ trả bài ngoài allowedPool (validator vẫn gác lần cuối).
 *
 * @param allowedPool  pool đã qua guardrail (an toàn)
 * @param targetGoals  goal cần phủ (từ inferredNeeds / goalPhasePriority)
 * @param schedule     để suy số slot
 */
export function buildSlots(
  allowedPool: Exercise[],
  targetGoals: string[],
  schedule: { daysPerWeek?: number | null; minutesPerSession?: number | null },
): Exercise[] {
  if (!allowedPool.length) return [];

  const minutes = schedule.minutesPerSession ?? 0;
  let slots = minutes
    ? Math.round(minutes / MINUTES_PER_EXERCISE)
    : DEFAULT_SLOTS_PER_SESSION;
  slots = Math.max(MIN_SLOTS_PER_SESSION, Math.min(MAX_SLOTS_PER_SESSION, slots));

  const goals = new Set(targetGoals);
  const matchesGoal = (e: Exercise) =>
    asStrArr(ex(e, 'goalFit')).some((g) => goals.has(g));

  const picked: Exercise[] = [];
  const pickedIds = new Set<string>();
  const take = (e: Exercise) => {
    if (!pickedIds.has(e.exerciseId)) {
      picked.push(e);
      pickedIds.add(e.exerciseId);
    }
  };

  // (2) phủ base patterns — goal-match trước, rồi bất kỳ trong pattern
  const byPattern = new Map<string, Exercise[]>();
  for (const e of allowedPool) {
    const p = (ex(e, 'movementPattern') as string | undefined) ?? '';
    if (!byPattern.has(p)) byPattern.set(p, []);
    byPattern.get(p)!.push(e);
  }
  for (const pattern of BASE_PATTERNS) {
    if (picked.length >= slots) break;
    const inPattern = byPattern.get(pattern) ?? [];
    const goalFirst = [
      ...inPattern.filter(matchesGoal),
      ...inPattern.filter((e) => !matchesGoal(e)),
    ];
    if (goalFirst.length) take(goalFirst[0]);
  }

  // (3a) lấp thêm bài match goal
  if (picked.length < slots) {
    for (const e of allowedPool.filter(matchesGoal)) {
      if (picked.length >= slots) break;
      take(e);
    }
  }
  // (3b) lấp bất kỳ để đủ slot (nhưng không vượt pool)
  if (picked.length < slots) {
    for (const e of allowedPool) {
      if (picked.length >= slots) break;
      take(e);
    }
  }

  return picked;
}
