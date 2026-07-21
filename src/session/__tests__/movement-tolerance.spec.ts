import { rollupMovementTolerance, PatternExposure } from '../movement-tolerance';
import { ToleranceVerdict } from '../tolerance';

const exp = (
  pattern: string,
  verdict: ToleranceVerdict,
  at: string,
): PatternExposure => ({
  movementPattern: pattern,
  sessionToleranceVerdict: verdict,
  stage: 'final_after_followup',
  at,
});

describe('rollupMovementTolerance', () => {
  it('<2 exposures -> insufficient_data', () => {
    const [r] = rollupMovementTolerance([exp('squat', 'tolerated', '2026-01-01')]);
    expect(r.verdict).toBe('insufficient_data');
  });

  it('bất kỳ not_tolerated -> not_tolerating', () => {
    const [r] = rollupMovementTolerance([
      exp('squat', 'tolerated', '2026-01-01'),
      exp('squat', 'not_tolerated', '2026-01-03'),
    ]);
    expect(r.verdict).toBe('not_tolerating');
  });

  it('>=2 consecutive tolerated gần nhất -> tolerating', () => {
    const [r] = rollupMovementTolerance([
      exp('squat', 'tolerated', '2026-01-01'),
      exp('squat', 'well_tolerated', '2026-01-03'),
    ]);
    expect(r.verdict).toBe('tolerating');
    expect(r.consecutiveTolerated).toBe(2);
  });

  it('đếm consecutive từ gần nhất, reset khi gặp borderline', () => {
    const [r] = rollupMovementTolerance([
      exp('squat', 'tolerated', '2026-01-01'),
      exp('squat', 'borderline', '2026-01-03'),
      exp('squat', 'tolerated', '2026-01-05'),
    ]);
    // gần nhất tolerated (1), trước đó borderline -> consecutive = 1
    expect(r.consecutiveTolerated).toBe(1);
    expect(r.verdict).toBe('borderline');
  });

  it('recompute idempotent: cùng input -> cùng output', () => {
    const rows: PatternExposure[] = [
      exp('squat', 'tolerated', '2026-01-01'),
      exp('hinge', 'not_tolerated', '2026-01-02'),
    ];
    expect(rollupMovementTolerance(rows)).toEqual(rollupMovementTolerance(rows));
  });

  it('nhóm nhiều pattern độc lập', () => {
    const out = rollupMovementTolerance([
      exp('squat', 'tolerated', '2026-01-01'),
      exp('squat', 'tolerated', '2026-01-03'),
      exp('hinge', 'not_tolerated', '2026-01-02'),
      exp('hinge', 'tolerated', '2026-01-04'),
    ]);
    const byPattern = new Map(out.map((r) => [r.movementPattern, r]));
    expect(byPattern.get('squat')!.verdict).toBe('tolerating');
    expect(byPattern.get('hinge')!.verdict).toBe('not_tolerating');
  });
});
