// program/program.types.ts
// Khớp data model §3. Static plan (free) = 1 revision đóng băng; living (paid) = nhiều revision.

import type { NutritionTarget } from './nutrition';
export type { NutritionTarget };

export type ProgramType = 'static' | 'living';
export type ProgramStatus = 'active' | 'archived';

// Giai đoạn của một chặng trong bài có cấu trúc — khớp enum WorkoutBlockPhase.
export type BlockPhase = 'warmup' | 'work' | 'recovery' | 'cooldown';

/**
 * Một chặng của bài cardio có cấu trúc (interval/circuit).
 * Ví dụ: khởi động 5' -> [chạy nhanh 3' -> hồi 2'] × 3 -> thả lỏng 10'.
 * Mỗi vòng lặp được LLM trải phẳng thành các block riêng (không có field "repeat"),
 * để client chỉ cần chạy tuần tự theo `order`.
 */
export interface PrescriptionBlock {
  order: number;
  phase: BlockPhase;
  durationSec?: number | null;
  distanceM?: number | null;
  targetRpeMin?: number | null;
  targetRpeMax?: number | null;
  targetPaceSecPerKm?: number | null;
  instruction: string; // câu hướng dẫn ngắn hiển thị trên màn chạy
}

// Static plan chỉ cần prescription khởi điểm; progressionRule là CODE (living plan mới dùng).
export interface Prescription {
  prescriptionId: string;
  exerciseId: string; // uuid v7 của Exercise — khoá ghi DB ('' nếu slug không map được)
  exerciseSlug: string; // slug LLM trả về; PHẢI ∈ allowedPool (validator kiểm)
  exerciseName: string; // tên hiển thị, ghép từ pool/DB — client render (không lưu ở Prescription)
  order: number;
  targetSets: number;
  targetReps?: number | [number, number] | null;   // resistance
  targetWeightKg?: number | null;
  targetDurationSec?: number | null;                // cardio/mobility
  targetDistanceM?: number | null;                  // cardio
  targetPaceSecPerKm?: number | null;               // cardio — đối chiếu actualPaceSecPerKm
  targetRpe?: number | null;
  restSec: number;
  /**
   * Rỗng/absent = bài đơn giản, đọc target* ở trên.
   * Có blocks = interval/circuit, client chạy theo từng chặng.
   * CHỈ hợp lệ với exerciseType === 'cardio' (validator kiểm).
   */
  blocks?: PrescriptionBlock[] | null;
}

export interface PlannedSession {
  plannedSessionId: string;
  weekNumber: number;
  dayNumber: number;
  focus: string;             // "Lower body — strength"
  prescriptions: Prescription[];
}

// Phân giai đoạn — hiện thực hóa policy.goalPhasePriority (vd 49kg: strength trước, endurance sau)
export interface Phase {
  phase: string;             // "strength_hypertrophy_phase1"
  weeks: [number, number];   // [tuần bắt đầu, tuần kết thúc]
  focus: string;
}

export interface ProgramRevision {
  revisionId: string;
  programId: string;
  revisionNumber: number;
  createdAt: string;
  adjustmentReason?: string | null;  // null cho static v1; living plan ghi lý do điều chỉnh
  sessions: PlannedSession[];
}

export interface Program {
  programId: string;
  userId: string;
  basedOnProfileVersion: number;
  type: ProgramType;
  currentRevision: number;   // static luôn = 1
  goalSummary: string;       // LLM diễn giải "chương trình này nhắm gì & vì sao"
  phasePlan?: Phase[] | null;
  // Mục tiêu calo/đạm do CODE tính (nutrition.ts), KHÔNG do LLM. null khi thiếu số liệu
  // cơ thể. Không lưu DB (dẫn xuất từ profile) — chỉ đính vào response cho client hiển thị.
  nutrition?: NutritionTarget | null;
  status: ProgramStatus;
  revision: ProgramRevision; // revision hiện hành
}
