// program/program.types.ts
// Khớp data model §3. Static plan (free) = 1 revision đóng băng; living (paid) = nhiều revision.

export type ProgramType = 'static' | 'living';
export type ProgramStatus = 'active' | 'archived';

// Static plan chỉ cần prescription khởi điểm; progressionRule là CODE (living plan mới dùng).
export interface Prescription {
  prescriptionId: string;
  exerciseId: string;        // PHẢI ∈ allowedPool (validator kiểm)
  order: number;
  targetSets: number;
  targetReps?: number | [number, number] | null;   // resistance
  targetWeightKg?: number | null;
  targetDurationSec?: number | null;                // cardio/mobility
  targetDistanceM?: number | null;                  // cardio
  targetRpe?: number | null;
  restSec: number;
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
  status: ProgramStatus;
  revision: ProgramRevision; // revision hiện hành
}
