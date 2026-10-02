/**
 * The instant a Habit's cooldown lifts, as its block reason names it: the weekday, the day and
 * month, and the time — "Mon 5 Oct, 02:00" — read from the backend's local wall-clock
 * `YYYY-MM-DDTHH:MM:SS`. The raw instant when it does not parse.
 */
export function formatCooldownUntil(until: string, locale = "en-GB"): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(until);
  if (match === null) return until;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined) return until;
  const date = new Date(year, month - 1, day, hour, minute);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(date);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${weekday} ${dayMonth}, ${pad(hour)}:${pad(minute)}`;
}
