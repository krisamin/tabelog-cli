/**
 * Japan Standard Time helpers. Japan has no daylight saving, so JST is a fixed
 * UTC+9 and the wall clock can be derived from a UTC timestamp arithmetically.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface WallClock {
  /** 0 = Sunday, as Date.getDay(). */
  day: number;
  /** Minutes since midnight. */
  minute: number;
  /** YYYYMMDD, the format Tabelog's svd parameter uses. */
  svd: string;
  label: string;
}

const DAY_NAME_LIST = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const pad = (value: number): string => String(value).padStart(2, "0");

const fromUtcFields = (utc: Date): WallClock => {
  const y = utc.getUTCFullYear();
  const m = utc.getUTCMonth() + 1;
  const d = utc.getUTCDate();
  const hh = utc.getUTCHours();
  const mm = utc.getUTCMinutes();
  return {
    day: utc.getUTCDay(),
    minute: hh * 60 + mm,
    svd: `${y}${pad(m)}${pad(d)}`,
    label: `${y}-${pad(m)}-${pad(d)} ${DAY_NAME_LIST[utc.getUTCDay()]} ${pad(hh)}:${pad(mm)} JST`,
  };
};

export const nowInJapan = (): WallClock => fromUtcFields(new Date(Date.now() + JST_OFFSET_MS));

/**
 * "now", "2026-09-11 19:00", "2026-09-11T19:00", "20260911 1900" or "19:00"
 * (today in Japan). Read as Japan wall time, never as the machine's zone.
 */
export const parseJapanTime = (input: string): WallClock => {
  const trimmed = input.trim();
  if (!trimmed || trimmed.toLowerCase() === "now") return nowInJapan();

  const dateMatch = /(\d{4})-?(\d{2})-?(\d{2})/.exec(trimmed);
  const timeMatch = /(?:^|[T\s])(\d{1,2}):?(\d{2})(?!\d)/.exec(
    dateMatch ? trimmed.slice(dateMatch[0].length) : ` ${trimmed}`,
  );
  if (!dateMatch && !timeMatch)
    throw new Error(`Cannot read "${input}" as a date/time. Use YYYY-MM-DD HH:MM or "now".`);

  const today = nowInJapan();
  const y = dateMatch ? Number(dateMatch[1]) : Number(today.svd.slice(0, 4));
  const m = dateMatch ? Number(dateMatch[2]) : Number(today.svd.slice(4, 6));
  const d = dateMatch ? Number(dateMatch[3]) : Number(today.svd.slice(6, 8));
  const hh = timeMatch ? Number(timeMatch[1]) : 0;
  const mm = timeMatch ? Number(timeMatch[2]) : 0;
  if (hh > 23 || mm > 59) throw new Error(`Cannot read "${input}" as a time.`);
  return fromUtcFields(new Date(Date.UTC(y, m - 1, d, hh, mm)));
};

/** "2026-09-11" or "20260911" into svd form; defaults to today in Japan. */
export const toSvd = (input: string | undefined): string => {
  if (input === undefined || !input.trim()) return nowInJapan().svd;
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(input.trim());
  if (!match) throw new Error(`Cannot read "${input}" as a date. Use YYYY-MM-DD.`);
  return `${match[1]}${match[2]}${match[3]}`;
};

/** "19:00" or "1900" into svt form (HHMM). */
export const toSvt = (input: string): string => {
  const match = /^(\d{1,2}):?(\d{2})$/.exec(input.trim());
  if (!match || Number(match[1]) > 24 || Number(match[2]) > 59) {
    throw new Error(`Cannot read "${input}" as a time. Use HH:MM.`);
  }
  return `${pad(Number(match[1]))}${match[2]}`;
};

export const dayName = (day: number): string => DAY_NAME_LIST[day] ?? "?";

export const dayIndexOf = (name: string): number | undefined => {
  const index = DAY_NAME_LIST.findIndex((item) => item.toLowerCase() === name.trim().slice(0, 3).toLowerCase());
  return index < 0 ? undefined : index;
};

export const formatMinute = (minute: number): string => {
  const wrapped = ((minute % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
};
