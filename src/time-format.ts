const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto'
});

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

export function formatRelativeTime(timestamp: number, nowMs = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '-';
  }

  const diffMs = timestamp - nowMs;
  const absMs = Math.abs(diffMs);
  if (absMs < 45 * SECOND_MS) {
    return 'just now';
  }

  if (absMs < 90 * SECOND_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / MINUTE_MS), 'minute');
  }

  if (absMs < 45 * MINUTE_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / MINUTE_MS), 'minute');
  }

  if (absMs < 90 * MINUTE_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / HOUR_MS), 'hour');
  }

  if (absMs < 22 * HOUR_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / HOUR_MS), 'hour');
  }

  if (absMs < 36 * HOUR_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / DAY_MS), 'day');
  }

  if (absMs < 6 * DAY_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / DAY_MS), 'day');
  }

  if (absMs < 10 * DAY_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / WEEK_MS), 'week');
  }

  if (absMs < 4 * WEEK_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / WEEK_MS), 'week');
  }

  if (absMs < 18 * MONTH_MS) {
    return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / MONTH_MS), 'month');
  }

  return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / YEAR_MS), 'year');
}
