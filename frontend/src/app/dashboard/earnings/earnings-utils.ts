/**
 * Pure helpers for the freelancer earnings dashboard time-series.
 * Kept framework-free so they can be unit-tested in isolation.
 */

export interface WeeklyEarning {
  /** ISO date of the week-start (Monday), e.g. "2026-05-04". */
  week: string;
  earnings: number;
}

/** Add `days` to an ISO date string, returning a new ISO date (YYYY-MM-DD). */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fill missing weeks between the first and last data point with zero-value
 * entries so the chart shows continuous weeks with no gaps.
 *
 * Input may be sparse and unsorted; output is sorted ascending by week.
 */
export function fillWeeklyGaps(data: WeeklyEarning[]): WeeklyEarning[] {
  if (data.length === 0) return [];

  const sorted = [...data].sort((a, b) => a.week.localeCompare(b.week));
  const byWeek = new Map(sorted.map((d) => [d.week, d.earnings]));

  const filled: WeeklyEarning[] = [];
  let cursor = sorted[0].week;
  const end = sorted[sorted.length - 1].week;

  // Guard against malformed ranges to avoid an unbounded loop.
  let safety = 0;
  while (cursor <= end && safety < 1040 /* ~20 years of weeks */) {
    filled.push({ week: cursor, earnings: byWeek.get(cursor) ?? 0 });
    cursor = addDays(cursor, 7);
    safety += 1;
  }

  return filled;
}

/**
 * 30-day (4-week) trailing moving average over weekly earnings.
 * For the first three weeks the window is partial (averaged over the weeks
 * available so far), matching the acceptance criteria.
 */
export function movingAverage(weekly: WeeklyEarning[], window = 4): number[] {
  return weekly.map((_, i) => {
    const slice = weekly.slice(Math.max(0, i - (window - 1)), i + 1);
    const sum = slice.reduce((s, w) => s + w.earnings, 0);
    return sum / slice.length;
  });
}

/** Combine filled weeks with their trailing moving average for charting. */
export function buildSeries(data: WeeklyEarning[]): Array<{
  week: string;
  earnings: number;
  movingAvg: number;
}> {
  const filled = fillWeeklyGaps(data);
  const avg = movingAverage(filled);
  return filled.map((w, i) => ({
    week: w.week,
    earnings: w.earnings,
    movingAvg: Number(avg[i].toFixed(2)),
  }));
}
