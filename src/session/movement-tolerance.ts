// session/movement-tolerance.ts
// DETERMINISTIC. Không LLM. §8 — rollup tolerance theo movement_pattern (derived, recompute được).
// consecutiveTolerated là field adaptation-phase exit criteria đọc.

import { ToleranceVerdict, ToleranceStage } from './tolerance';

export type MovementToleranceVerdict =
  | 'tolerating'
  | 'borderline'
  | 'not_tolerating'
  | 'insufficient_data';

export interface PatternExposure {
  movementPattern: string;
  sessionToleranceVerdict: ToleranceVerdict;
  stage: ToleranceStage;
  at: string; // ISO — để sắp theo thời gian
}

export interface MovementToleranceRollup {
  movementPattern: string;
  exposures: number;
  toleratedCount: number;
  borderlineCount: number;
  notToleratedCount: number;
  consecutiveTolerated: number;
  verdict: MovementToleranceVerdict;
}

const MIN_EXPOSURES = 2;

function isTolerated(v: ToleranceVerdict): boolean {
  return v === 'tolerated' || v === 'well_tolerated';
}

export function rollupMovementTolerance(
  exposures: PatternExposure[],
): MovementToleranceRollup[] {
  const byPattern = new Map<string, PatternExposure[]>();
  for (const e of exposures) {
    const arr = byPattern.get(e.movementPattern) ?? [];
    arr.push(e);
    byPattern.set(e.movementPattern, arr);
  }

  const out: MovementToleranceRollup[] = [];
  for (const [movementPattern, list] of byPattern) {
    // sắp theo thời gian tăng dần để đếm consecutive từ gần nhất
    const sorted = [...list].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const toleratedCount = sorted.filter((e) => isTolerated(e.sessionToleranceVerdict)).length;
    const borderlineCount = sorted.filter((e) => e.sessionToleranceVerdict === 'borderline').length;
    const notToleratedCount = sorted.filter((e) => e.sessionToleranceVerdict === 'not_tolerated').length;

    // consecutive tolerated tính từ CUỐI (gần nhất) ngược lên
    let consecutiveTolerated = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (isTolerated(sorted[i].sessionToleranceVerdict)) consecutiveTolerated++;
      else break;
    }

    let verdict: MovementToleranceVerdict;
    const mostRecent = sorted[sorted.length - 1]?.sessionToleranceVerdict;
    if (sorted.length < MIN_EXPOSURES) {
      verdict = 'insufficient_data';
    } else if (notToleratedCount > 0 || mostRecent === 'not_tolerated') {
      verdict = 'not_tolerating';
    } else if (consecutiveTolerated >= 2 && notToleratedCount === 0) {
      verdict = 'tolerating';
    } else {
      verdict = 'borderline';
    }

    out.push({
      movementPattern,
      exposures: sorted.length,
      toleratedCount,
      borderlineCount,
      notToleratedCount,
      consecutiveTolerated,
      verdict,
    });
  }
  return out;
}
