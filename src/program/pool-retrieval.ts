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

// Ước lượng thời gian mỗi bài (phút) để suy số bài/buổi từ minutesPerSession.
const MINUTES_PER_EXERCISE = 8;
const DEFAULT_SLOTS_PER_SESSION = 5;
const MIN_SLOTS_PER_SESSION = 3;
const MAX_SLOTS_PER_SESSION = 8;

/**
 * exercisesPerSession: số bài MỖI BUỔI suy từ minutesPerSession (≈ phút/8), kẹp [3,8].
 * Đây là con số CODE quyết định và ép LLM tuân (validator EXERCISE_COUNT_MISMATCH),
 * KHÔNG để LLM tùy hứng. minutesPerSession thiếu -> DEFAULT_SLOTS_PER_SESSION.
 */
export function exercisesPerSession(minutesPerSession?: number | null): number {
  const minutes = minutesPerSession ?? 0;
  const raw = minutes
    ? Math.round(minutes / MINUTES_PER_EXERCISE)
    : DEFAULT_SLOTS_PER_SESSION;
  return Math.max(MIN_SLOTS_PER_SESSION, Math.min(MAX_SLOTS_PER_SESSION, raw));
}

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
    exercise_id: e.slug, // LLM chọn bài theo slug người đọc được, KHÔNG phải uuid
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
 * buildSlots: chọn tập bài (phủ pattern nền + goal ưu tiên) để GỬI cho LLM.
 *
 * QUAN TRỌNG: đây là kích thước POOL gửi LLM, KHÁC với số bài mỗi buổi
 * (exercisesPerSession). Pool phải RỘNG hơn số bài/buổi để chương trình nhiều tuần
 * có đủ đa dạng, không lặp đúng vài bài. Target = daysPerWeek × perSession (đủ để
 * mỗi buổi trong tuần có bài riêng), kẹp trong kích thước pool thật.
 *
 * Thuật toán v1 (deterministic):
 *  1. target = perSession × max(daysPerWeek,1), nhưng ≥ perSession và ≤ pool.length.
 *  2. Ưu tiên phủ mỗi BASE_PATTERN 1 bài (nếu pool có), match goal trước.
 *  3. Còn chỗ -> lấp thêm bài match goal (goal_fit ∩ targetGoals), rồi bài bất kỳ.
 *  4. KHÔNG BAO GIỜ trả bài ngoài allowedPool (validator vẫn gác lần cuối).
 *
 * @param allowedPool  pool đã qua guardrail (an toàn)
 * @param targetGoals  goal cần phủ (từ inferredNeeds / goalPhasePriority)
 * @param schedule     để suy cỡ pool
 */
export function buildSlots(
  allowedPool: Exercise[],
  targetGoals: string[],
  schedule: { daysPerWeek?: number | null; minutesPerSession?: number | null },
): Exercise[] {
  if (!allowedPool.length) return [];

  const perSession = exercisesPerSession(schedule.minutesPerSession);
  const days = Math.max(schedule.daysPerWeek ?? 1, 1);
  // Pool rộng: đủ bài để mỗi buổi/tuần khác nhau, nhưng không vượt pool thật.
  const slots = Math.min(
    allowedPool.length,
    Math.max(perSession, perSession * days),
  );

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
