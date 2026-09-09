import type { Detail } from "./command/detail";
import type { ReviewResult } from "./command/review";
import type { SearchResult } from "./command/search";
import type { Suggest } from "./command/suggest";

const show = (value: string | number | undefined, fallback = "-"): string => {
  return value === undefined ? fallback : String(value);
};

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
  const headList = [
    `${show(result.from)}-${show(result.to)} of ${show(result.total)} (page ${result.page})`,
    result.resolvedArea ? `area: ${result.resolvedArea}` : undefined,
    result.resolvedGenre ? `genre: ${result.resolvedGenre}` : undefined,
    result.url,
  ].filter((line): line is string => line !== undefined);

  const bodyList = result.itemList.map((item) => {
    const lineList = [
      `${show(item.rank, "").padStart(2)} ${item.name}  ${show(item.rating)} (${show(item.reviewCount, "0")} reviews)  id=${item.id}`,
      `   ${show(item.areaGenre, "")}`,
      `   dinner ${show(item.dinnerPrice)} / lunch ${show(item.lunchPrice)} / closed ${show(item.holiday)}`,
      item.awardList.length ? `   award: ${item.awardList.join("; ")}` : undefined,
      item.catchphrase ? `   "${item.catchphrase}"` : undefined,
      item.featureList.length ? `   ${item.featureList.join(", ")}` : undefined,
      `   ${item.url}`,
    ];
    return lineList.filter((line): line is string => line !== undefined).join("\n");
  });

  return [...headList, "", ...(bodyList.length ? bodyList : ["No results."])].join("\n");
};

export const renderDetail = (item: Detail): string => {
  const headList = [
    `${show(item.name)}  ${show(item.rating)} (${show(item.reviewCount, "0")} reviews)  id=${item.id}`,
    item.cuisine ? `cuisine: ${item.cuisine}` : undefined,
    item.priceRange ? `price: ${item.priceRange}` : undefined,
    item.locality ? `locality: ${item.locality}${item.postalCode ? ` (${item.postalCode})` : ""}` : undefined,
    item.latitude !== undefined && item.longitude !== undefined ? `geo: ${item.latitude},${item.longitude}` : undefined,
    item.url,
    "",
  ].filter((line): line is string => line !== undefined);

  const rowList = item.infoList.map((row) => {
    const value = row.value.includes("\n") ? `\n    ${row.value.split("\n").join("\n    ")}` : ` ${row.value}`;
    return `${row.label}:${value}`;
  });

  return [...headList, ...rowList].join("\n");
};

export const renderReview = (result: ReviewResult): string => {
  const headList = [`page ${result.page}`, result.url, ""];
  const bodyList = result.itemList.map((item) => {
    const lineList = [
      `${show(item.rating)} ${show(item.time, "")}  ${show(item.reviewer)} (${show(item.reviewerPostCount, "?")} posts)  ${show(item.visited, "")} ${show(item.visitCount, "")}`,
      item.spend ? `   spend: ${item.spend}` : undefined,
      item.title ? `   ${item.title}` : undefined,
      item.excerpt ? `   ${item.excerpt.split("\n").join("\n   ")}` : undefined,
      item.url ? `   ${item.url}` : undefined,
    ];
    return lineList.filter((line): line is string => line !== undefined).join("\n");
  });
  return [...headList, ...(bodyList.length ? bodyList : ["No reviews on this page."])].join("\n");
};
