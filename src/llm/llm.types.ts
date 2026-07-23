import type { Profile } from '../profile/profile.types';
import type { GuardrailPolicy } from '../profile/guardrail';
import type { BlockPhase } from '../program/program.types';

/** Một chặng interval do LLM sinh (chưa chuẩn hóa order). */
export interface DraftBlock {
  order: number;
  phase: BlockPhase;
  durationSec?: number | null;
  distanceM?: number | null;
  targetRpeMin?: number | null;
  targetRpeMax?: number | null;
  targetPaceSecPerKm?: number | null;
  instruction: string;
}

/** Một prescription do LLM sinh (chưa có id). */
export interface DraftPrescription {
  exerciseId: string;
  order: number;
  targetSets: number;
  targetReps?: number | [number, number] | null;
  targetWeightKg?: number | null;
  targetDurationSec?: number | null;
  targetDistanceM?: number | null;
  targetPaceSecPerKm?: number | null;
  targetRpe?: number | null;
  restSec: number;
  /** null = bài đơn giản; mảng = interval/circuit (chỉ bài cardio). */
  blocks?: DraftBlock[] | null;
}

export interface DraftSession {
  weekNumber: number;
  dayNumber: number;
  focus: string;
  prescriptions: DraftPrescription[];
}

export interface DraftPhase {
  phase: string;
  weeks: [number, number];
  focus: string;
}

/** Output của LlmService.generateProgram (backend gán id + type='static' sau). */
export interface ProgramDraft {
  goalSummary: string;
  phasePlan: DraftPhase[];
  sessions: DraftSession[];
}

/** Slim exercise gửi LLM (không cues/media) — pool-retrieval.ts sinh. */
export interface SlimExercise {
  exercise_id: string;
  name: string;
  movement_pattern?: string | null;
  primary_muscles: string[];
  goal_fit: string[];
  equipment: string[];
  difficulty: number;
  exercise_type: string;
  default_prescription?: unknown;
}

/** Input cho generateProgram (~2K token, slim). */
export interface GenerateProgramInput {
  profile: Profile;
  allowedPool: SlimExercise[];
  policy: GuardrailPolicy;
  schedule: { daysPerWeek?: number | null; minutesPerSession?: number | null };
  previousViolations?: { code: string; detail: string; where?: string }[];
}
