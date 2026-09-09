import { describe, expect, test } from "bun:test";
import { distanceM, parseGeoPoint } from "../src/geo";
import { openStatusAt, parseHourList } from "../src/hour";
import { attrOf, classText, decodeEntity, jsonLdList, pickAll, splitBy, textOf, toNumber } from "../src/html";
import { dayIndexOf, formatMinute, parseJapanTime, toSvd, toSvt } from "../src/time";
import { fixture } from "./fixture";

/**
 * Logic that does not touch the network: time and hour arithmetic, geometry and
 * the HTML helpers every parser is built on.
 */

describe("japan time", () => {
  test("reads a date and time as Japan wall time, not the machine's zone", () => {
    const at = parseJapanTime("2026-09-11 19:30");
    expect(at.svd).toBe("20260911");
    expect(at.minute).toBe(19 * 60 + 30);
    expect(at.day).toBe(5);
    expect(at.label).toBe("2026-09-11 Fri 19:30 JST");
  });

  test("accepts the shapes a caller is likely to send", () => {
    expect(parseJapanTime("2026-09-11T19:30").minute).toBe(1170);
    expect(parseJapanTime("20260911 1930").svd).toBe("20260911");
    expect(parseJapanTime("2026-09-11").minute).toBe(0);
  });

  test("rejects what it cannot read instead of guessing", () => {
    expect(() => parseJapanTime("tomorrow evening")).toThrow();
    expect(() => parseJapanTime("2026-09-11 99:99")).toThrow();
    expect(() => toSvd("11/09/2026")).toThrow();
    expect(() => toSvt("7pm")).toThrow();
  });

  test("normalises to the parameters Tabelog takes", () => {
    expect(toSvd("2026-09-11")).toBe("20260911");
    expect(toSvt("9:05")).toBe("0905");
    expect(toSvt("1900")).toBe("1900");
    expect(formatMinute(27 * 60)).toBe("03:00");
    expect(dayIndexOf("Wed")).toBe(3);
    expect(dayIndexOf("Public Holiday")).toBeUndefined();
  });

  test("weekday labels from every locale map to the same index", () => {
    // kr, tw/cn, th as the hours table prints them; Japanese long form for good measure.
    expect(dayIndexOf("\uc218")).toBe(3);
    expect(dayIndexOf("\u661f\u671f\u4e09")).toBe(3);
    expect(dayIndexOf("\u661f\u671f\u65e5")).toBe(0);
    expect(dayIndexOf("\u0e1e\u0e38\u0e18")).toBe(3);
    expect(dayIndexOf("\u0e2d\u0e32\u0e17\u0e34\u0e15\u0e22\u0e4c")).toBe(0);
    expect(dayIndexOf("\u6c34\u66dc\u65e5")).toBe(3);
    expect(dayIndexOf("\uc218\uc694\uc77c")).toBe(3);
    expect(dayIndexOf("\uacf5\ud734\uc77c")).toBeUndefined();
  });
});

describe("business hours", () => {
  const hourList = parseHourList(fixture("detail-midnight.html")); // open 17:00-05:00 daily
  const sannomiya = parseHourList(fixture("detail-en.html")); // open 11:00-03:00 daily

  test("a range past midnight covers the small hours of the next day", () => {
    expect(openStatusAt(hourList, parseJapanTime("2026-09-13 03:00"))).toBe("open");
    expect(openStatusAt(hourList, parseJapanTime("2026-09-13 20:00"))).toBe("open");
    expect(openStatusAt(hourList, parseJapanTime("2026-09-13 12:00"))).toBe("closed");
    // 05:00 is the close, so the minute itself is shut.
    expect(openStatusAt(hourList, parseJapanTime("2026-09-13 05:00"))).toBe("closed");
  });

  test("boundaries are inclusive at open and exclusive at close", () => {
    expect(openStatusAt(sannomiya, parseJapanTime("2026-09-11 11:00"))).toBe("open");
    expect(openStatusAt(sannomiya, parseJapanTime("2026-09-11 10:59"))).toBe("closed");
  });

  test("no parsable hours is unknown, never closed", () => {
    expect(openStatusAt([], parseJapanTime("2026-09-11 12:00"))).toBe("unknown");
    expect(
      openStatusAt(
        [{ title: "Public Holiday", dayList: [], closed: false, rangeList: [] }],
        parseJapanTime("2026-09-11 12:00"),
      ),
    ).toBe("unknown");
  });

  test("a closing day reads as closed for that weekday only", () => {
    // Rokukaku tei: open Mon, Tue, Thu-Sun 17:00-22:00, closed Wednesday.
    const rokukaku = parseHourList(fixture("course.html"));
    expect(openStatusAt(rokukaku, parseJapanTime("2026-09-10 19:00"))).toBe("open");
    expect(openStatusAt(rokukaku, parseJapanTime("2026-09-09 19:00"))).toBe("closed");
  });
});

describe("geo", () => {
  test("distance matches a known pair", () => {
    // Sannomiya station to Kobe city hall, about 500 m.
    const metre = distanceM({ latitude: 34.6949, longitude: 135.1951 }, { latitude: 34.6901, longitude: 135.1955 });
    expect(metre).toBeGreaterThan(450);
    expect(metre).toBeLessThan(600);
  });

  test("the same point is zero and coordinates round-trip", () => {
    const point = parseGeoPoint("43.0553,141.3532");
    expect(distanceM(point, point)).toBe(0);
    expect(parseGeoPoint(" 43.0553 141.3532 ")).toEqual(point);
  });

  test("rejects out-of-range or unreadable coordinates", () => {
    expect(() => parseGeoPoint("91,0")).toThrow();
    expect(() => parseGeoPoint("0,181")).toThrow();
    expect(() => parseGeoPoint("Susukino")).toThrow();
  });
});

describe("html helpers", () => {
  test("text drops tags, decodes entities and keeps line structure", () => {
    expect(textOf("<p>a &amp; b<br />c</p>")).toBe("a & b\nc");
    expect(textOf("  <span>  spaced   out  </span> ")).toBe("spaced out");
    expect(decodeEntity("&#x30fc;&quot;&#39;")).toBe("\u30fc\"'");
  });

  test("class text takes the matching element, not a prefix match", () => {
    const html = '<p class="a-title-extra">wrong</p><p class="a-title">right</p>';
    expect(classText(html, "a-title")).toBe("right");
  });

  test("attributes and numbers", () => {
    expect(attrOf('<a href="/x" data-id="7">', "data-id")).toBe("7");
    expect(attrOf("<a>", "href")).toBeUndefined();
    expect(toNumber("2,370")).toBe(2370);
    expect(toNumber("-")).toBeUndefined();
    expect(toNumber(undefined)).toBeUndefined();
  });

  test("splitting on a marker drops what comes before the first one", () => {
    expect(splitBy("headerXaXb", "X")).toEqual(["Xa", "Xb"]);
    expect(splitBy("nothing", "X")).toEqual([]);
  });

  test("pickAll skips empties and JSON-LD survives a malformed block", () => {
    expect(pickAll("<i>a</i><i></i><i>b</i>", /<i>([\s\S]*?)<\/i>/g)).toEqual(["a", "b"]);
    const html =
      '<script type="application/ld+json">{oops</script><script type="application/ld+json">{"@type":"X"}</script>';
    expect(jsonLdList(html)).toEqual([{ "@type": "X" }]);
  });
});
