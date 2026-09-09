#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" };
import { detail } from "./command/detail";
import { locate } from "./command/locate";
import { menu } from "./command/menu";
import { nearby } from "./command/nearby";
import { photo } from "./command/photo";
import { rating } from "./command/rating";
import { isUseType, review, reviewRead, USE_TYPE_LIST } from "./command/review";
import { isMeal, isOrder, isSort, MEAL_LIST, ORDER_LIST, SORT_LIST, search } from "./command/search";
import { suggest } from "./command/suggest";
import { vacancy } from "./command/vacancy";
import { parseGeoPoint } from "./geo";
import { DEFAULT_LOCALE, isLocale, LOCALE_LIST, type Locale } from "./http";
import { runMcp } from "./mcp/server";
import {
  renderDetail,
  renderLocate,
  renderMenu,
  renderNearby,
  renderPhoto,
  renderRating,
  renderReview,
  renderReviewRead,
  renderSearch,
  renderSuggest,
  renderVacancy,
} from "./render";
import { MENU_KIND_LIST, type MenuKind, PHOTO_MODE_LIST, type PhotoMode } from "./url";

const HELP = `tabelog: Tabelog CLI that reads the inbound site (tabelog.com/en, /kr) without a browser

Usage:
  tabelog search [--area <name>] [--genre <name>] [--keyword <words>]
                 [--sort ${SORT_LIST.join("|")}] [--page <n>]
                 [--budget-meal ${MEAL_LIST.join("|")}] [--budget-min <yen>] [--budget-max <yen>]
                 [--vacancy] [--vacancy-date <YYYY-MM-DD>] [--vacancy-time <HH:MM>] [--vacancy-people <n>]
                 [--near <lat,lng>] [--radius-m <m>] [--open-at now|"<YYYY-MM-DD HH:MM>"]
                 [--pages <1-5>] [--min-rating <n>] [--min-review-count <n>] [--feature <a,b>]
                 [--private-room] [--parking] [--order ${ORDER_LIST.join("|")}]
                                            list restaurants (20 per page, Tabelog score order by default;
                                            --near alone picks the nearest station as the area)
  tabelog detail <url|id>                   restaurant page: score, address, weekly hours, prices, seats, ...
  tabelog review <url|id> [--page <n>] [--use-type ${USE_TYPE_LIST.join("|")}] [--by-visit]
                                            reviews, 20 per page
  tabelog review-read <review-url>          one reviewer's full review page
  tabelog menu <url|id> [--kind ${MENU_KIND_LIST.join("|")}]
                                            posted menu with prices
  tabelog rating <url|id>                   per-aspect averages, score distribution, spending distribution
  tabelog photo <url|id> [--page <n>] [--mode ${PHOTO_MODE_LIST.join("|")}]
                                            photo URLs with captions
  tabelog vacancy <url|id> [--date <YYYY-MM-DD>] [--time <HH:MM>] [--people <n>]
                                            online-booking calendar and time slots (read-only)
  tabelog nearby <url|id> [--genre <name>] [--pages <1-5>]
                                            Tabelog's 25 nearest restaurants around one restaurant
  tabelog locate <lat,lng>                  which Tabelog areas coordinates fall in (via nearby stations)
  tabelog suggest <keyword>                 what a keyword resolves to (areas, genres, restaurants)
  tabelog mcp                               serve the same commands as MCP tools over stdio

Options:
  --locale <${LOCALE_LIST.join("|")}>      page language (default: ${DEFAULT_LOCALE}, or $TABELOG_LOCALE)
  --json                                    print the parsed result as JSON instead of text
  --version                                 print version
  -h, --help                                show this help

Area and genre names are matched against Tabelog's suggest index, which knows
English and Japanese names (Sannomiya, 三宮, ramen, 焼鳥). Korean is not indexed.
Times are Japan time. --near and --open-at read each result's page (slower).
`;

/** Flags that consume the next argument as their value. Everything else is boolean. */
const VALUE_FLAG_SET = new Set([
  "area",
  "genre",
  "keyword",
  "sort",
  "page",
  "use-type",
  "locale",
  "budget-meal",
  "budget-min",
  "budget-max",
  "vacancy-date",
  "vacancy-time",
  "vacancy-people",
  "near",
  "radius-m",
  "open-at",
  "pages",
  "min-rating",
  "min-review-count",
  "feature",
  "order",
  "kind",
  "mode",
  "date",
  "time",
  "people",
]);

interface ParsedArg {
  positionalList: string[];
  flagMap: Record<string, string | boolean>;
}

const parseArg = (argv: string[]): ParsedArg => {
  const positionalList: string[] = [];
  const flagMap: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "-h") {
      flagMap.help = true;
    } else if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        flagMap[body.slice(0, eq)] = body.slice(eq + 1);
      } else if (VALUE_FLAG_SET.has(body)) {
        const next = argv[i + 1];
        if (next === undefined) throw new Error(`--${body} requires a value.`);
        flagMap[body] = next;
        i++;
      } else {
        flagMap[body] = true;
      }
    } else {
      positionalList.push(arg);
    }
  }
  return { positionalList, flagMap };
};

const str = (value: string | boolean | undefined): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

const num = (value: string | boolean | undefined, name: string): number | undefined => {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number.`);
  return parsed;
};

const choice = <T extends string>(
  value: string | boolean | undefined,
  name: string,
  list: readonly T[],
  guard: (value: unknown) => value is T,
): T | undefined => {
  const text = str(value);
  if (text === undefined) return undefined;
  if (!guard(text)) throw new Error(`--${name} must be one of ${list.join(", ")}.`);
  return text;
};

const isMenuKind = (value: unknown): value is MenuKind => {
  return typeof value === "string" && (MENU_KIND_LIST as readonly string[]).includes(value);
};

const isPhotoMode = (value: unknown): value is PhotoMode => {
  return typeof value === "string" && (PHOTO_MODE_LIST as readonly string[]).includes(value);
};

const localeOf = (value: string | boolean | undefined): Locale => {
  const candidate = str(value) ?? process.env.TABELOG_LOCALE ?? DEFAULT_LOCALE;
  if (!isLocale(candidate)) throw new Error(`--locale must be one of ${LOCALE_LIST.join(", ")}.`);
  return candidate;
};

const emit = (json: boolean, data: unknown, text: string): void => {
  console.log(json ? JSON.stringify(data, null, 2) : text);
};

const targetOf = (restList: string[], usage: string): string => {
  const target = restList[0];
  if (!target) throw new Error(`Usage: ${usage}`);
  return target;
};

const main = async (): Promise<void> => {
  const { positionalList, flagMap } = parseArg(process.argv.slice(2));
  const [command, ...restList] = positionalList;

  if (flagMap.version === true) {
    console.log(pkg.version);
    return;
  }
  if (!command || flagMap.help === true) {
    console.log(HELP);
    return;
  }

  const json = flagMap.json === true;
  const locale = localeOf(flagMap.locale);

  switch (command) {
    case "search": {
      const budgetMin = num(flagMap["budget-min"], "budget-min");
      const budgetMax = num(flagMap["budget-max"], "budget-max");
      const vacancyDate = str(flagMap["vacancy-date"]);
      const vacancyTime = str(flagMap["vacancy-time"]);
      const vacancyPeople = num(flagMap["vacancy-people"], "vacancy-people");
      const wantVacancy =
        flagMap.vacancy === true ||
        vacancyDate !== undefined ||
        vacancyTime !== undefined ||
        vacancyPeople !== undefined;
      const near = str(flagMap.near);
      const result = await search({
        area: str(flagMap.area),
        genre: str(flagMap.genre),
        keyword: str(flagMap.keyword) ?? (restList.length ? restList.join(" ") : undefined),
        sort: choice(flagMap.sort, "sort", SORT_LIST, isSort),
        page: num(flagMap.page, "page"),
        budget:
          budgetMin === undefined && budgetMax === undefined
            ? undefined
            : {
                meal: choice(flagMap["budget-meal"], "budget-meal", MEAL_LIST, isMeal) ?? "dinner",
                min: budgetMin,
                max: budgetMax,
              },
        vacancy: wantVacancy ? { date: vacancyDate, time: vacancyTime, people: vacancyPeople } : undefined,
        near:
          near === undefined
            ? undefined
            : { point: parseGeoPoint(near), radiusM: num(flagMap["radius-m"], "radius-m") },
        openAt: str(flagMap["open-at"]),
        pages: num(flagMap.pages, "pages"),
        minRating: num(flagMap["min-rating"], "min-rating"),
        minReviewCount: num(flagMap["min-review-count"], "min-review-count"),
        featureList: str(flagMap.feature)
          ?.split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        privateRoom: flagMap["private-room"] === true,
        parking: flagMap.parking === true,
        order: choice(flagMap.order, "order", ORDER_LIST, isOrder),
        locale,
      });
      emit(json, result, renderSearch(result));
      break;
    }
    case "detail": {
      const result = await detail(targetOf(restList, "tabelog detail <url|id>"), locale);
      emit(json, result, renderDetail(result));
      break;
    }
    case "review": {
      const result = await review(targetOf(restList, "tabelog review <url|id>"), {
        page: num(flagMap.page, "page"),
        useType: choice(flagMap["use-type"], "use-type", USE_TYPE_LIST, isUseType),
        byVisit: flagMap["by-visit"] === true,
        locale,
      });
      emit(json, result, renderReview(result));
      break;
    }
    case "review-read": {
      const result = await reviewRead(targetOf(restList, "tabelog review-read <review-url>"), locale);
      emit(json, result, renderReviewRead(result));
      break;
    }
    case "nearby": {
      const result = await nearby(targetOf(restList, "tabelog nearby <url|id>"), {
        genre: str(flagMap.genre),
        pages: num(flagMap.pages, "pages"),
        locale,
      });
      emit(json, result, renderNearby(result));
      break;
    }
    case "locate": {
      const result = await locate(parseGeoPoint(targetOf(restList, "tabelog locate <lat,lng>")));
      emit(json, result, renderLocate(result));
      break;
    }
    case "menu": {
      const result = await menu(
        targetOf(restList, "tabelog menu <url|id>"),
        choice(flagMap.kind, "kind", MENU_KIND_LIST, isMenuKind) ?? "food",
        locale,
      );
      emit(json, result, renderMenu(result));
      break;
    }
    case "rating": {
      const result = await rating(targetOf(restList, "tabelog rating <url|id>"), locale);
      emit(json, result, renderRating(result));
      break;
    }
    case "photo": {
      const result = await photo(targetOf(restList, "tabelog photo <url|id>"), {
        page: num(flagMap.page, "page"),
        mode: choice(flagMap.mode, "mode", PHOTO_MODE_LIST, isPhotoMode),
        locale,
      });
      emit(json, result, renderPhoto(result));
      break;
    }
    case "vacancy": {
      const result = await vacancy(targetOf(restList, "tabelog vacancy <url|id>"), {
        date: str(flagMap.date),
        time: str(flagMap.time),
        people: num(flagMap.people, "people"),
      });
      emit(json, result, renderVacancy(result));
      break;
    }
    case "suggest": {
      const keyword = restList.join(" ");
      if (!keyword) throw new Error("Usage: tabelog suggest <keyword>");
      const result = await suggest(keyword);
      emit(json, result, renderSuggest(result));
      break;
    }
    case "mcp":
      await runMcp();
      break;
    default:
      throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
