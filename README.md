# tabelog-cli

A Tabelog CLI and MCP server. Tabelog has no public API and the Japanese site
sits behind a Cloudflare challenge that rejects anything but a real browser,
but the inbound locales (`tabelog.com/en`, `/kr`, `/tw`, `/th`) are served as
plain server-rendered HTML with schema.org JSON-LD. This reads those. No
browser, no headless Chrome, no runtime dependencies.

Four things it does: search restaurants by area, genre and keyword; read a
restaurant page; list its reviews; and resolve a keyword through Tabelog's own
suggest index so you can see what an area or cuisine name maps to.

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

# a restaurant page, by URL or by the id shown in search results
tabelog detail https://tabelog.com/hyogo/A2801/A280101/28043837/
tabelog detail 28043837

# reviews, newest visit first, lunch only
tabelog review 28043837 --by-visit --use-type lunch

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
Japanese one and switch `--locale kr` for Korean output.

## MCP

```bash
tabelog mcp
```

Serves the same four commands as MCP tools over stdio (`search`, `detail`,
`review`, `suggest`). The server is a hand-written JSON-RPC loop rather than the
official SDK, which pulls in a hundred packages for HTTP transports this never
uses. Register it with your host as command `tabelog`, arguments `["mcp"]`.

## How it reads the site

| Page | Source |
| --- | --- |
| Search | `/{locale}/rstLst/` with the hidden-form parameters the search box submits (`pal`, `LstPrf`, `LstAre`, `station_id`, `area_datatype`, `area_id`, `genre_name`, `sw`, `SrtT`). Cards are `list-rst__*` blocks. |
| Area / genre resolution | `/en/suggest/keyword_suggest?keyword=` (XHR-only endpoint, needs `X-Requested-With`). |
| Detail | schema.org `Restaurant` JSON-LD plus the `rstinfo-table` label/value rows, returned in page order. |
| Reviews | `/{locale}/{path}/dtlrvwlst/?PG=` with `use_type` and `srt=visit`. Cards are `rvw-item__*` blocks. Only the excerpt the list page shows is read. |
| Id to URL | `/en/rstdtl/{id}/` redirects to the canonical path; only the path is taken from it. |

If Tabelog changes its markup the parsers here will need to follow. Every
selector is a BEM class name the site has kept stable for years, and each
command fails loudly rather than returning an empty page as success.

## License

MIT
