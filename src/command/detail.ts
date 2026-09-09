import { type HourGroup, parseHourList } from "../hour";
import { classText, decodeEntity, jsonLdList, textOf, toNumber } from "../html";
import { fetchHtml, type Locale } from "../http";
import { detailUrl, type RestaurantRef, resolveRestaurant } from "../url";

/**
 * A restaurant page carries two machine-friendly layers: a schema.org
 * Restaurant JSON-LD block (name, coordinates, phone, price range, rating) and
 * the rstinfo-table, a label/value table with everything else (hours, seats,
 * payment, smoking, website). We read both and hand back the table as ordered
 * rows so nothing the site adds later is silently dropped.
 */

export interface InfoRow {
  label: string;
  value: string;
}

export interface Detail {
  id: string;
  url: string;
  name: string | undefined;
  rating: number | undefined;
  reviewCount: number | undefined;
  cuisine: string | undefined;
  priceRange: string | undefined;
  phone: string | undefined;
  /** Locality as schema.org gives it, e.g. "Nakayamatedori Chuo-ku Kobe Hyogo". The Japanese street address is in infoList. */
  locality: string | undefined;
  postalCode: string | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  imageUrl: string | undefined;
  /** Structured business hours, parsed from the English page only (empty on other locales). */
  hourList: HourGroup[];
  infoList: InfoRow[];
}

interface LdRestaurant {
  "@type"?: string;
  name?: string;
  image?: string;
  telephone?: string;
  priceRange?: string;
  servesCuisine?: string;
  address?: { addressLocality?: string; postalCode?: string };
  geo?: { latitude?: number; longitude?: number };
  aggregateRating?: { ratingCount?: string | number; ratingValue?: string | number };
}

const asString = (value: unknown): string | undefined => {
  return typeof value === "string" && value.trim().length ? value.trim() : undefined;
};

/** Cells are nested markup; turn block boundaries into line breaks before flattening. */
const cellText = (cell: string): string => {
  const cleaned = cell
    // Static map image and its two links after the address.
    .replace(/<div class="rstinfo-table__map-wrap">[\s\S]*$/, "")
    // "View spending breakdown" style notices that are only a link.
    .replace(/<p class="rstinfo-table__notice">\s*<a[\s\S]*?<\/p>/g, "")
    // Collapsed highlight text: the "..." marker and the Read more button sit mid-sentence.
    .replace(/<button[^>]*>[\s\S]*?<\/button>/g, "")
    .replace(/<span class="[^"]*pr-comment__more-icon[^"]*">[\s\S]*?<\/span>/g, "")
    // Budget rows: dinner and lunch are inline spans told apart only by an icon.
    .replace(/<i aria-label="([^"]*)" class="c-rating-v3__time[^>]*><\/i>/g, "\n$1: ")
    .replace(/<span class="line">\|<\/span>/g, "\n")
    .replace(/<\/(?:p|li|div|dd|dt|h\d)>/gi, "\n");
  return textOf(cleaned).replace(/\uff5e/g, "~");
};

/** Award cells repeat every badge in a tooltip and a modal; the badge captions alone are the list. */
const awardText = (cell: string): string => {
  const modalAt = cell.indexOf('class="c-modal');
  const visible = modalAt < 0 ? cell : cell.slice(0, modalAt);
  const list = [...visible.matchAll(/class="c-badge-(?:award|hyakumeiten)[^"]*"><i>([^<]*)<\/i>/g)]
    .map((match) => textOf(match[1] ?? ""))
    .filter((text) => text.length);
  return [...new Set(list)].join("\n");
};

const parseInfoTable = (html: string): InfoRow[] => {
  const start = html.indexOf('class="rstinfo-table');
  if (start < 0) return [];
  const end = html.lastIndexOf("</table>");
  const region = html.slice(start, end > start ? end : undefined);

  const rowList: InfoRow[] = [];
  for (const match of region.matchAll(/<th>([\s\S]*?)<\/th>\s*<td([^>]*)>([\s\S]*?)<\/td>/g)) {
    const label = textOf(match[1] ?? "");
    const cell = match[3] ?? "";
    const value = (match[2] ?? "").includes("rstinfo-badge") ? awardText(cell) : cellText(cell);
    if (!value) continue;
    // The phone row ships with an empty header cell.
    rowList.push({ label: label || "Phone", value });
  }
  return rowList;
};

export const detailOf = async (ref: RestaurantRef, locale: Locale): Promise<Detail> => {
  const url = detailUrl(ref, locale);
  const { body } = await fetchHtml(url);

  const ld = jsonLdList(body).find((block) => block["@type"] === "Restaurant") as LdRestaurant | undefined;
  const infoList = parseInfoTable(body);
  if (!ld && !infoList.length) {
    throw new Error(`Neither restaurant JSON-LD nor an info table at ${url}. Tabelog markup may have changed.`);
  }
  const rating = ld?.aggregateRating?.ratingValue;
  const reviewCount = ld?.aggregateRating?.ratingCount;

  return {
    id: ref.id,
    url,
    name: asString(ld?.name) ?? classText(body, "rdheader-rstname") ?? undefined,
    rating: toNumber(rating === undefined ? classText(body, "rdheader-rating__score-val-dtl") : String(rating)),
    reviewCount: toNumber(reviewCount === undefined ? undefined : String(reviewCount)),
    cuisine: asString(ld?.servesCuisine),
    priceRange: asString(ld?.priceRange)?.replace(/\uff5e/g, "~"),
    phone: asString(ld?.telephone),
    locality: asString(ld?.address?.addressLocality),
    postalCode: asString(ld?.address?.postalCode),
    latitude: typeof ld?.geo?.latitude === "number" ? ld.geo.latitude : undefined,
    longitude: typeof ld?.geo?.longitude === "number" ? ld.geo.longitude : undefined,
    imageUrl: asString(ld?.image) === undefined ? undefined : decodeEntity(ld?.image ?? ""),
    hourList: locale === "en" ? parseHourList(body) : [],
    infoList,
  };
};

export const detail = async (input: string, locale: Locale): Promise<Detail> => {
  return detailOf(await resolveRestaurant(input), locale);
};
