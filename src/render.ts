import type { Detail } from "./command/detail";
import { type MenuResult, menuItemCount } from "./command/menu";
import type { PhotoResult } from "./command/photo";
import type { RatingResult } from "./command/rating";
import type { ReviewResult } from "./command/review";
import type { SearchResult } from "./command/search";
import type { Suggest } from "./command/suggest";
import type { VacancyResult } from "./command/vacancy";
import { formatDistance } from "./geo";
import { formatHourGroup } from "./hour";

const show = (value: string | number | undefined, fallback = "-"): string => {
  return value === undefined ? fallback : String(value);
};

const defined = (list: (string | undefined)[]): string[] => list.filter((line): line is string => line !== undefined);

export const renderSuggest = (list: Suggest[]): string => {
  if (!list.length) return "No suggestions. The index is English and Japanese only.";
  const lineOf = (item: Suggest): string => {
    if (item.kind === "area") return `[area] ${item.name}  (${item.datatype} ${item.id}${item.exact ? ", exact" : ""})`;
    if (item.kind === "genre") return `[genre] ${item.name}  (${item.code}${item.exact ? ", exact" : ""})`;
    return `[restaurant] ${item.name}  ${item.subName}\n  ${item.url}`;
  };
  return list.map(lineOf).join("\n");
};

export const renderSearch = (result: SearchResult): string => {
  const filtered = result.itemList.length !== result.pageCount;
  const headList = defined([
    `${show(result.from)}-${show(result.to)} of ${show(result.total)} (page ${result.page}${filtered ? `, ${result.itemList.length} of ${result.pageCount} kept after filters` : ""})`,
    result.resolvedArea ? `area: ${result.resolvedArea}` : undefined,
    result.resolvedGenre ? `genre: ${result.resolvedGenre}` : undefined,
    result.budgetNote ? `budget: ${result.budgetNote}` : undefined,
    result.vacancyNote ? `vacancy: ${result.vacancyNote}` : undefined,
    result.nearNote ? `near: ${result.nearNote}` : undefined,
    result.openAtNote ? `open: ${result.openAtNote}` : undefined,
    result.url,
  ]);

  const bodyList = result.itemList.map((item) => {
    const tagList = defined([
      item.distanceM === undefined ? undefined : formatDistance(item.distanceM),
      item.openStatus === undefined ? undefined : item.openStatus,
    ]);
    return defined([
      `${show(item.rank, "").padStart(2)} ${item.name}  ${show(item.rating)} (${show(item.reviewCount, "0")} reviews)  id=${item.id}${tagList.length ? `  [${tagList.join(", ")}]` : ""}`,
      `   ${show(item.areaGenre, "")}`,
      `   dinner ${show(item.dinnerPrice)} / lunch ${show(item.lunchPrice)} / closed ${show(item.holiday)}`,
      item.hourList?.length ? `   hours: ${item.hourList.map(formatHourGroup).join(" | ")}` : undefined,
      item.awardList.length ? `   award: ${item.awardList.join("; ")}` : undefined,
      item.catchphrase ? `   "${item.catchphrase}"` : undefined,
      item.featureList.length ? `   ${item.featureList.join(", ")}` : undefined,
      `   ${item.url}`,
    ]).join("\n");
  });

  return [...headList, "", ...(bodyList.length ? bodyList : ["No results."])].join("\n");
};

export const renderDetail = (item: Detail): string => {
  const headList = defined([
    `${show(item.name)}  ${show(item.rating)} (${show(item.reviewCount, "0")} reviews)  id=${item.id}`,
    item.cuisine ? `cuisine: ${item.cuisine}` : undefined,
    item.priceRange ? `price: ${item.priceRange}` : undefined,
    item.locality ? `locality: ${item.locality}${item.postalCode ? ` (${item.postalCode})` : ""}` : undefined,
    item.latitude !== undefined && item.longitude !== undefined ? `geo: ${item.latitude},${item.longitude}` : undefined,
    item.hourList.length ? `hours: ${item.hourList.map(formatHourGroup).join(" | ")}` : undefined,
    item.url,
    "",
  ]);

  const rowList = item.infoList.map((row) => {
    const value = row.value.includes("\n") ? `\n    ${row.value.split("\n").join("\n    ")}` : ` ${row.value}`;
    return `${row.label}:${value}`;
  });

  return [...headList, ...rowList].join("\n");
};

export const renderReview = (result: ReviewResult): string => {
  const headList = [`page ${result.page}`, result.url, ""];
  const bodyList = result.itemList.map((item) => {
    return defined([
      `${show(item.rating)} ${show(item.time, "")}  ${show(item.reviewer)} (${show(item.reviewerPostCount, "?")} posts)  ${show(item.visited, "")} ${show(item.visitCount, "")}`,
      item.spend ? `   spend: ${item.spend}` : undefined,
      item.title ? `   ${item.title}` : undefined,
      item.excerpt ? `   ${item.excerpt.split("\n").join("\n   ")}` : undefined,
      item.url ? `   ${item.url}` : undefined,
    ]).join("\n");
  });
  return [...headList, ...(bodyList.length ? bodyList : ["No reviews on this page."])].join("\n");
};

export const renderMenu = (result: MenuResult): string => {
  const head = [
    `${result.kind} menu, ${menuItemCount(result)} items${result.lastUpdated ? ` (last updated ${result.lastUpdated})` : ""}`,
    result.url,
  ].join("\n");
  if (!result.sectionList.length) return `${head}\n\nNo ${result.kind} menu posted on Tabelog.`;
  const bodyList = result.sectionList.map((section) => {
    return defined([
      section.title ? `## ${section.title}` : undefined,
      ...section.itemList.map((item) =>
        defined([
          `- ${item.name}${item.price ? `  ${item.price}` : ""}`,
          item.note ? `    ${item.note.split("\n").join(" ")}` : undefined,
          item.imageUrl ? `    ${item.imageUrl}` : undefined,
        ]).join("\n"),
      ),
    ]).join("\n");
  });
  return [head, ...bodyList].join("\n\n");
};

export const renderRating = (result: RatingResult): string => {
  const lineList = [result.url, ""];
  if (result.averageList.length) {
    lineList.push("average", ...result.averageList.map((row) => `  ${row.label}: ${show(row.score)}`), "");
  }
  if (result.distributionList.length) {
    const total = result.distributionList.reduce((sum, row) => sum + row.count, 0);
    lineList.push(
      `distribution (${total} reviewers)`,
      ...result.distributionList.map((row) => `  ${row.band.padEnd(9)} ${String(row.count).padStart(5)}`),
      "",
    );
  }
  for (const group of result.spendList) {
    lineList.push(
      `${group.label}: ${show(group.typical)}`,
      ...group.bandList.filter((row) => row.count > 0).map((row) => `  ${row.band.padEnd(20)} ${row.count}`),
      "",
    );
  }
  return lineList.join("\n").trimEnd();
};

export const renderPhoto = (result: PhotoResult): string => {
  const headList = [`page ${result.page}, ${result.mode}, ${result.itemList.length} photos`, result.url, ""];
  if (!result.itemList.length) return [...headList, "No photos on this page."].join("\n");
  return [
    ...headList,
    ...result.itemList.map((item) =>
      `${item.imageUrl}\n   ${show(item.caption, "")}${item.by ? `  (${item.by})` : ""}`.trimEnd(),
    ),
  ].join("\n");
};

const CALENDAR_DAY_COUNT = 28;

export const renderVacancy = (result: VacancyResult): string => {
  if (!result.bookable) {
    return `Restaurant ${result.id} has no online booking on Tabelog. Check the detail page's reservation row and phone.`;
  }
  const lineList = [`${result.date} ${result.time} for ${result.people}`, ""];

  if (result.slotList.length) {
    // One URL per slot differs only in visit_time; print the times once and
    // the URL for the asked time (or the nearest slot) so the answer stays short.
    const asked = result.slotList.find((slot) => slot.time === result.time);
    const nearest =
      asked ??
      [...result.slotList].sort(
        (a, b) =>
          Math.abs(minuteOf(a.time) - minuteOf(result.time)) - Math.abs(minuteOf(b.time) - minuteOf(result.time)),
      )[0];
    lineList.push(
      `bookable times on ${result.date} for ${result.people}: ${result.slotList.map((slot) => slot.time).join(", ")}`,
      nearest ? `book ${nearest.time}: ${nearest.bookingUrl}` : "",
      "",
    );
  } else {
    lineList.push(`no online table on ${result.date} for ${result.people} around ${result.time}`, "");
  }

  if (result.partySizeList.length) {
    const min = Math.min(...result.partySizeList);
    const max = Math.max(...result.partySizeList);
    lineList.push(`party sizes taken online that day: ${min}-${max}`, "");
  }

  const windowList = result.dayList.slice(0, CALENDAR_DAY_COUNT);
  if (windowList.length) {
    const okCount = windowList.filter((day) => day.status === "available" || day.status === "limited").length;
    const otherList = windowList.filter((day) => day.status !== "available");
    lineList.push(`next ${windowList.length} days: tables on ${okCount}`);
    if (otherList.length) {
      lineList.push(
        ...otherList.map((day) => `  ${day.date} ${day.day}  ${day.status}${day.holiday ? " (holiday)" : ""}`),
      );
    }
  }
  return lineList.join("\n").trimEnd();
};

const minuteOf = (time: string): number => {
  const [hh, mm] = time.split(":").map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
};
