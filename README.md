# tabelog-cli

A Tabelog CLI and MCP server. Tabelog has no public API and the Japanese site
sits behind a Cloudflare challenge that rejects anything but a real browser,
but the inbound locales (`tabelog.com/en`, `/kr`, `/tw`, `/th`) are served as
plain server-rendered HTML with schema.org JSON-LD. This reads those. No
browser, no headless Chrome, no runtime dependencies.

What it reads: restaurant search with Tabelog's own filters (area, genre,
keyword, budget band, online-bookable at a date/time/party size) plus two
filters the site does not offer (distance from coordinates, open at a given
time); a restaurant page with structured weekly hours; reviews; the posted
menu; the rating breakdown; photos; and the online-booking calendar with time
slots. Reservation itself stays in the browser.

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

# nearest first from coordinates, within 400 m, and open at that time in Japan.
# both read every result's page (about 2 s for a page of 20)
tabelog search --area Sannomiya --genre ramen --near 34.6946,135.1955 --radius-m 400 --open-at "2026-09-11 14:30"
tabelog search --area Susukino --open-at now

# a restaurant page, by URL or by the id shown in search results
tabelog detail https://tabelog.com/hyogo/A2801/A280101/28043837/
tabelog detail 28043837

# reviews, newest visit first, lunch only
tabelog review 28043837 --by-visit --use-type lunch

# posted menu (food by default; lunch, drink), rating breakdown, photos
tabelog menu 28002413
tabelog menu 28002413 --kind drink
tabelog rating 27000401
tabelog photo 27000401 --mode owner

# online-booking calendar and time slots for a date and party size
tabelog vacancy 27000401 --date 2026-09-11 --people 1 --time 19:00

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
use the nearest station.

Times are Japan time. `--open-at` reads the English page's weekly hours; a
restaurant with no parsable hours is kept and marked unknown, never dropped.
`--near` is straight-line distance and applies to the fetched page only, so
pair it with an area that already narrows the candidates.

## MCP

```bash
tabelog mcp
```

Serves the same commands as MCP tools over stdio: `search`, `detail`,
`review`, `menu`, `rating`, `photo`, `vacancy`, `suggest`. The server is a
hand-written JSON-RPC loop rather than the official SDK, which pulls in a
hundred packages for HTTP transports this never uses. Register it with your
host as command `tabelog`, arguments `["mcp"]`.

## How it reads the site

| Page | Source |
| --- | --- |
| Search | `/{locale}/rstLst/` with the hidden-form parameters the search box submits (`pal`, `LstPrf`, `LstAre`, `station_id`, `area_datatype`, `area_id`, `genre_name`, `sw`, `SrtT`), budget (`RdoCosTp`, `LstCos`, `LstCosT`; bands verified against returned prices) and vacancy (`svd`, `svt`, `svps`, `vac_net=1`). Cards are `list-rst__*` blocks. |
| Area / genre resolution | `/en/suggest/keyword_suggest?keyword=` (XHR-only endpoint, needs `X-Requested-With`). |
| Detail | schema.org `Restaurant` JSON-LD plus the `rstinfo-table` label/value rows, returned in page order. Hours come from `rstinfo-table__business-item` groups (English page). |
| Reviews | `/{path}/dtlrvwlst/?PG=` with `use_type` and `srt=visit`. Cards are `rvw-item__*` blocks. Only the excerpt the list page shows is read. |
| Menu | `/{path}/dtlmenu/`, `/lunch/`, `/drink/`. `rstdtl-menu-lst__*` blocks. |
| Rating | `/{path}/dtlratings/`: `ratings-contents__table` averages, `ratings-contents__item` histograms for score and spending. |
| Photos | `/{path}/dtlphotolst/?PG=&mode=`. `rstdtl-photo-list__item` blocks. |
| Vacancy | `/en/booking/calendar/find_vacancy_date_with_status/`, `find_vacancy/`, `find_vacancy_member_by_date/` JSON, the endpoints behind the reservation modal. Day codes: 0 none, 1 limited, 2 available, 3 closed. |
| Distance / open now | Computed here from each result's JSON-LD coordinates and parsed hours; Tabelog's inbound site has neither filter. |
| Id to URL | `/en/rstdtl/{id}/` redirects to the canonical path; only the path is taken from it. |

If Tabelog changes its markup the parsers here will need to follow. Every
selector is a BEM class name the site has kept stable for years, and each
command fails loudly rather than returning an empty page as success.

## License

MIT
