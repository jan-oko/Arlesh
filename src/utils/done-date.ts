/**
 * A done date as a `datetime-local` input holds it (`YYYY-MM-DDTHH:MM`), from the backend's local
 * wall-clock instant (`YYYY-MM-DDTHH:MM:SS`); empty when there is none.
 */
export function toDoneDateInput(instant: string | null): string {
  return instant === null ? "" : instant.slice(0, 16);
}

/** The backend's instant for a `datetime-local` value: whole minutes, seconds zeroed. */
export function fromDoneDateInput(value: string): string {
  return `${value}:00`;
}

/** Now, as a `datetime-local` value: the latest done date the field offers. */
export function nowDoneDateInput(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
