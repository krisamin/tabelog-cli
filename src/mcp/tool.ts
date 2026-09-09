import { detail } from "../command/detail";
import { isUseType, review, USE_TYPE_LIST } from "../command/review";
import { isSort, SORT_LIST, search } from "../command/search";
import { suggest } from "../command/suggest";
import { DEFAULT_LOCALE, isLocale, LOCALE_LIST } from "../http";
import { renderDetail, renderReview, renderSearch, renderSuggest } from "../render";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<string>;
}

const optionalString = (input: Record<string, unknown>, key: string): string | undefined => {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const requiredString = (input: Record<string, unknown>, key: string): string => {
  const value = optionalString(input, key);
  if (value === undefined) throw new Error(`"${key}" is required.`);
  return value;
};

const optionalNumber = (input: Record<string, unknown>, key: string): number | undefined => {
  const value = input[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const flag = (input: Record<string, unknown>, key: string): boolean => input[key] === true;

const localeOf = (input: Record<string, unknown>) => {
  const value = input.locale;
  if (value === undefined || value === "") return DEFAULT_LOCALE;
  if (!isLocale(value)) throw new Error(`"locale" must be one of ${LOCALE_LIST.join(", ")}.`);
  return value;
};

const LOCALE_PROPERTY = {
  locale: {
    type: "string",
    enum: [...LOCALE_LIST],
    description:
      "Page language. en (default) has the most complete translations; kr gives Korean names and text. Search filters resolve the same way regardless.",
  },
};

const RESTAURANT_PROPERTY = {
  restaurant: {
    type: "string",
    description:
      "Tabelog restaurant URL (any locale, or the Japanese site) or the numeric restaurant id shown by search results.",
  },
};

/**
 * Every tool returns text. Names stay short because the host namespaces them by
 * source: ara advertises these as `tabelog_search` and so on.
 */
export const TOOL_LIST: ToolDefinition[] = [
  {
    name: "search",
    description:
      "Search Tabelog restaurants by area, genre and/or free-text keyword, sorted by Tabelog score by default. Returns 20 per page with score, review count, dinner/lunch price band, closing day, awards and the restaurant id/URL. Area and genre are resolved through Tabelog's own suggest index, so use English or Japanese names (Sannomiya, 三宮, ramen, 焼鳥); Korean is not indexed.",
    inputSchema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          description:
            "Station, town, ward, city or prefecture, in English or Japanese. Resolved to Tabelog's area filter.",
        },
        genre: {
          type: "string",
          description:
            "Cuisine or dish type. Resolved to Tabelog's genre code; the index knows Tabelog's own English labels and Japanese names (串カツ resolves, kushikatsu does not). An unresolved genre is searched as a keyword and the result says so.",
        },
        keyword: {
          type: "string",
          description: "Free-text words matched against restaurant names and menus. Japanese works well here.",
        },
        sort: {
          type: "string",
          enum: [...SORT_LIST],
          description:
            "rating (default) = Tabelog score, access = most viewed by overseas visitors, reserved = most reserved.",
        },
        page: { type: "integer", minimum: 1, description: "Result page, 20 restaurants each. Defaults to 1." },
        ...LOCALE_PROPERTY,
      },
    },
    run: async (input) => {
      const sort = input.sort;
      if (sort !== undefined && sort !== "" && !isSort(sort)) {
        throw new Error(`"sort" must be one of ${SORT_LIST.join(", ")}.`);
      }
      return renderSearch(
        await search({
          area: optionalString(input, "area"),
          genre: optionalString(input, "genre"),
          keyword: optionalString(input, "keyword"),
          sort: isSort(sort) ? sort : undefined,
          page: optionalNumber(input, "page"),
          locale: localeOf(input),
        }),
      );
    },
  },
  {
    name: "detail",
    description:
      "Read one restaurant's page: score, review count, cuisine, phone, Japanese address, coordinates, transportation, business hours, price bands, payment methods, seats, smoking policy, website and the rest of Tabelog's info table.",
    inputSchema: {
      type: "object",
      properties: { ...RESTAURANT_PROPERTY, ...LOCALE_PROPERTY },
      required: ["restaurant"],
    },
    run: async (input) => renderDetail(await detail(requiredString(input, "restaurant"), localeOf(input))),
  },
  {
    name: "review",
    description:
      "List reviews of one restaurant, 20 per page: reviewer, their score, what they spent, visit month, title and the excerpt shown on the list page, with a link to the full review.",
    inputSchema: {
      type: "object",
      properties: {
        ...RESTAURANT_PROPERTY,
        page: { type: "integer", minimum: 1, description: "Review page. Defaults to 1." },
        use_type: {
          type: "string",
          enum: [...USE_TYPE_LIST],
          description: "Restrict to dinner or lunch visits. Defaults to all.",
        },
        by_visit: {
          type: "boolean",
          description: "Order by newest visit instead of Tabelog's recommended order.",
        },
        ...LOCALE_PROPERTY,
      },
      required: ["restaurant"],
    },
    run: async (input) => {
      const useType = input.use_type;
      if (useType !== undefined && useType !== "" && !isUseType(useType)) {
        throw new Error(`"use_type" must be one of ${USE_TYPE_LIST.join(", ")}.`);
      }
      return renderReview(
        await review(requiredString(input, "restaurant"), {
          page: optionalNumber(input, "page"),
          useType: isUseType(useType) ? useType : undefined,
          byVisit: flag(input, "by_visit"),
          locale: localeOf(input),
        }),
      );
    },
  },
  {
    name: "suggest",
    description:
      "Look a keyword up in Tabelog's suggest index to see what it resolves to: areas (with type and id), genres (with code) and matching restaurants (with URL). Use it to disambiguate a place or cuisine name before searching, or to jump straight to a restaurant by name.",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Place, cuisine or restaurant name in English or Japanese." },
      },
      required: ["keyword"],
    },
    run: async (input) => renderSuggest(await suggest(requiredString(input, "keyword"))),
  },
];

export const TOOL_MAP = new Map(TOOL_LIST.map((tool) => [tool.name, tool]));
