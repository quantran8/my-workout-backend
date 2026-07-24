// program/calendar.ts
// DETERMINISTIC. Không LLM, không I/O. Pure — dễ test (như pool-retrieval.ts).
//
// Suy "một ngày dương lịch là buổi nào" từ startDate + trainingDays + durationWeeks —
// KHÔNG cần một row lịch cho mỗi ngày. PlannedSession chỉ có (weekNumber, dayNumber);
// đây là cầu nối duy nhất giữa nó và lịch thật.
//
// Quy ước ngày: tất cả tính theo UTC calendar-day (khớp todayDateString ở service và
// startDate lưu dạng @db.Date). trainingDays là ISO weekday 1..7 (Mon=1..Sun=7), sắp
// tăng dần; index (1-based) của nó = dayNumber. weekNumber = số tuần kể từ startDate + 1.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Trạng thái của một ngày trong (hoặc ngoài) chương trình. */
export type CalendarDayStatus =
  | 'training'          // hôm nay là một buổi tập -> có (weekNumber, dayNumber)
  | 'rest'             // trong khoảng chương trình nhưng không phải ngày tập
  | 'before_start'     // trước startDate
  | 'program_complete'; // sau tuần cuối

export interface CalendarResolution {
  status: CalendarDayStatus;
  weekNumber?: number; // chỉ có khi 'training'
  dayNumber?: number;  // chỉ có khi 'training'
}

/** ISO weekday 1..7 (Mon=1..Sun=7) của một 'YYYY-MM-DD' (đọc theo UTC). */
export function isoWeekday(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

/** Số ngày trọn giữa hai 'YYYY-MM-DD' (b - a), theo UTC. Âm nếu b < a. */
export function daysBetween(a: string, b: string): number {
  const ta = new Date(`${a}T00:00:00.000Z`).getTime();
  const tb = new Date(`${b}T00:00:00.000Z`).getTime();
  return Math.round((tb - ta) / MS_PER_DAY);
}

/**
 * resolveDate: 'YYYY-MM-DD' -> buổi nào (hoặc nghỉ / hết / chưa bắt đầu).
 *
 * weekNumber = floor(daysSinceStart / 7) + 1. Ngày tập <=> isoWeekday(date) ∈ trainingDays;
 * dayNumber = vị trí (1-based) của weekday đó trong trainingDays đã sắp. trainingDays rỗng
 * (không đủ dữ liệu lịch) -> mọi ngày trong khoảng là 'rest'.
 */
export function resolveDate(
  date: string,
  program: { startDate: string; durationWeeks: number; trainingDays: number[] },
): CalendarResolution {
  const offset = daysBetween(program.startDate, date);
  if (offset < 0) return { status: 'before_start' };

  const weekNumber = Math.floor(offset / 7) + 1;
  if (weekNumber > program.durationWeeks) return { status: 'program_complete' };

  const sorted = [...program.trainingDays].sort((a, b) => a - b);
  const wd = isoWeekday(date);
  const idx = sorted.indexOf(wd);
  if (idx === -1) return { status: 'rest' };

  return { status: 'training', weekNumber, dayNumber: idx + 1 };
}

/**
 * totalPlannedSessions: tổng số buổi trong CẢ chương trình = durationWeeks × số ngày tập/tuần.
 * Đây là mẫu số cho "đã tập X / M buổi" — khác với đếm PlannedSession row (an toàn kể cả khi
 * một tuần thiếu row do lỗi gen; validator WEEK_COVERAGE_MISMATCH đã chặn trường hợp đó khi lưu).
 */
export function totalPlannedSessions(program: {
  durationWeeks: number;
  trainingDays: number[];
}): number {
  return program.durationWeeks * program.trainingDays.length;
}
