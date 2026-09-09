# tabelog-cli

A Tabelog CLI and MCP server. Tabelog has no public API and the Japanese site
sits behind a Cloudflare challenge that rejects anything but a real browser,
but the inbound locales (`tabelog.com/en`, `/kr`, `/tw`, `/cn`, `/th`) are served as
plain server-rendered HTML with schema.org JSON-LD. This reads those. No
browser, no headless Chrome, no runtime dependencies.

What it reads: restaurant search with Tabelog's own filters (area, genre,
keyword, budget band, online-bookable at a date/time/party size) plus filters
the site does not offer (radius around coordinates, open at a given time,
minimum score or review count, feature tags, private room, parking); a
restaurant page with structured weekly hours; reviews, including one
reviewer's full text; the posted menu; the rating breakdown; photos; the
online-booking calendar with time slots; set menus and the seat list; a
place's popularity ranking; Tabelog's own nearest-restaurants list around a
restaurant; and coordinates resolved to a Tabelog area. Reservation itself
stays in the browser.

## Install

Requires [Bun](https://bun.sh).

```bash
bun install
bun link   # registers the global `tabelog` command
```

## Usage

```bash
# top ramen around Sannomiya station, Tabelog score order
tabelog search --area Sannomiya --genre ramen

# Japanese works for both filters and free text; --page walks 20 at a time
tabelog search --area 三宮 --keyword 焼鳥 --page 2

# other orderings the inbound site offers
tabelog search --area Namba --genre okonomiyaki --sort access     # most viewed by overseas visitors
tabelog search --area Namba --genre okonomiyaki --sort reserved   # most reserved

# budget per person (dinner by default), snapped to Tabelog's bands
tabelog search --area Sannomiya --genre ramen --budget-max 999
tabelog search --area Ginza --genre sushi --budget-meal lunch --budget-min 5000 --budget-max 9999

# only places with an online-bookable table then
tabelog search --area Sapporo --genre sushi --vacancy-date 2026-09-11 --vacancy-time 19:00 --vacancy-people 1

# radius around a point. --near alone picks the area itself: the nearest railway
# station Tabelog knows. Pages are walked one at a time (5 by default, up to 10)
# and the walk stops once --limit restaurants (20) are inside the circle
tabelog search --near 43.0553,141.3532 --radius-m 300 --genre sushi
tabelog search --near 34.6687,135.5013 --radius-m 200 --open-at now --limit 10

# open at a Japan wall-clock time, and the cheap card-level filters
tabelog search --area Susukino --open-at "2026-09-12 19:00" --min-rating 3.5 --min-review-count 100
tabelog search --area Susukino --genre ジンギスカン --feature "non smoking,credit card" --order review_count
tabelog search --area Susukino --award            # Tabelog Award / Tabelog 100 holders only

# facilities from each restaurant's own page
tabelog search --area Sapporo --genre sushi --private-room --parking

# a restaurant page, by URL or by the id shown in search results
tabelog detail https://tabelog.com/hyogo/A2801/A280101/28043837/
tabelog detail 28043837

# reviews, newest visit first, lunch only; then one reviewer's full text
tabelog review 28043837 --by-visit --use-type lunch
tabelog review-read https://tabelog.com/en/hyogo/A2801/A280101/28043837/dtlrvwlst/B486164563/

# posted menu (food by default; lunch, drink), rating breakdown, photos
tabelog menu 28002413
tabelog menu 28002413 --kind drink
tabelog rating 27000401
tabelog photo 27000401 --mode owner

# online-booking calendar and time slots for a date and party size
tabelog vacancy 27000401 --date 2026-09-11 --people 1 --time 19:00

# set menus with prices and conditions, and the seat list
tabelog course 27000401
tabelog seating 1079755

# Tabelog's own popularity ranking for a place (not the score order)
tabelog ranking Susukino

# Tabelog's own 25 nearest restaurants around one place, with distances
tabelog nearby 1077287
tabelog nearby 1077287 --genre ramen --pages 2

# which Tabelog areas a GPS point falls in
tabelog locate 43.0553,141.3532

# what does a word resolve to?
tabelog suggest Sannomiya

# Korean page text (names, categories, transport); filters resolve the same way
tabelog search --area Namba --genre okonomiyaki --locale kr
TABELOG_LOCALE=kr tabelog detail 28043837

# machine-readable output for any command
tabelog search --area Sannomiya --genre ramen --json
```

Area and genre names are matched against the suggest index, which knows English
and Japanese names only. A Korean area name returns nothing; use the English or
Japanese one and switch `--locale kr` for Korean output. Genres are pickier
than areas: the index has Tabelog's own labels, so `串カツ` resolves where
`kushikatsu` does not. A genre that fails to resolve is searched as a keyword
instead, and the result header says so. Landmarks (Dotonbori) are not areas;
use the nearest station or pass `--near` with its coordinates.

Times are Japan time. `--open-at` reads each restaurant's weekly hours (any
locale; day names are normalised); a restaurant with no parsable hours is kept
and marked unknown, never dropped.
`--near`, `--open-at`, `--private-room` and `--parking` each read every
result's page, roughly two seconds per page of twenty, once per restaurant per
process. Distances are straight-line and the radius applies only to the pages
actually read: Tabelog orders the list by score, not by distance, so a radius
search walks pages sequentially and stops when `--limit` are inside; the
header says how many pages it read and when raising `--pages` is worth it.
Page numbers past the end of a list (photos, reviews) are reported as such
rather than silently serving page 1 again.

## MCP

```bash
tabelog mcp
```

Serves the same commands as MCP tools over stdio: `search`, `detail`,
`review`, `review_read`, `menu`, `rating`, `photo`, `vacancy`, `course`,
`seating`, `ranking`, `nearby`, `locate`, `suggest`. The server is a hand-written JSON-RPC loop rather than the
official SDK, which pulls in a hundred packages for HTTP transports this never
uses. Register it with your host as command `tabelog`, arguments `["mcp"]`.

## How it reads the site

| Page | Source |
| --- | --- |
| Search | `/{locale}/rstLst/` with the hidden-form parameters the search box submits (`pal`, `LstPrf`, `LstAre`, `station_id`, `area_datatype`, `area_id`, `genre_name`, `sw`, `SrtT`), budget (`RdoCosTp`, `LstCos`, `LstCosT`; bands verified against returned prices) and vacancy (`svd`, `svt`, `svps`, `vac_net=1`). Cards are `list-rst__*` blocks. |
| Area / genre resolution | `/en/suggest/keyword_suggest?keyword=` (XHR-only endpoint, needs `X-Requested-With`). |
| Detail | schema.org `Restaurant` JSON-LD plus the `rstinfo-table` label/value rows, returned in page order. Hours come from `rstinfo-table__business-item` groups (English page). |
| Reviews | `/{path}/dtlrvwlst/?PG=` with `use_type` and `srt=visit`. Cards are `rvw-item__*` blocks; the list page carries only an excerpt, so full text comes from `/{path}/dtlrvwlst/B{bookmark}/`. |
| Menu | `/{path}/dtlmenu/`, `/lunch/`, `/drink/`. `rstdtl-menu-lst__*` blocks. |
| Rating | `/{path}/dtlratings/`: `ratings-contents__table` averages, `ratings-contents__item` histograms for score and spending. |
| Photos | `/{path}/dtlphotolst/?PG=&mode=`. `rstdtl-photo-list__item` blocks. |
| Vacancy | `/en/booking/calendar/find_vacancy_date_with_status/`, `find_vacancy/`, `find_vacancy_member_by_date/` JSON, the endpoints behind the reservation modal. Day codes: 0 none, 1 limited, 2 available, 3 closed. |
| Courses | `/{path}/party/`: `rstdtl-course-list__*` blocks. The plan id on the reserve button is the one the booking form takes. |
| Seating | `/{path}/table/`: `rstdtl-table-lst__*` blocks, grouped by seat kind. |
| Ranking | `/{locale}/{pal}/{LstPrf}/{LstAre}/rank/`, top 20, same card markup as search. Prefecture, city and area only; no station, no genre, one page. |
| Nearby | `/{path}/peripheral_map/{page}/{genre}/`, Tabelog's own nearest list: five per page, up to five pages, with the pins' coordinates in `data-gmaps-lat` / `data-gmaps-lng`. |
| Coordinates to area | Railway stations from OpenStreetMap (Overpass), each verified against `web-api/v1/search-suggestions/area` on the Japanese site (which returns station coordinates and shares station ids with the inbound index) and then resolved to a filter. No station near falls back to Nominatim's ward/city. |
| Distance / open now / facilities | Computed here from each result's JSON-LD coordinates, parsed hours and info-table rows; Tabelog's inbound site has none of these filters. |
| Id to URL | `/en/rstdtl/{id}/` redirects to the canonical path; only the path is taken from it. |

Coordinate search is the one thing Tabelog itself cannot do: `lat`/`lon`
parameters are ignored by the list page, and the JP-only radius search sits
behind the Cloudflare challenge. So an area still bounds every search, and the
radius is applied afterwards from real coordinates. When a card's own
"Station 450m" is measured from the same station the point was measured
against, it bounds the distance and the card is skipped without a fetch.

If Tabelog changes its markup the parsers here will need to follow. Every
selector is a BEM class name the site has kept stable for years, and each
command fails loudly rather than returning an empty page as success.

Restaurant pages are cached in memory for the life of the process, so a search
that filters on distance, opening hours and facilities at once still fetches
each restaurant once. Nothing is written to disk.

## Tests

```bash
bun test                 # parsers against captured pages, plus the time and geo logic
bun run check            # typecheck, lint and test
bun run fixture:refresh  # re-capture every fixture from the live site
```

The fixtures under `test/fixture/` are real Tabelog pages, gzipped. The tests
assert values a user would notice going missing (this restaurant's score, that
price, the address, a menu item) rather than that an array is non-empty, so a
regex that still matches but grabs the neighbouring element fails. That is not
hypothetical: `classText` used a `\b` boundary, which made `list-rst__price`
match `list-rst__price-tax`, and the test for it is what found the bug.

## License

MIT
