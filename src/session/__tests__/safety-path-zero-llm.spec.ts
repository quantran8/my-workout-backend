// Zero-LLM safety path (§0.1.4 / §12.5.3): pain_stop -> tolerance -> rollup -> decision
// là 100% CODE. Test này chạy toàn chuỗi bằng các engine thuần và khẳng định:
//   (1) pain_stop không bao giờ thành too_hard,
//   (2) chuỗi dẫn tới neverIncreaseLoad=true,
//   (3) không file engine an toàn nào import LlmService (grep tĩnh).

import { readFileSync } from 'fs';
import { join } from 'path';
import { applyPainStop } from '../pain-stop';
import { assessSessionTolerance } from '../tolerance';
import { processFollowupReactions } from '../followup';
import { rollupMovementTolerance, PatternExposure } from '../movement-tolerance';
import { decideTrainingSafety } from '../training-decision';

describe('safety path — 100% deterministic, no LLM', () => {
  it('pain_stop -> not_tolerated -> not_tolerating -> neverIncreaseLoad', () => {
    // 1) pain_stop event
    const painOutcome = applyPainStop({
      executionItemId: 'ei-1',
      bodyArea: 'knee',
      spreadsToRelatedPattern: false,
    });
    expect(painOutcome.mappedToleranceSignal).toBe('pain_stop');
    expect(painOutcome.triggeredFollowup).toBe(true);

    // 2) immediate tolerance với 1 pain_stop -> not_tolerated
    const immediate = assessSessionTolerance({
      readiness: { verdict: 'ready' },
      during: { painStops: 1, tooHard: 0, uncomfortable: 0, tooEasy: 0, completedRatio: 0.3 },
      delayed: null,
      movementPatterns: ['squat'],
    });
    expect(immediate.verdict).toBe('not_tolerated');

    // 3) follow-up ngày sau: đau nặng hơn -> conservative
    const reaction = processFollowupReactions({
      feelWorse: true,
      newPainAppeared: true,
      sorenessLingering: false,
      recoveredWell: false,
    });
    expect(reaction.requiresConservativeAction).toBe(true);

    // 4) rollup 2 exposure not_tolerated -> not_tolerating
    const exposures: PatternExposure[] = [
      { movementPattern: 'squat', sessionToleranceVerdict: 'not_tolerated', stage: 'final_after_followup', at: '2026-01-01' },
      { movementPattern: 'squat', sessionToleranceVerdict: 'not_tolerated', stage: 'final_after_followup', at: '2026-01-03' },
    ];
    const [rollup] = rollupMovementTolerance(exposures);
    expect(rollup.verdict).toBe('not_tolerating');

    // 5) training decision -> safety override, không tăng tải
    const decision = decideTrainingSafety({
      movementRollups: [rollup],
      latestReadinessVerdict: 'ready',
      hasNewPainStop: true,
      followupRequiresConservative: reaction.requiresConservativeAction,
    });
    expect(decision.neverIncreaseLoad).toBe(true);
    expect(decision.safetyOverrideActive).toBe(true);
    for (const a of decision.actions) expect(a.code).not.toMatch(/increase/i);
  });

  it('không file engine an toàn nào import LlmService', () => {
    const safetyFiles = [
      'pain-stop.ts',
      'readiness.ts',
      'execution-snapshot.ts',
      'tolerance.ts',
      'followup.ts',
      'movement-tolerance.ts',
      'training-decision.ts',
    ];
    for (const f of safetyFiles) {
      const src = readFileSync(join(__dirname, '..', f), 'utf8');
      // không IMPORT LlmService / openai (header comment "Không LLM" là false-positive nên
      // chỉ soi dòng import / định danh dùng thực tế, không soi comment)
      const codeLines = src
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('//'))
        .join('\n');
      expect(codeLines).not.toMatch(/LlmService|from ['"].*llm/i);
      expect(codeLines).not.toMatch(/openai/i);
    }
  });
});
