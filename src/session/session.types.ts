// session/session.types.ts
// Khớp data model §4 + §5B. Nguồn sự thật của moat.
// Log AGAINST prescription; field áp dụng tùy exercise_type; wearable nullable & cách ly.

export type Environment = 'outdoor' | 'indoor' | 'unknown';
export type DataSource = 'manual' | 'healthkit_phone' | 'wearable';
export type DistanceSource =
  | 'gps' | 'smart_trainer' | 'bike_sensor' | 'machine_manual' | 'none';
export type FeedbackFlag = 'too_easy' | 'too_hard' | 'uncomfortable' | 'ok';
export type FieldSource = 'auto' | 'manual';

// Giá trị + nguồn của nó (cho phép confidence thấp hơn khi manual — §5B)
export interface Sourced<T> {
  value: T;
  source: FieldSource;
}

export interface WearableData {
  avgHr?: number | null;
  maxHr?: number | null;
  activeCalories?: number | null;
  hrv?: number | null;
  vo2max?: number | null;
  source: string; // 'apple_watch' | ...
}

export interface LoggedSet {
  setId: string;
  sessionId: string;
  prescriptionId?: string | null;  // ← link về bài đã kê (planned vs actual). null = tập tự do
  exerciseId: string;              // denormalized để query nhanh theo bài
  setNumber: number;

  // resistance
  actualReps?: number | null;
  actualWeightKg?: number | null;
  // cardio
  actualDurationSec?: number | null;
  actualDistanceM?: number | null;
  actualPaceSecPerKm?: number | null;
  stroke?: 'freestyle' | 'breast' | 'back' | 'fly' | 'mixed' | null;
  // mobility
  actualRom?: string | null;

  actualRpe?: number | null;
  feedbackFlag?: FeedbackFlag | null;

  // nguồn per-field (§5B: manual != auto về độ tin)
  fieldSources?: Partial<Record<
    'reps' | 'weight' | 'duration' | 'distance' | 'pace', FieldSource
  >>;
}

export interface WorkoutSession {
  sessionId: string;
  userId: string;
  plannedSessionId?: string | null;
  programRevisionId: string;

  environment: Environment;        // ⚠ thu từ đầu (§5B)
  distanceSource: DistanceSource;  // riêng biệt với wearable
  dataSource: DataSource;          // mức tự-động-hóa — KHÔNG vào công thức verdict

  startedAt: string;
  endedAt?: string | null;
  completionPct?: number | null;   // computed
  sessionRpe?: number | null;
  energyAfter?: 'low' | 'ok' | 'high' | null;
  notes?: string | null;

  wearable?: WearableData | null;  // nullable, cách ly

  sets: LoggedSet[];
}
