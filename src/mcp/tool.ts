import { course } from "../command/course";
import { detail } from "../command/detail";
import { locate } from "../command/locate";
import { menu } from "../command/menu";
import { nearby } from "../command/nearby";
import { photo } from "../command/photo";
import { ranking } from "../command/ranking";
import { rating } from "../command/rating";
import { isUseType, review, reviewRead, USE_TYPE_LIST } from "../command/review";
import {
  type BudgetOption,
  isMeal,
  isOrder,
  isSort,
  MEAL_LIST,
  type NearOption,
  ORDER_LIST,
  SORT_LIST,
  search,
  type VacancyFilter,
} from "../command/search";
import { seating } from "../command/seating";
import { suggest } from "../command/suggest";
import { vacancy } from "../command/vacancy";
import { parseGeoPoint } from "../geo";
import { DEFAULT_LOCALE, isLocale, LOCALE_LIST } from "../http";
import {
  renderCourse,
  renderDetail,
  renderLocate,
  renderMenu,
  renderNearby,
  renderPhoto,
  renderRanking,
  renderRating,
  renderReview,
  renderReviewRead,
  renderSearch,
  renderSeating,
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

/** Accepts a JSON array or a comma-separated string. */
const stringList = (input: Record<string, unknown>, key: string): string[] | undefined => {
  const value = input[key];
  const rawList = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(",")
      : [];
  const cleaned = rawList.map((item) => item.trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
};

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
      "Page language: en (default), kr, tw, cn, th. Filters resolve the same way regardless; en has the most complete translations.",
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
      "Search Tabelog restaurants. Give an area (station, town, ward, city, prefecture) and/or genre and/or keyword, or coordinates via near. 20 per page with score, review count, dinner/lunch price band, closing day, awards, feature tags and the restaurant id/URL; pages reads several consecutive pages. Server-side filters: sort, budget band per meal, online-bookable at a date/time/party size. Client-side filters: min_rating, min_review_count, feature tags, near + radius_m (distance from coordinates; when area is omitted the nearest station Tabelog knows is derived from the coordinates), open_at (Japan time), private_room, parking. near/open_at/private_room/parking read each result's page (about 2 s per 20). Area and genre resolve through Tabelog's suggest index: English or Japanese names (Sannomiya, 三宮, ramen, 焼鳥); Korean is not indexed.",
    inputSchema: {
      type: "object",
      properties: {
        area: {
          type: "string",
          description:
            "Station, town, ward, city or prefecture, in English or Japanese. Resolved to Tabelog's area filter. Landmarks (Dotonbori) are not areas; use the nearest station (Namba) or pass near instead.",
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
            "Site order: rating (default) = Tabelog score, access = most viewed by overseas visitors, reserved = most reserved.",
        },
        ...PAGE_PROPERTY("Result"),
        pages: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description:
            "How many consecutive pages to read from page. Defaults to 1, or 5 for a radius search, which walks pages one at a time and stops early once `limit` restaurants are inside the radius.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          description: "Stop a radius scan once this many are kept (default 20) and cut the final list to this many.",
        },
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
            'Coordinates "lat,lng". Results are measured and ordered by straight-line distance. Without area, the nearest railway station (OpenStreetMap) that Tabelog knows becomes the area.',
        },
        radius_m: { type: "integer", minimum: 1, description: "Drop results farther than this many metres from near." },
        open_at: {
          type: "string",
          description:
            '"now" or "YYYY-MM-DD HH:MM" in Japan time. Drops restaurants whose posted hours say closed then; keeps ones with no parsable hours and marks them unknown.',
        },
        min_rating: { type: "number", description: "Keep only Tabelog scores at or above this (e.g. 3.5)." },
        min_review_count: { type: "integer", description: "Keep only restaurants with at least this many reviews." },
        feature: {
          type: "array",
          items: { type: "string" },
          description:
            'English feature tags every result must carry, matched as substrings against the card tags Tabelog prints: "Non smoking", "Smoking allowed", "Credit card accepted", "Wi-Fi available", "Multilingual menu", "Menu with photos", "Children welcome", "Kids menu available", and where present "Vegetarian", "Halal", "Gluten-free", "Digital menu". Private rooms and parking are not card tags; use private_room / parking.',
        },
        award: {
          type: "boolean",
          description:
            "Only restaurants carrying a Tabelog Award (Gold/Silver/Bronze) or Tabelog 100 (Hyakumeiten) badge.",
        },
        private_room: { type: "boolean", description: "Only restaurants whose page lists private rooms as available." },
        parking: { type: "boolean", description: "Only restaurants whose page lists parking as available." },
        order: {
          type: "string",
          enum: [...ORDER_LIST],
          description:
            "Final ordering of kept results: site (default), distance (default with near), review_count, rating.",
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
          pages: optionalNumber(input, "pages"),
          budget: budgetOf(input),
          vacancy: vacancyOf(input),
          near: nearOf(input),
          openAt: optionalString(input, "open_at"),
          minRating: optionalNumber(input, "min_rating"),
          minReviewCount: optionalNumber(input, "min_review_count"),
          featureList: stringList(input, "feature"),
          award: flag(input, "award"),
          privateRoom: flag(input, "private_room"),
          parking: flag(input, "parking"),
          limit: optionalNumber(input, "limit"),
          order: oneOf(input, "order", ORDER_LIST, isOrder),
          locale: localeOf(input),
        }),
      ),
  },
  {
    name: "detail",
    description:
      "Read one restaurant's page: score, review count, cuisine, phone, Japanese address, coordinates, structured weekly hours, transportation, price bands, payment methods, seats, smoking policy, private rooms, parking, reservation policy, website and the rest of Tabelog's info table.",
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
      "List reviews of one restaurant, 20 per page: reviewer, their score, what they spent, visit month, title and the excerpt shown on the list page, with a link to the full review (pass it to review_read).",
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
    name: "review_read",
    description:
      "Full text of one reviewer's review page for a restaurant (the URL a review item links to, .../dtlrvwlst/B123456/), with every visit they logged, scores, spend and photo URLs.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Review URL from the review tool." },
        ...LOCALE_PROPERTY,
      },
      required: ["url"],
    },
    run: async (input) => renderReviewRead(await reviewRead(requiredString(input, "url"), localeOf(input))),
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
      "Online-reservation availability for one restaurant from Tabelog's booking calendar: bookable time slots on the chosen date for the party size with the booking URL, which party sizes are taken, and which of the next 28 days have tables (available / limited / none / closed). Read-only; the reservation itself is completed in a browser via the URL. Restaurants without Tabelog online booking are reported as such.",
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
    name: "course",
    description:
      "Set menus (courses) a restaurant sells: title, price per person and whether tax is included, what it includes, conditions such as time limit or minimum party, any 'most popular' badge, and the plan id the reservation flow uses. Restaurants that registered none are reported as such.",
    inputSchema: {
      type: "object",
      properties: { ...RESTAURANT_PROPERTY, ...LOCALE_PROPERTY },
      required: ["restaurant"],
    },
    run: async (input) => renderCourse(await course(requiredString(input, "restaurant"), localeOf(input))),
  },
  {
    name: "seating",
    description:
      "The seat list of a restaurant: each kind of seating (counter, table, tatami, private room, terrace) with the restaurant's own caption, such as how many guests a private room takes, and a photo. Use this when the info table's bare 'private room: available' is not enough.",
    inputSchema: {
      type: "object",
      properties: { ...RESTAURANT_PROPERTY, ...LOCALE_PROPERTY },
      required: ["restaurant"],
    },
    run: async (input) => renderSeating(await seating(requiredString(input, "restaurant"), localeOf(input))),
  },
  {
    name: "ranking",
    description:
      "Tabelog's own popularity ranking for a place, top 20. This is not the score order search returns: it reflects what people view and book. Exists for a prefecture, city or area; a station falls back to the area around it. No genre filter and one page only.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", description: "Prefecture, city, area or station, English or Japanese." },
        ...LOCALE_PROPERTY,
      },
      required: ["area"],
    },
    run: async (input) => renderRanking(await ranking(requiredString(input, "area"), localeOf(input))),
  },
  {
    name: "nearby",
    description:
      "Tabelog's own nearest-restaurants list around one restaurant (its 'Find nearby restaurants' page): up to 25 places with score, review count, genre and straight-line distance from the anchor, optionally limited to a genre. Use when the user is at or has picked a restaurant and wants alternatives right around it.",
    inputSchema: {
      type: "object",
      properties: {
        ...RESTAURANT_PROPERTY,
        genre: { type: "string", description: "Limit to a genre, English or Japanese name." },
        pages: { type: "integer", minimum: 1, maximum: 5, description: "Pages of five to read. Defaults to 5 (all)." },
        ...LOCALE_PROPERTY,
      },
      required: ["restaurant"],
    },
    run: async (input) =>
      renderNearby(
        await nearby(requiredString(input, "restaurant"), {
          genre: optionalString(input, "genre"),
          pages: optionalNumber(input, "pages"),
          locale: localeOf(input),
        }),
      ),
  },
  {
    name: "locate",
    description:
      "Turn coordinates into Tabelog search areas: the nearest railway stations (OpenStreetMap) resolved through Tabelog's index, falling back to the ward/city from the address. Use before search when you only have a GPS position and want to see or choose the area yourself; search's near parameter does this automatically.",
    inputSchema: {
      type: "object",
      properties: {
        point: { type: "string", description: 'Coordinates "lat,lng".' },
      },
      required: ["point"],
    },
    run: async (input) => renderLocate(await locate(parseGeoPoint(requiredString(input, "point")))),
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
