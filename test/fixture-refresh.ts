#!/usr/bin/env bun
import { gzipSync } from "bun";

/**
 * Re-captures every fixture from the live site. Run it when Tabelog changes
 * its markup and the parser tests go red, then read the diff in the failing
 * assertions: values that legitimately changed (a score, a review count) get
 * updated in the test, a field that vanished means the parser needs work.
 *
 *   bun test/fixture-refresh.ts
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const HTML = { "user-agent": UA, accept: "text/html" };
const JSON_XHR = {
  "user-agent": UA,
  accept: "application/json",
  "x-requested-with": "XMLHttpRequest",
  referer: "https://tabelog.com/en/",
};

const FIXTURE_LIST: { name: string; url: string; kind: "html" | "json" }[] = [
  {
    name: "search-en",
    url: "https://tabelog.com/en/rstLst/?SrtT=rt&pal=hyogo&LstPrf=A2801&LstAre=A280101&station_id=4483&area_datatype=RailroadStation&area_id=4483&genre_name=MC01",
    kind: "html",
  },
  {
    name: "search-empty",
    url: "https://tabelog.com/en/rstLst/?SrtT=rt&pal=hyogo&LstPrf=A2801&LstAre=A280101&station_id=4483&area_datatype=RailroadStation&area_id=4483&sw=zzzzqqqqxxxx",
    kind: "html",
  },
  { name: "detail-en", url: "https://tabelog.com/en/hyogo/A2801/A280101/28043837/", kind: "html" },
  { name: "detail-kr", url: "https://tabelog.com/kr/hokkaido/A0101/A010103/1000007/", kind: "html" },
  { name: "detail-midnight", url: "https://tabelog.com/en/hokkaido/A0101/A010103/1000007/", kind: "html" },
  {
    name: "review-list",
    url: "https://tabelog.com/en/hyogo/A2801/A280101/28043837/dtlrvwlst/?PG=1&lc=0&rvw_part=all&smp=1&use_type=0",
    kind: "html",
  },
  {
    name: "review-read",
    url: "https://tabelog.com/en/hyogo/A2801/A280101/28043837/dtlrvwlst/B486164563/",
    kind: "html",
  },
  { name: "menu", url: "https://tabelog.com/en/hyogo/A2801/A280101/28002413/dtlmenu/", kind: "html" },
  { name: "menu-empty", url: "https://tabelog.com/en/osaka/A2701/A270202/27000401/dtlmenu/", kind: "html" },
  { name: "rating", url: "https://tabelog.com/en/osaka/A2701/A270202/27000401/dtlratings/", kind: "html" },
  { name: "photo", url: "https://tabelog.com/en/osaka/A2701/A270202/27000401/dtlphotolst/", kind: "html" },
  { name: "nearby", url: "https://tabelog.com/en/hokkaido/A0101/A010103/1077287/peripheral_map/", kind: "html" },
  { name: "course", url: "https://tabelog.com/en/osaka/A2701/A270202/27000401/party/", kind: "html" },
  { name: "seating", url: "https://tabelog.com/en/hokkaido/A0101/A010103/1079755/table/", kind: "html" },
  { name: "seating-empty", url: "https://tabelog.com/en/tokyo/A1309/A130904/13006391/table/", kind: "html" },
  { name: "ranking", url: "https://tabelog.com/en/hokkaido/A0101/A010103/rank/", kind: "html" },
  { name: "suggest", url: "https://tabelog.com/en/suggest/keyword_suggest?keyword=Sannomiya", kind: "json" },
  {
    name: "suggest-genre",
    url: "https://tabelog.com/en/suggest/keyword_suggest?keyword=%E4%B8%B2%E3%82%AB%E3%83%84",
    kind: "json",
  },
  {
    name: "station-suggest",
    url: "https://tabelog.com/web-api/v1/search-suggestions/area?area=%E3%81%99%E3%81%99%E3%81%8D%E3%81%AE",
    kind: "json",
  },
  {
    name: "vacancy-date",
    url: "https://tabelog.com/en/booking/calendar/find_vacancy_date_with_status/?rst_id=27000401&svd=20260911&svps=1",
    kind: "json",
  },
  {
    name: "vacancy-slot",
    url: "https://tabelog.com/en/booking/calendar/find_vacancy/?rst_id=27000401&svd=20260911&svps=1&svt=1900",
    kind: "json",
  },
  {
    name: "vacancy-member",
    url: "https://tabelog.com/en/booking/calendar/find_vacancy_member_by_date/?rst_id=27000401&svd=20260911",
    kind: "json",
  },
];

const directory = new URL("./fixture/", import.meta.url).pathname;
for (const item of FIXTURE_LIST) {
  const res = await fetch(item.url, { headers: item.kind === "json" ? JSON_XHR : HTML });
  const body = await res.text();
  if (!res.ok || body.includes("<title>Just a moment...</title>")) {
    console.error(`skip ${item.name}: HTTP ${res.status}`);
    continue;
  }
  await Bun.write(`${directory}${item.name}.${item.kind}.gz`, gzipSync(new TextEncoder().encode(body)));
  console.log(`${item.name}: ${body.length} bytes`);
}
