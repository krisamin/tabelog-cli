import { textOf } from "./html";
import { dayIndexOf, dayName, formatMinute, type WallClock } from "./time";

/**
 * Business hours as the /en/ restaurant page renders them: one
 * rstinfo-table__business-item per group of days, each with a title ("Mon,
 * Tue, Thu" or "Sat, Sun, Public Holiday") and one or more ranges ("5:00 PM -
 * 10:00 PM", optionally followed by "L.O. 9:30 PM") or the word "Closed".
 * Every locale uses the same markup; day names, the "closed" word and the
 * list separator differ, and 24-hour times appear outside English.
 */

export interface HourRange {
  /** Minutes since midnight. close may exceed 1440 when the range runs past midnight. */
  open: number;
  close: number;
  lastOrder: string | undefined;
}

export interface HourGroup {
  /** Title as written, e.g. "Sat, Sun, Public Holiday". */
  title: string;
  /** Weekday indexes (0 = Sunday) the title names. "Public Holiday" has no index. */
  dayList: number[];
  closed: boolean;
  rangeList: HourRange[];
}

export type OpenStatus = "open" | "closed" | "unknown";

const toMinute = (hour: string, minute: string, meridiem: string | undefined): number => {
  let h = Number(hour) % 12;
  if (meridiem?.toUpperCase() === "PM") h += 12;
  if (meridiem === undefined) h = Number(hour);
  return h * 60 + Number(minute);
};

const parseRange = (text: string): HourRange | undefined => {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[-\u2013\u301c~]\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(text);
  if (!match) return undefined;
  const open = toMinute(match[1] ?? "0", match[2] ?? "0", match[3]);
  let close = toMinute(match[4] ?? "0", match[5] ?? "0", match[6]);
  // "6:00 PM - 12:00 AM" or "5:00 PM - 3:00 AM": the close is on the next day.
  if (close <= open) close += 1440;
  const lastOrder = /L\.?O\.?\s*([^\n]*)/i.exec(text)?.[1]?.trim();
  return { open, close, lastOrder: lastOrder || undefined };
};

const parseDayList = (title: string): number[] => {
  const list: number[] = [];
  for (const part of title.split(/[,\u3001\uff0c]/)) {
    const range = /^\s*([A-Za-z]{3})[a-z]*\s*[-\u2013]\s*([A-Za-z]{3})/.exec(part);
    if (range) {
      const from = dayIndexOf(range[1] ?? "");
      const to = dayIndexOf(range[2] ?? "");
      if (from !== undefined && to !== undefined) {
        for (let day = from; ; day = (day + 1) % 7) {
          list.push(day);
          if (day === to) break;
        }
      }
      continue;
    }
    const day = dayIndexOf(part);
    if (day !== undefined) list.push(day);
  }
  return list;
};

/** "Closed" as each locale prints it in a day row: en, kr, tw, cn, th. */
const CLOSED_WORD_LIST = [
  "closed",
  "\uc815\uae30\ud734\uc77c",
  "\u516c\u4f11\u65e5",
  "\u5b9a\u671f\u4f11\u606f\u65e5",
  "\u0e1b\u0e34\u0e14",
];

export const parseHourList = (html: string): HourGroup[] => {
  const start = html.indexOf('<ul class="rstinfo-table__business-list">');
  if (start < 0) return [];
  const end = html.indexOf("</td>", start);
  const region = html.slice(start, end < 0 ? undefined : end);
  // The free-text notes block reuses the list class; it has no business-title and is skipped.
  const groupList: HourGroup[] = [];
  for (const match of region.matchAll(
    /<li class="rstinfo-table__business-item">\s*<p class="rstinfo-table__business-title">([\s\S]*?)<\/p>([\s\S]*?<\/li>)\s*<\/ul>\s*<\/li>/g,
  )) {
    const title = textOf(match[1] ?? "");
    const textList = [
      ...(match[2] ?? "").matchAll(/<li class="rstinfo-table__business-dtl-text[^"]*">([\s\S]*?)<\/li>/g),
    ].map((item) => textOf(item[1] ?? ""));
    const closed = textList.some((text) => CLOSED_WORD_LIST.some((word) => text.trim().toLowerCase() === word));
    const rangeList = textList.map(parseRange).filter((range): range is HourRange => range !== undefined);
    groupList.push({ title, dayList: parseDayList(title), closed, rangeList });
  }
  return groupList;
};

/**
 * Whether the restaurant is open at a Japan wall-clock moment. A range that ran
 * past midnight the previous day counts too. "unknown" when the page gave no
 * parsable hours for that weekday; callers must not treat that as closed.
 */
export const openStatusAt = (groupList: HourGroup[], at: WallClock): OpenStatus => {
  if (!groupList.length) return "unknown";
  const groupFor = (day: number) => groupList.filter((group) => group.dayList.includes(day));
  const todayList = groupFor(at.day);
  const yesterdayList = groupFor((at.day + 6) % 7);
  if (!todayList.length && !yesterdayList.length) return "unknown";

  for (const group of todayList) {
    if (group.rangeList.some((range) => at.minute >= range.open && at.minute < range.close)) return "open";
  }
  for (const group of yesterdayList) {
    if (group.rangeList.some((range) => range.close > 1440 && at.minute + 1440 < range.close)) return "open";
  }
  const todayKnown = todayList.some((group) => group.closed || group.rangeList.length);
  return todayKnown ? "closed" : "unknown";
};

export const formatHourGroup = (group: HourGroup): string => {
  const dayText = group.dayList.length ? group.dayList.map(dayName).join(", ") : group.title;
  if (group.closed && !group.rangeList.length) return `${dayText}: closed`;
  const rangeText = group.rangeList
    .map(
      (range) =>
        `${formatMinute(range.open)}-${formatMinute(range.close)}${range.lastOrder ? ` (L.O. ${range.lastOrder})` : ""}`,
    )
    .join(", ");
  return `${dayText}: ${rangeText || group.title}`;
};
