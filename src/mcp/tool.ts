import { detail } from "../command/detail";
import { menu } from "../command/menu";
import { photo } from "../command/photo";
import { rating } from "../command/rating";
import { isUseType, review, USE_TYPE_LIST } from "../command/review";
import {
  type BudgetOption,
  isMeal,
  isSort,
  MEAL_LIST,
  type NearOption,
  SORT_LIST,
  search,
  type VacancyFilter,
} from "../command/search";
import { suggest } from "../command/suggest";
import { vacancy } from "../command/vacancy";
import { parseGeoPoint } from "../geo";
import { DEFAULT_LOCALE, isLocale, LOCALE_LIST } from "../http";
import {
  renderDetail,
  renderMenu,
  renderPhoto,
  renderRating,
  renderReview,
  renderSearch,
  renderSuggest,
  renderVacancy,
} from "../render";
import { MENU_KIND_LIST, type MenuKind, PHOTO_MODE_LIST, type PhotoMode } from "../url";

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
    const parsed = Number(value.replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const flag = (input: Record<string, unknown>, key: string): boolean => input[key] === true;

const oneOf = <T extends string>(
  input: Record<string, unknown>,
  key: string,
  list: readonly T[],
  guard: (value: unknown) => value is T,
): T | undefined => {
  const value = input[key];
  if (value === undefined || value === "") return undefined;
  if (!guard(value)) throw new Error(`"${key}" must be one of ${list.join(", ")}.`);
  return value;
};

const isMenuKind = (value: unknown): value is MenuKind => {
  return typeof value === "string" && (MENU_KIND_LIST as readonly string[]).includes(value);
};

const isPhotoMode = (value: unknown): value is PhotoMode => {
  return typeof value === "string" && (PHOTO_MODE_LIST as readonly string[]).includes(value);
};

const localeOf = (input: Record<string, unknown>) => oneOf(input, "locale", LOCALE_LIST, isLocale) ?? DEFAULT_LOCALE;

const LOCALE_PROPERTY = {
  locale: {
    type: "string",
    enum: [...LOCALE_LIST],
    description:
      "Page language. en (default) has the most complete translations; kr gives Korean names and text. Filters resolve the same way regardless.",
  },
};

const RESTAURANT_PROPERTY = {
  restaurant: {
    type: "string",
    description:
      "Tabelog restaurant URL (any locale, or the Japanese site) or the numeric restaurant id shown by search results.",
  },
};

const PAGE_PROPERTY = (what: string) => ({
  page: { type: "integer", minimum: 1, description: `${what} page, 20 per page. Defaults to 1.` },
});

const budgetOf = (input: Record<string, unknown>): BudgetOption | undefined => {
  const min = optionalNumber(input, "budget_min");
  const max = optionalNumber(input, "budget_max");
  if (min === undefined && max === undefined) return undefined;
  return { meal: oneOf(input, "budget_meal", MEAL_LIST, isMeal) ?? "dinner", min, max };
};

const vacancyOf = (input: Record<string, unknown>): VacancyFilter | undefined => {
  const date = optionalString(input, "vacancy_date");
  const time = optionalString(input, "vacancy_time");
  const people = optionalNumber(input, "vacancy_people");
  if (date === undefined && time === undefined && people === undefined && !flag(input, "vacancy")) return undefined;
  return { date, time, people };
};

const nearOf = (input: Record<string, unknown>): NearOption | undefined => {
  const near = optionalString(input, "near");
  if (near === undefined) return undefined;
  return { point: parseGeoPoint(near), radiusM: optionalNumber(input, "radius_m") };
};

/**
 * Every tool returns text. Names stay short because the host namespaces them by
 * source: ara advertises these as `tabelog_search` and so on.
 */
export const TOOL_LIST: ToolDefinition[] = [
  {
    name: "search",
    description:
      "Search Tabelog restaurants by area, genre and/or free-text keyword, sorted by Tabelog score by default; 20 per page with score, review count, dinner/lunch price band, closing day, awards and the restaurant id/URL. Optional filters: budget band per meal, online-bookable at a date/time/party size, distance from coordinates (near + radius_m, sorted nearest first), and open at a Japan time (open_at). near and open_at read each result's page, so they take a few seconds and apply to the fetched page only. Area and genre resolve through Tabelog's suggest index: use English or Japanese names (Sannomiya, 三宮, ramen, 焼鳥); Korean is not indexed.",
    inputSchema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          description:
            "Station, town, ward, city or prefecture, in English or Japanese. Resolved to Tabelog's area filter. Landmarks (Dotonbori) are not areas; use the nearest station (Namba).",
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
        ...PAGE_PROPERTY("Result"),
        budget_meal: {
          type: "string",
          enum: [...MEAL_LIST],
          description: "Which meal budget_min/budget_max apply to. Defaults to dinner.",
        },
        budget_min: {
          type: "integer",
          description: "Lowest per-person price in yen. Snapped down to Tabelog's band edge.",
        },
        budget_max: {
          type: "integer",
          description:
            "Highest per-person price in yen. Snapped up to Tabelog's band edge; there is no band under 1,000.",
        },
        vacancy: {
          type: "boolean",
          description:
            "Only restaurants with an online-bookable table. Uses vacancy_date/time/people, defaulting to today 19:00 for 2.",
        },
        vacancy_date: { type: "string", description: "YYYY-MM-DD for the vacancy filter. Implies vacancy." },
        vacancy_time: { type: "string", description: "HH:MM (Japan time) for the vacancy filter. Implies vacancy." },
        vacancy_people: {
          type: "integer",
          minimum: 1,
          description: "Party size for the vacancy filter. Implies vacancy.",
        },
        near: {
          type: "string",
          description:
            'Coordinates "lat,lng" to sort this page\'s results by straight-line distance. Combine with area for a sensible candidate set.',
        },
        radius_m: { type: "integer", minimum: 1, description: "Drop results farther than this many metres from near." },
        open_at: {
          type: "string",
          description:
            '"now" or "YYYY-MM-DD HH:MM" in Japan time. Drops restaurants whose posted hours say closed then; keeps ones with no parsable hours and marks them unknown.',
        },
        ...LOCALE_PROPERTY,
      },
    },
    run: async (input) =>
      renderSearch(
        await search({
          area: optionalString(input, "area"),
          genre: optionalString(input, "genre"),
          keyword: optionalString(input, "keyword"),
          sort: oneOf(input, "sort", SORT_LIST, isSort),
          page: optionalNumber(input, "page"),
          budget: budgetOf(input),
          vacancy: vacancyOf(input),
          near: nearOf(input),
          openAt: optionalString(input, "open_at"),
          locale: localeOf(input),
        }),
      ),
  },
  {
    name: "detail",
    description:
      "Read one restaurant's page: score, review count, cuisine, phone, Japanese address, coordinates, structured weekly hours, transportation, price bands, payment methods, seats, smoking policy, reservation policy, website and the rest of Tabelog's info table.",
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
        ...PAGE_PROPERTY("Review"),
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
    run: async (input) =>
      renderReview(
        await review(requiredString(input, "restaurant"), {
          page: optionalNumber(input, "page"),
          useType: oneOf(input, "use_type", USE_TYPE_LIST, isUseType),
          byVisit: flag(input, "by_visit"),
          locale: localeOf(input),
        }),
      ),
  },
  {
    name: "menu",
    description:
      "The menu a restaurant posted on Tabelog: sections with item names, prices, notes and photo links. kind picks food (default), lunch or drink. Many restaurants post nothing; that is reported, not an error.",
    inputSchema: {
      type: "object",
      properties: {
        ...RESTAURANT_PROPERTY,
        kind: { type: "string", enum: [...MENU_KIND_LIST], description: "food (default), lunch or drink." },
        ...LOCALE_PROPERTY,
      },
      required: ["restaurant"],
    },
    run: async (input) =>
      renderMenu(
        await menu(
          requiredString(input, "restaurant"),
          oneOf(input, "kind", MENU_KIND_LIST, isMenuKind) ?? "food",
          localeOf(input),
        ),
      ),
  },
  {
    name: "rating",
    description:
      "Rating breakdown for one restaurant: average per aspect (taste, service, atmosphere, drinks, cost performance), how many reviewers gave each score band, and the distribution of what recent reviewers spent per person for dinner and lunch.",
    inputSchema: {
      type: "object",
      properties: { ...RESTAURANT_PROPERTY, ...LOCALE_PROPERTY },
      required: ["restaurant"],
    },
    run: async (input) => renderRating(await rating(requiredString(input, "restaurant"), localeOf(input))),
  },
  {
    name: "photo",
    description:
      "Photos of one restaurant, 20 per page, with caption and who posted them. mode narrows to owner (official) or user (reviewer) photos. Returns 640px image URLs.",
    inputSchema: {
      type: "object",
      properties: {
        ...RESTAURANT_PROPERTY,
        ...PAGE_PROPERTY("Photo"),
        mode: { type: "string", enum: [...PHOTO_MODE_LIST], description: "all (default), owner or user." },
        ...LOCALE_PROPERTY,
      },
      required: ["restaurant"],
    },
    run: async (input) =>
      renderPhoto(
        await photo(requiredString(input, "restaurant"), {
          page: optionalNumber(input, "page"),
          mode: oneOf(input, "mode", PHOTO_MODE_LIST, isPhotoMode),
          locale: localeOf(input),
        }),
      ),
  },
  {
    name: "vacancy",
    description:
      "Online-reservation availability for one restaurant from Tabelog's booking calendar: which days in the coming month have tables (available / limited / none / closed), which party sizes are taken on the chosen date, and the bookable time slots around the chosen time with the booking URL for each. Read-only; the reservation itself is completed in a browser via those URLs. Restaurants without Tabelog online booking are reported as such.",
    inputSchema: {
      type: "object",
      properties: {
        ...RESTAURANT_PROPERTY,
        date: { type: "string", description: "YYYY-MM-DD. Defaults to today in Japan." },
        time: { type: "string", description: "HH:MM in Japan time. Defaults to 19:00." },
        people: { type: "integer", minimum: 1, description: "Party size. Defaults to 2." },
      },
      required: ["restaurant"],
    },
    run: async (input) =>
      renderVacancy(
        await vacancy(requiredString(input, "restaurant"), {
          date: optionalString(input, "date"),
          time: optionalString(input, "time"),
          people: optionalNumber(input, "people"),
        }),
      ),
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
