import { assessReadiness, ReadinessResponses, PlannedItem, ReadinessMod } from '../readiness';

const planned: PlannedItem[] = [
  { prescriptionId: 'p1', exerciseId: 'goblet_squat', movementPattern: 'squat', bodyAreas: ['knee', 'hip'] },
  { prescriptionId: 'p2', exerciseId: 'ohp', movementPattern: 'push_v', bodyAreas: ['shoulder'] },
  { prescriptionId: 'p3', exerciseId: 'row', movementPattern: 'pull_h', bodyAreas: ['upper_back'] },
];

const answered = (over: Partial<ReadinessResponses>): ReadinessResponses => ({
  discomforts: [],
  residualSoreness: 'none',
  energyLevel: 'ok',
  externalLoads: null,
  answered: true,
  ...over,
});

describe('assessReadiness', () => {
  it('không trả lời -> unknown + giảm tải thận trọng', () => {
    const r = assessReadiness({ ...answered({}), answered: false }, planned);
    expect(r.verdict).toBe('unknown');
    expect(r.modifications[0].code).toBe(ReadinessMod.REDUCE_VOLUME);
    expect(r.modifications[0].payload?.volumeCapPct).toBe(70);
  });

  it('trả lời sạch -> ready, không modification', () => {
    const r = assessReadiness(answered({}), planned);
    expect(r.verdict).toBe('ready');
    expect(r.modifications).toHaveLength(0);
  });

  it('đau nặng ảnh hưởng vận động -> hold, và CHỈ chặn pattern bị đụng', () => {
    const r = assessReadiness(
      answered({
        discomforts: [{ bodyArea: 'shoulder', severity: 'severe', affectsNormalMovement: true }],
      }),
      planned,
    );
    expect(r.verdict).toBe('hold');
    const holds = r.modifications.filter((m) => m.code === ReadinessMod.HOLD_MOVEMENT_PATTERN);
    // chỉ push_v (ohp đụng vai) bị hold; squat/pull_h không đụng vai -> vẫn tập
    expect(holds.map((m) => m.target)).toEqual(['push_v']);
    expect(holds.map((m) => m.target)).not.toContain('squat');
    expect(r.modifications.some((m) => m.code === ReadinessMod.HOLD_SESSION)).toBe(false);
  });

  it('đau nặng đụng >= nửa số pattern -> hold cả buổi', () => {
    const r = assessReadiness(
      answered({
        discomforts: [{ bodyArea: 'knee', severity: 'severe', affectsNormalMovement: true }],
      }),
      // 2 pattern, 1 bị đụng (squat) = nửa -> hold session
      [planned[0], planned[1]],
    );
    expect(r.verdict).toBe('hold');
    expect(r.modifications.some((m) => m.code === ReadinessMod.HOLD_SESSION)).toBe(true);
  });

  it('đau vừa -> modify + avoid_body_area + substitute', () => {
    const r = assessReadiness(
      answered({
        discomforts: [{ bodyArea: 'knee', severity: 'moderate', affectsNormalMovement: false }],
      }),
      planned,
    );
    expect(r.verdict).toBe('modify');
    expect(r.modifications.some((m) => m.code === ReadinessMod.AVOID_BODY_AREA)).toBe(true);
    expect(
      r.modifications.some(
        (m) => m.code === ReadinessMod.SUBSTITUTE_EXERCISE && m.target === 'goblet_squat',
      ),
    ).toBe(true);
  });

  it('đau nhẹ -> modify + use_regression', () => {
    const r = assessReadiness(
      answered({
        discomforts: [{ bodyArea: 'knee', severity: 'mild', affectsNormalMovement: false }],
      }),
      planned,
    );
    expect(r.verdict).toBe('modify');
    expect(r.modifications.some((m) => m.code === ReadinessMod.USE_REGRESSION)).toBe(true);
  });

  it('năng lượng thấp -> modify + reduce_volume 60%', () => {
    const r = assessReadiness(answered({ energyLevel: 'low' }), planned);
    expect(r.verdict).toBe('modify');
    const rv = r.modifications.find((m) => m.code === ReadinessMod.REDUCE_VOLUME);
    expect(rv?.payload?.volumeCapPct).toBe(60);
  });

  it('1 tải ngoài -> reduce_volume 80%', () => {
    const r = assessReadiness(answered({ externalLoads: { poorSleep: true } }), planned);
    const rv = r.modifications.find((m) => m.code === ReadinessMod.REDUCE_VOLUME);
    expect(rv?.payload?.volumeCapPct).toBe(80);
  });
});
