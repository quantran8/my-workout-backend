// profile/profile.types.ts
// Types khớp với data model §1. Dùng chung giữa Prisma models, service, và API DTO.

export type Sex = 'male' | 'female' | 'other';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type InjuryArea =
  | 'shoulder' | 'knee' | 'lower_back' | 'hip' | 'elbow' | 'wrist'
  | 'ankle' | 'neck' | 'upper_back';
export type NeedType =
  | 'strength' | 'hypertrophy' | 'endurance' | 'power'
  | 'mobility' | 'weight_gain' | 'weight_loss';
export type Provenance = 'llm_extracted' | 'user_confirmed' | 'user_edited' | 'computed';
export type Confidence = 'high' | 'medium' | 'low';
// §1.2 — mức vận động GẦN ĐÂY, TÁCH khỏi experienceLevel (§12.1.3 cấm gộp)
export type RecentActivityLevel = 'very_low' | 'low' | 'moderate' | 'high';
export type InjuryStatus = 'active' | 'recovering' | 'historical';

export interface Injury {
  area: InjuryArea;
  severity?: 'mild' | 'moderate' | 'severe' | null;
  notes?: string;
  active: boolean;
  // §1.2 — trạng thái chi tiết hơn boolean active (active vẫn giữ để back-compat)
  status?: InjuryStatus;
  movementTriggers?: string[];
}

export interface Constraint {
  sex?: Sex | null;
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  bmi?: number | null; // computed — không do LLM điền
  experienceLevel?: ExperienceLevel | null;
  // §1.2 — TÁCH khỏi experienceLevel: kỹ thuật cao nhưng nghỉ lâu vẫn cần adaptation phase
  recentActivityLevel?: RecentActivityLevel | null;
  detrainingDurationWeeks?: number | null;
  lastConsistentTrainingAt?: string | null; // ISO date
  injuries: Injury[];
  mobilityLimits: string[];
  equipment: string[];
  space?: 'home' | 'gym' | 'outdoor' | 'minimal' | null;
  budgetWillingness?: 'none' | 'minimal' | 'invest' | null;
  schedule?: {
    daysPerWeek?: number | null;
    minutesPerSession?: number | null;
    preferredDays?: string[];
  };
  diet?: { type?: string | null; allergies?: string[]; restrictions?: string[] };
}

export interface InferredNeed {
  type: NeedType;
  targetArea?: string[];
  rationale?: string;
  confidence?: Confidence;
}

export interface Target {
  statedGoals: string[];
  problems: string[];
  inferredNeeds: InferredNeed[];
}

export interface Profile {
  constraint: Constraint;
  target: Target;
}

// ---- Action codes (union type thay cho magic strings) ----
export const Action = {
  MEDICAL_REFERRAL: 'MEDICAL_REFERRAL',
  NO_CALORIE_DEFICIT: 'NO_CALORIE_DEFICIT',
  NO_AGGRESSIVE_SURPLUS: 'NO_AGGRESSIVE_SURPLUS',
  CONSERVATIVE_START: 'CONSERVATIVE_START',
  BLOCK_EXERCISE_AREA: 'BLOCK_EXERCISE_AREA',
  VOLUME_CAP: 'VOLUME_CAP',
  REQUIRE_GUARDIAN: 'REQUIRE_GUARDIAN',
  RESOLVE_GOAL_CONFLICT: 'RESOLVE_GOAL_CONFLICT',
} as const;
export type ActionCode = (typeof Action)[keyof typeof Action];

export type Severity = 'low' | 'medium' | 'high';

export interface RedFlag {
  code: string;
  severity: Severity;
  actions: ActionCode[];
  payload: Record<string, unknown>;
  message?: string | null;
}
