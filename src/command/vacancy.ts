import { fetchJson } from "../http";
import { toSvd, toSvt } from "../time";
import { absoluteUrl, bookingUrl, resolveRestaurant } from "../url";

/**
 * The online-reservation modal on a restaurant page is fed by three JSON
 * endpoints under /en/booking/calendar/. They answer without a session, so
 * availability can be read here; making the reservation itself is a logged-in
 * form and is deliberately out of scope. Booking URLs are returned so the user
 * can finish in a browser.
 */

export interface VacancyOption {
  /** YYYY-MM-DD. Defaults to today in Japan. */
  date?: string;
  /** Party size. Defaults to 2. */
  people?: number;
  /** HH:MM the caller wants to eat at. Defaults to 19:00. Slots around it are listed. */
  time?: string;
}

export interface VacancyDay {
  date: string;
  /** Sun..Sat */
  day: string;
  /** Raw code from Tabelog: 0 no vacancy, 1 limited, 2 available, 3 closed. */
  code: number;
  status: "available" | "limited" | "none" | "closed" | "unknown";
  holiday: boolean;
}

export interface VacancySlot {
  time: string;
  bookingUrl: string;
}

export interface VacancyResult {
  id: string;
  date: string;
  people: number;
  time: string;
  bookable: boolean;
  dayList: VacancyDay[];
  /** Party sizes the restaurant takes online on that date. */
  partySizeList: number[];
  slotList: VacancySlot[];
}

interface RawDay {
  year?: number;
  month?: number;
  day?: number;
  dow?: number;
  available?: number;
  holiday?: boolean;
}

interface RawDateWithStatus {
  list?: RawDay[];
}

interface RawMemberByDate {
  svpsOpts?: { member_num?: number; status?: number }[];
}

interface RawVacancy {
  selection?: Record<string, { time?: string; url?: string }>;
}

const DAY_NAME_LIST = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Inferred from the calendar JS: it treats 1 and 2 as "has vacancy"; 3 lines up
// with the restaurant's weekly closing day; 0 is a bookable day with nothing left.
const statusOf = (code: number | undefined): VacancyDay["status"] => {
  switch (code) {
    case 2:
      return "available";
    case 1:
      return "limited";
    case 0:
      return "none";
    case 3:
      return "closed";
    default:
      return "unknown";
  }
};

/** A restaurant without online booking answers 400 on these endpoints; that is "not bookable", not a failure. */
const bookingJson = async <T>(url: string): Promise<T> => {
  try {
    return await fetchJson<T>(url);
  } catch (error) {
    if (error instanceof Error && /^HTTP 4\d\d /.test(error.message)) return {} as T;
    throw error;
  }
};

const pad = (value: number | undefined): string => String(value ?? 0).padStart(2, "0");

const toVacancyDay = (raw: RawDay): VacancyDay => ({
  date: `${raw.year ?? "????"}-${pad(raw.month)}-${pad(raw.day)}`,
  day: DAY_NAME_LIST[raw.dow ?? -1] ?? "?",
  code: raw.available ?? -1,
  status: statusOf(raw.available),
  holiday: raw.holiday === true,
});

export const vacancy = async (input: string, option: VacancyOption): Promise<VacancyResult> => {
  const ref = await resolveRestaurant(input);
  const svd = toSvd(option.date);
  const people = option.people && option.people > 0 ? Math.floor(option.people) : 2;
  const svt = toSvt(option.time ?? "19:00");
  const base = { rst_id: ref.id, svd, svps: String(people) };

  const [dateWithStatus, memberByDate, found] = await Promise.all([
    bookingJson<RawDateWithStatus>(bookingUrl("find_vacancy_date_with_status", base)),
    bookingJson<RawMemberByDate>(bookingUrl("find_vacancy_member_by_date", { rst_id: ref.id, svd })),
    bookingJson<RawVacancy>(bookingUrl("find_vacancy", { ...base, svt })),
  ]);

  const dayList = (dateWithStatus.list ?? []).map(toVacancyDay);
  const partySizeList = (memberByDate.svpsOpts ?? [])
    .filter((item) => (item.status ?? 0) > 0 && typeof item.member_num === "number")
    .map((item) => item.member_num as number);
  const slotList = Object.values(found.selection ?? {})
    .filter((item) => typeof item.time === "string" && typeof item.url === "string")
    .map((item) => ({ time: item.time as string, bookingUrl: absoluteUrl(item.url as string) }))
    .sort((a, b) => a.time.localeCompare(b.time));

  // A restaurant without online booking answers every endpoint with empty lists.
  const bookable = dayList.length > 0 || partySizeList.length > 0 || slotList.length > 0;

  return {
    id: ref.id,
    date: `${svd.slice(0, 4)}-${svd.slice(4, 6)}-${svd.slice(6, 8)}`,
    people,
    time: `${svt.slice(0, 2)}:${svt.slice(2)}`,
    bookable,
    dayList,
    partySizeList,
    slotList,
  };
};
