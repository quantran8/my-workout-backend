import { assessSessionTolerance, SessionToleranceInput, DuringSessionSignal } from '../tolerance';

const during = (over: Partial<DuringSessionSignal> = {}): DuringSessionSignal => ({
  painStops: 0,
  tooHard: 0,
  uncomfortable: 0,
  tooEasy: 0,
  completedRatio: 1,
  ...over,
});

const input = (over: Partial<SessionToleranceInput> = {}): SessionToleranceInput => ({
  readiness: { verdict: 'ready' },
  during: during(),
  delayed: null,
  movementPatterns: ['squat'],
  ...over,
});

describe('assessSessionTolerance', () => {
  it('pain_stop -> not_tolerated (đè cả too_easy)', () => {
    const r = assessSessionTolerance(
      input({ during: during({ painStops: 1, tooEasy: 3, completedRatio: 1 }) }),
    );
    expect(r.verdict).toBe('not_tolerated');
  });

  it('readiness=hold -> not_tolerated', () => {
    const r = assessSessionTolerance(input({ readiness: { verdict: 'hold' } }));
    expect(r.verdict).toBe('not_tolerated');
  });

  it('tooHard>=2 -> borderline', () => {
    const r = assessSessionTolerance(input({ during: during({ tooHard: 2 }) }));
    expect(r.verdict).toBe('borderline');
  });

  it('completedRatio<0.5 -> borderline', () => {
    const r = assessSessionTolerance(input({ during: during({ completedRatio: 0.4 }) }));
    expect(r.verdict).toBe('borderline');
  });

  it('sạch + ratio>=0.9 + ready -> well_tolerated', () => {
    const r = assessSessionTolerance(input({ during: during({ completedRatio: 0.95 }) }));
    expect(r.verdict).toBe('well_tolerated');
  });

  it('stage đổi immediate <-> final_after_followup theo delayed', () => {
    expect(assessSessionTolerance(input()).stage).toBe('immediate');
    const withDelayed = assessSessionTolerance(
      input({ delayed: { worseNextDay: true, newPain: false, lingeringSoreness: false } }),
    );
    expect(withDelayed.stage).toBe('final_after_followup');
    expect(withDelayed.verdict).toBe('borderline'); // worseNextDay hạ verdict
  });

  it('delayed newPain -> not_tolerated ở final stage', () => {
    const r = assessSessionTolerance(
      input({ delayed: { worseNextDay: false, newPain: true, lingeringSoreness: false } }),
    );
    expect(r.verdict).toBe('not_tolerated');
  });

  it('pendingFollowup true khi immediate + có tín hiệu', () => {
    const r = assessSessionTolerance(input({ during: during({ tooHard: 1 }) }));
    expect(r.pendingFollowup).toBe(true);
  });
});
