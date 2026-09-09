import { describe, expect, test } from "bun:test";
import { parseCardList, parseCount, stationDistanceOf } from "../src/command/card";
import { parseCourse } from "../src/command/course";
import { parseDetail } from "../src/command/detail";
import { parseMenu } from "../src/command/menu";
import { parsePhoto } from "../src/command/photo";
import { parseRating } from "../src/command/rating";
import { parseReviewList, parseReviewRead } from "../src/command/review";
import { parseSeating } from "../src/command/seating";
import { parsePagination } from "../src/html";
import { fixture } from "./fixture";

/**
 * Parser tests against captured pages. Each assertion names a value a user
 * would notice going missing, not merely that some array is non-empty: a
 * regex that still matches but grabs the wrong group has to fail here.
 */

describe("search cards", () => {
  // /en/rstLst/?...&station_id=4483&genre_name=MC01 (ramen near Sannomiya)
  const html = fixture("search-en.html");
  const itemList = parseCardList(html);

  test("reads a full page of cards", () => {
    expect(itemList).toHaveLength(20);
  });

  test("reads every field of the top card", () => {
    const first = itemList[0];
    expect(first?.id).toBe("28002413");
    expect(first?.name).toBe("Marutaka Chuka Soba Kobe Ninomiya Ninomiya ten");
    expect(first?.url).toBe("https://tabelog.com/en/hyogo/A2801/A280101/28002413/");
    expect(first?.rating).toBeCloseTo(3.68, 2);
    expect(first?.reviewCount).toBeGreaterThan(2000);
    expect(first?.areaGenre).toContain("Ramen");
    expect(first?.dinnerPrice).toBe("- JPY 999");
    expect(first?.holiday).toBe("Monday");
    expect(first?.awardList.join(" ")).toContain("Ramen WEST");
    expect(first?.featureList).toContain("Non smoking");
  });

  test("ids are unique and ratings are plausible scores", () => {
    expect(new Set(itemList.map((item) => item.id)).size).toBe(itemList.length);
    for (const item of itemList) {
      if (item.rating !== undefined) expect(item.rating).toBeGreaterThanOrEqual(3);
      if (item.rating !== undefined) expect(item.rating).toBeLessThanOrEqual(5);
    }
  });

  test("reads the result counter", () => {
    expect(parseCount(html)).toEqual({ from: 1, to: 20, total: 146 });
  });

  test("a no-match page is zero, not unknown", () => {
    // A missing counter means the markup moved; search treats that as an error,
    // so this distinction has to survive.
    expect(parseCardList(fixture("search-empty.html"))).toHaveLength(0);
    expect(parseCount(fixture("search-empty.html"))).toEqual({ from: 0, to: 0, total: 0 });
  });

  test("station distance comes from the card's own label", () => {
    const shown = stationDistanceOf(itemList[0] as never);
    expect(shown?.station).toBe("Sannomiya Sta.");
    expect(shown?.metre).toBe(450);
  });
});

describe("ranking cards", () => {
  // /en/hokkaido/A0101/A010103/rank/ . Same card class, different name markup.
  const itemList = parseCardList(fixture("ranking.html"));

  test("reads a top 20 with ranks in order", () => {
    expect(itemList).toHaveLength(20);
    expect(itemList.map((item) => item.rank)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
  });

  test("reads the number one", () => {
    expect(itemList[0]?.name).toBe("AKI NAGAO");
    expect(itemList[0]?.id).toBe("1028665");
    expect(itemList[0]?.url).toContain("/1028665/");
    expect(itemList[0]?.rating).toBeGreaterThan(4);
  });
});

describe("detail", () => {
  // /en/hyogo/A2801/A280101/28043837/
  const page = parseDetail(fixture("detail-en.html"), {
    id: "28043837",
    url: "https://tabelog.com/en/hyogo/A2801/A280101/28043837/",
    locale: "en",
  });

  test("reads the JSON-LD facts", () => {
    expect(page.name).toBe("Machida Shoten Sannomiya Ten");
    expect(page.rating).toBeCloseTo(3.43, 2);
    expect(page.reviewCount).toBe(272);
    expect(page.cuisine).toContain("Ramen");
    // JSON-LD gives the international form; the info table's Phone row keeps the local one.
    expect(page.phone).toBe("+81-78-334-0064");
    expect(page.infoList.find((row) => row.label === "Phone")?.value).toBe("078-334-0064");
    expect(page.postalCode).toBe("6500004");
    expect(page.latitude).toBeCloseTo(34.6957, 3);
    expect(page.longitude).toBeCloseTo(135.1924, 3);
    // The full-width tilde would break any downstream price parsing.
    expect(page.priceRange).toBe("~JPY 999");
  });

  test("keeps the info table in page order with the phone row labelled", () => {
    const labelList = page.infoList.map((row) => row.label);
    expect(labelList[0]).toBe("Restaurant name");
    expect(labelList).toContain("Phone");
    expect(labelList).toContain("Business hours");
    expect(labelList).toContain("Payment methods");
  });

  test("keeps the Japanese street address and drops the static map", () => {
    const address = page.infoList.find((row) => row.label === "Address")?.value;
    expect(address).toBe("\u5175\u5eab\u770c\u795e\u6238\u5e02\u4e2d\u592e\u533a\u4e2d\u5c71\u624b\u901a1-9-24");
    expect(address).not.toContain("maps.googleapis");
    expect(address).not.toContain("Show larger map");
  });

  test("splits the two budget rows by meal", () => {
    const budget = page.infoList.find((row) => row.label.startsWith("Average price"))?.value;
    expect(budget).toContain("Dinner:");
    expect(budget).toContain("Lunch:");
  });

  test("parses weekly hours", () => {
    expect(page.hourList).toHaveLength(1);
    const group = page.hourList[0];
    expect(group?.dayList).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(group?.rangeList[0]?.open).toBe(11 * 60);
    // 3:00 AM next day, kept past midnight rather than wrapping to 180.
    expect(group?.rangeList[0]?.close).toBe(27 * 60);
  });

  test("a closing day becomes a closed group, not an empty one", () => {
    const midnight = parseDetail(fixture("detail-midnight.html"), {
      id: "1000007",
      url: "https://tabelog.com/en/hokkaido/A0101/A010103/1000007/",
      locale: "en",
    });
    const group = midnight.hourList[0];
    expect(group?.rangeList[0]?.open).toBe(17 * 60);
    expect(group?.rangeList[0]?.close).toBe(29 * 60);
  });

  test("award badges are deduplicated and the modal's Japanese copies dropped", () => {
    // /kr/ prints each badge in a tooltip and again inside a modal in Japanese.
    const kr = parseDetail(fixture("detail-kr.html"), {
      id: "1000007",
      url: "https://tabelog.com/kr/hokkaido/A0101/A010103/1000007/",
      locale: "kr",
    });
    const award = kr.infoList.find((row) => row.value.includes("Tabelog"))?.value ?? "";
    const lineList = award.split("\n").filter(Boolean);
    expect(lineList.length).toBe(new Set(lineList).size);
    expect(award).not.toContain("\u767e\u540d\u5e97 \u9078\u51fa\u5e97");
    // Korean day names resolve to the same weekday indexes as the English page.
    expect(kr.hourList).toHaveLength(1);
    expect(kr.hourList[0]?.dayList).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(kr.hourList[0]?.rangeList[0]?.close).toBe(29 * 60);
  });
});

describe("reviews", () => {
  // /en/hyogo/A2801/A280101/28043837/dtlrvwlst/
  const result = parseReviewList(fixture("review-list.html"), { url: "x", page: 1 });

  test("reads a page of reviews with reviewer and spend", () => {
    expect(result.itemList).toHaveLength(20);
    const first = result.itemList[0];
    expect(first?.reviewer).toBeTruthy();
    expect(first?.reviewerUrl).toContain("tabelog.com/rvwr/");
    expect(first?.rating).toBeGreaterThan(0);
    expect(first?.url).toContain("/dtlrvwlst/B");
  });

  test("the reviewer name is not the country badge", () => {
    for (const item of result.itemList) {
      expect(item.reviewer ?? "").not.toContain("Japan");
    }
  });

  test("a page past the end is reported, not served as page N", () => {
    // The list fixture is page 1; asking it to be page 5 must be caught by the pager.
    const wrong = parseReviewList(fixture("review-list.html"), { url: "x", page: 5 });
    expect(wrong.itemList).toHaveLength(0);
    expect(wrong.note).toContain("does not exist");
    expect(wrong.lastPage).toBe(22);
    expect(result.lastPage).toBe(22);
  });

  test("one review page carries every visit with full text", () => {
    const read = parseReviewRead(fixture("review-read.html"), "x");
    expect(read.reviewer).toBe("Umai\u30e2\u30f3");
    expect(read.visitList.length).toBeGreaterThanOrEqual(4);
    const first = read.visitList[0];
    expect(first?.title).toContain("Machida Shoten");
    // The list page shows a truncated excerpt; this is the full body.
    expect((first?.text ?? "").length).toBeGreaterThan(300);
    expect(first?.spend).toBe("JPY 1,000~JPY 1,999");
    expect(first?.imageUrlList[0]).toContain("tblg.k-img.com");
  });
});

describe("menu", () => {
  // /en/hyogo/A2801/A280101/28002413/dtlmenu/
  const result = parseMenu(fixture("menu.html"), { id: "28002413", kind: "food", url: "x" });

  test("reads sections with names and prices", () => {
    expect(result.sectionList[0]?.title).toBe("Noodles");
    const first = result.sectionList[0]?.itemList[0];
    expect(first?.name).toBe("Chinese Soba");
    expect(first?.price).toBe("JPY 700");
    expect(first?.imageUrl).toContain("tblg.k-img.com");
    expect(result.sectionList.flatMap((section) => section.itemList)).toHaveLength(14);
  });

  test("a restaurant with no menu yields no sections, not a throw", () => {
    const empty = parseMenu(fixture("menu-empty.html"), { id: "27000401", kind: "food", url: "x" });
    expect(empty.sectionList).toHaveLength(0);
  });
});

describe("rating", () => {
  // /en/osaka/A2701/A270202/27000401/dtlratings/
  const result = parseRating(fixture("rating.html"), { id: "27000401", url: "x" });

  test("reads per-aspect averages", () => {
    const map = new Map(result.averageList.map((row) => [row.label, row.score]));
    expect(map.get("Overall")).toBeCloseTo(3.93, 2);
    expect(map.get("Food and taste")).toBeCloseTo(3.95, 2);
    expect(map.get("Cost performance")).toBeCloseTo(3.4, 2);
  });

  test("reads the score histogram", () => {
    const top = result.distributionList[0];
    expect(top?.band).toBe("5.0");
    expect(top?.count).toBe(96);
    expect(result.distributionList.reduce((sum, row) => sum + row.count, 0)).toBeGreaterThan(900);
  });

  test("separates dinner and lunch spending", () => {
    expect(result.spendList).toHaveLength(2);
    expect(result.spendList[0]?.label).toContain("dinner");
    expect(result.spendList[1]?.label).toContain("lunch");
    // Distinct histograms, not the same block read twice.
    expect(result.spendList[0]?.bandList).not.toEqual(result.spendList[1]?.bandList);
  });
});

describe("photo", () => {
  // /en/osaka/A2701/A270202/27000401/dtlphotolst/
  const result = parsePhoto(fixture("photo.html"), { id: "27000401", url: "x", page: 1, mode: "all" });

  test("the pager gives the last page and catches an overflow", () => {
    expect(result.lastPage).toBe(374);
    expect(parsePagination(fixture("photo.html"))).toEqual({ current: 1, last: 374 });
    const wrong = parsePhoto(fixture("photo.html"), { id: "27000401", url: "x", page: 999, mode: "all" });
    expect(wrong.itemList).toHaveLength(0);
    expect(wrong.note).toContain("374");
  });

  test("reads 640px images with captions", () => {
    expect(result.itemList).toHaveLength(20);
    expect(result.itemList[0]?.imageUrl).toContain("640x640");
    expect(result.itemList[0]?.by).toBeTruthy();
    expect(result.itemList.every((item) => item.imageUrl.startsWith("https://"))).toBe(true);
  });
});

describe("course", () => {
  // /en/osaka/A2701/A270202/27000401/party/
  const result = parseCourse(fixture("course.html"), { id: "27000401", url: "x" });

  test("reads set menus with price, plan id and badge", () => {
    expect(result.itemList).toHaveLength(3);
    const first = result.itemList[0];
    expect(first?.price).toBe("9,800");
    expect(first?.priceNote).toContain("per person");
    expect(first?.planId).toBe("241493756");
    expect(first?.labelList).toContain("Most popular");
    expect(first?.title).toContain("20 Seasonal Skewers");
    expect(first?.url).toContain("/party/241493756/");
  });
});

describe("seating", () => {
  // /en/hokkaido/A0101/A010103/1079755/table/
  const result = parseSeating(fixture("seating.html"), { id: "1079755", url: "x" });

  test("reads seat kinds with captions", () => {
    const titleList = result.sectionList.map((section) => section.title);
    expect(titleList).toContain("Private room");
    const room = result.sectionList.find((section) => section.title === "Private room");
    expect(room?.itemList[0]?.caption).toContain("6 guests");
    expect(room?.itemList[0]?.imageUrl).toContain("tblg.k-img.com");
  });

  test("an unregistered seat list is empty, not an error", () => {
    const empty = parseSeating(fixture("seating-empty.html"), { id: "13006391", url: "x" });
    expect(empty.sectionList).toHaveLength(0);
  });
});
