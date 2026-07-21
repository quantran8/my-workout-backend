import { applyPainStop, PainStopEvent } from '../pain-stop';

// INVARIANT §12.3 — nhóm test an toàn quan trọng nhất.
describe('applyPainStop (INVARIANT §12.3)', () => {
  const base: PainStopEvent = {
    executionItemId: 'ei-1',
    bodyArea: 'knee',
    spreadsToRelatedPattern: false,
  };

  it('KHÔNG BAO GIỜ map pain_stop thành too_hard — mọi nhánh', () => {
    const cases: PainStopEvent[] = [
      { ...base, bodyArea: 'knee', spreadsToRelatedPattern: false },
      { ...base, bodyArea: null, spreadsToRelatedPattern: false },
      { ...base, bodyArea: 'shoulder', spreadsToRelatedPattern: true },
      { ...base, bodyArea: null, spreadsToRelatedPattern: true },
    ];
    for (const c of cases) {
      const out = applyPainStop(c);
      expect(out.mappedToleranceSignal).toBe('pain_stop');
      // guard cấu trúc: không có 'too_hard' ở bất kỳ đâu trong outcome
      expect(JSON.stringify(out)).not.toContain('too_hard');
    }
  });

  it('luôn stopped + triggeredFollowup=true', () => {
    const out = applyPainStop(base);
    expect(out.executionItemStatus).toBe('stopped');
    expect(out.triggeredFollowup).toBe(true);
  });

  it('lan sang pattern liên quan -> stop_related_pattern', () => {
    const out = applyPainStop({ ...base, spreadsToRelatedPattern: true });
    expect(out.actionTaken).toBe('stop_related_pattern');
  });

  it('chỉ khu trú body area -> stop_exercise', () => {
    const out = applyPainStop({ ...base, bodyArea: 'knee', spreadsToRelatedPattern: false });
    expect(out.actionTaken).toBe('stop_exercise');
  });

  it('không xác định vùng -> end_session (thận trọng nhất)', () => {
    const out = applyPainStop({ ...base, bodyArea: null, spreadsToRelatedPattern: false });
    expect(out.actionTaken).toBe('end_session');
  });
});
