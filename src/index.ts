#!/usr/bin/env bun
import pkg from "../package.json" with { type: "json" };
import { detail } from "./command/detail";
import { isUseType, review, USE_TYPE_LIST } from "./command/review";
import { isSort, SORT_LIST, search } from "./command/search";
import { suggest } from "./command/suggest";
import { DEFAULT_LOCALE, isLocale, LOCALE_LIST, type Locale } from "./http";
import { runMcp } from "./mcp/server";
import { renderDetail, renderReview, renderSearch, renderSuggest } from "./render";

const HELP = `tabelog: Tabelog CLI that reads the inbound site (tabelog.com/en, /kr) without a browser

Usage:
  tabelog search [--area <name>] [--genre <name>] [--keyword <words>]
                 [--sort ${SORT_LIST.join("|")}] [--page <n>]
                                            list restaurants (20 per page, Tabelog score order by default)
  tabelog detail <url|id>                   restaurant page: score, address, hours, prices, seats, ...
  tabelog review <url|id> [--page <n>] [--use-type ${USE_TYPE_LIST.join("|")}] [--by-visit]
                                            reviews, 20 per page
  tabelog suggest <keyword>                 what a keyword resolves to (areas, genres, restaurants)
  tabelog mcp                               serve the same commands as MCP tools over stdio

Options:
  --locale <${LOCALE_LIST.join("|")}>      page language (default: ${DEFAULT_LOCALE}, or $TABELOG_LOCALE)
  --json                                    print the parsed result as JSON instead of text
  --version                                 print version
  -h, --help                                show this help

Area and genre names are matched against Tabelog's suggest index, which knows
English and Japanese names (Sannomiya, 三宮, ramen, 焼鳥). Korean is not indexed.
`;

/** Flags that consume the next argument as their value. Everything else is boolean. */
const VALUE_FLAG_SET = new Set(["area", "genre", "keyword", "sort", "page", "use-type", "locale"]);

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
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number.`);
  return parsed;
};

const localeOf = (value: string | boolean | undefined): Locale => {
  const candidate = str(value) ?? process.env.TABELOG_LOCALE ?? DEFAULT_LOCALE;
  if (!isLocale(candidate)) throw new Error(`--locale must be one of ${LOCALE_LIST.join(", ")}.`);
  return candidate;
};

const emit = (json: boolean, data: unknown, text: string): void => {
  console.log(json ? JSON.stringify(data, null, 2) : text);
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

  switch (command) {
    case "search": {
      const sort = str(flagMap.sort);
      if (sort !== undefined && !isSort(sort)) throw new Error(`--sort must be one of ${SORT_LIST.join(", ")}.`);
      const result = await search({
        area: str(flagMap.area),
        genre: str(flagMap.genre),
        keyword: str(flagMap.keyword) ?? (restList.length ? restList.join(" ") : undefined),
        sort,
        page: num(flagMap.page, "page"),
        locale: localeOf(flagMap.locale),
      });
      emit(json, result, renderSearch(result));
      break;
    }
    case "detail": {
      const target = restList[0];
      if (!target) throw new Error("Usage: tabelog detail <url|id>");
      const result = await detail(target, localeOf(flagMap.locale));
      emit(json, result, renderDetail(result));
      break;
    }
    case "review": {
      const target = restList[0];
      if (!target) throw new Error("Usage: tabelog review <url|id>");
      const useType = str(flagMap["use-type"]);
      if (useType !== undefined && !isUseType(useType)) {
        throw new Error(`--use-type must be one of ${USE_TYPE_LIST.join(", ")}.`);
      }
      const result = await review(target, {
        page: num(flagMap.page, "page"),
        useType,
        byVisit: flagMap["by-visit"] === true,
        locale: localeOf(flagMap.locale),
      });
      emit(json, result, renderReview(result));
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
