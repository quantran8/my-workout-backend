// session/tolerance.ts
// DETERMINISTIC. Không LLM. §6 — đánh giá tolerance của MỘT session.
// pain_stop / readiness=hold / newPain -> not_tolerated (đè mọi tín hiệu khác).
// Hai stage: 'immediate' (chưa follow-up) và 'final_after_followup' (đã có phản ứng ngày sau).

export type ToleranceVerdict =
  | 'well_tolerated'
  | 'tolerated'
  | 'borderline'
  | 'not_tolerated'
  | 'unknown';
export type ToleranceStage = 'immediate' | 'final_after_followup';
export type ReadinessVerdict = 'ready' | 'modify' | 'hold' | 'unknown';

export interface ReadinessSignal {
  verdict: ReadinessVerdict;
}

export interface DuringSessionSignal {
  painStops: number;
  tooHard: number;
  uncomfortable: number;
  tooEasy: number;
  completedRatio: number; // so với effectiveRx
}

export interface DelayedSignal {
  worseNextDay: boolean;
  newPain: boolean;
  lingeringSoreness: boolean;
}

export interface SessionToleranceInput {
  readiness: ReadinessSignal;
  during: DuringSessionSignal;
  delayed: DelayedSignal | null; // null cho tới khi follow-up hoàn tất
  movementPatterns: string[];
}

export interface SessionToleranceResult {
  stage: ToleranceStage;
  verdict: ToleranceVerdict;
  perPattern: { movementPattern: string; verdict: ToleranceVerdict }[];
  pendingFollowup: boolean;
  ruleVersion: string;
}

const RULE_VERSION = 'tolerance/v4.0';

function verdictFor(input: SessionToleranceInput): ToleranceVerdict {
  const { readiness, during, delayed } = input;

  // (1) not_tolerated — đè tất cả
  if (
    during.painStops > 0 ||
    readiness.verdict === 'hold' ||
    delayed?.newPain
  ) {
    return 'not_tolerated';
  }
  // (2)+(3) borderline
  if (
    during.tooHard >= 2 ||
    during.completedRatio < 0.5 ||
    delayed?.worseNextDay ||
    during.uncomfortable >= 1 ||
    delayed?.lingeringSoreness
  ) {
    return 'borderline';
  }
  // (4) well_tolerated
  if (
    during.painStops === 0 &&
    during.tooHard === 0 &&
    during.uncomfortable === 0 &&
    during.completedRatio >= 0.9 &&
    readiness.verdict === 'ready'
  ) {
    return 'well_tolerated';
  }
  // (6) unknown — thiếu thông tin, thận trọng
  if (
    readiness.verdict === 'unknown' &&
    during.painStops === 0 &&
    during.tooHard === 0 &&
    during.uncomfortable === 0 &&
    !delayed
  ) {
    return 'unknown';
  }
  // (5) tolerated
  return 'tolerated';
}

export function assessSessionTolerance(
  input: SessionToleranceInput,
): SessionToleranceResult {
  const stage: ToleranceStage = input.delayed ? 'final_after_followup' : 'immediate';
  const verdict = verdictFor(input);

  // v1: verdict per-pattern = verdict phiên (chưa tách tín hiệu theo pattern ở immediate)
  const perPattern = input.movementPatterns.map((movementPattern) => ({
    movementPattern,
    verdict,
  }));

  const pendingFollowup =
    stage === 'immediate' &&
    (input.during.painStops > 0 ||
      input.during.tooHard > 0 ||
      input.during.uncomfortable > 0 ||
      input.readiness.verdict === 'modify' ||
      input.readiness.verdict === 'hold');

  return { stage, verdict, perPattern, pendingFollowup, ruleVersion: RULE_VERSION };
}
