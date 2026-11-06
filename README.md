# Coleta da Busca Google

A Chrome extension (Manifest V3) for personal use. It opens a Google search for a term, reads the result pages one by one with random pauses, tags each item as organic, ad, AI, map or other, and exports everything to CSV and XLSX.

The collection mirrors the real search result: each block keeps the position where it appeared, and the same site shows up as many times as Google shows it.

The extension interface is in Brazilian Portuguese. Interface labels below are quoted as they appear, with an English translation.

## Installation

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the top right corner. Without it, Chrome disables extensions loaded from a folder.
3. Click **Load unpacked** and pick this folder.
4. To use the non-personalized search, open the extension **Details** and turn on **Allow in Incognito**. The panel has a button that takes you straight to that screen.
5. Pin the icon to the toolbar. Clicking it opens the side panel.

Requires Chrome 116 or newer.

## Usage

1. Enter the search term, the number of pages (1 to 20) and the wait range between pages, in seconds (minimum 3). On every page change the extension picks a random value inside that range.
2. Pick a language and a country. They set the `hl` and `gl` parameters and the domain (`google.com.br` for Brazil, `google.com` for the others).
3. Options:
   - **Sem personalização** (no personalization): opens the search in an incognito window, with no login or history, and adds `pws=0` (turns personalization off) and `nfpr=1` (keeps the term exactly as typed).
   - **Descobrir o endereço real dos links** (find the real link addresses): see the section about links below.
4. Click **Iniciar** (Start). The extension opens its own tab and, for every page, waits for it to load, pauses to "read", collects the items, scrolls down gradually and clicks **Mais**/**Próxima** (More/Next), the way a person would.
5. Follow the preview in the panel and filter it by type. **Pausar** (Pause), **Continuar** (Resume) and **Cancelar** (Cancel) work at any time, and the rows already collected stay available for export.
6. Export to **CSV** or **XLSX**. **Limpar** (Clear) deletes the collection and asks for a second click to confirm.

Keep the panel open while collecting: it keeps the service worker alive. Closing the panel cancels the running collection.

### Captcha and cookie notice

When Google shows a captcha ("unusual traffic") or the cookie consent notice, the collection pauses and the panel explains what to do. Solve it in the search tab and click **Continuar**: the extension rereads the current page and picks up where it stopped.

## Google links and ads

As of 2026, Google replaces result addresses with `/goto?url=<token>` links that only work with the session cookies. With **Descobrir o endereço real dos links** turned on, the extension requests each of those links from inside the search tab itself, one at a time with short pauses, without following the redirect. It only reads the `Location` header of the response and stores the real destination. Links that can't be resolved get an empty URL, and the domain Google displays stays in the `url_exibida` column.

Ad links are never requested, because that would count as a paid click. The ad URL comes from attributes Google already puts on the page (`data-pcu` and `data-dtld`).

With the option off, collection is faster and the file keeps the `/goto` links as they are.

## Exported columns

Column names are in Portuguese.

| Column | Content |
| --- | --- |
| `termo`, `pagina` | Search term and Google page number |
| `posicao_geral` | Cumulative position across all pages, in the main area |
| `posicao_pagina` | Position within the page |
| `posicao_do_tipo` | Cumulative position among items of the same type (e.g. 3rd organic) |
| `area` | `principal` (main column) or `lateral` (right-hand panel) |
| `tipo` | `organico`, `anuncio` (ad), `ia` (AI), `mapa` (map) or `outro` (other) |
| `subtipo` | Type detail (see below) |
| `rotulo` | Block label as Google shows it (e.g. "Patrocinado", "Locais") |
| `titulo`, `url`, `dominio`, `url_exibida`, `trecho` | Item title, URL, domain, displayed URL and snippet |
| `sitelinks` | Internal links of the result, formatted as `title \| url \|\| ...` |
| `fontes` | AI sources, or links from blocks such as videos and news, in the same format |
| `coletado_em` | Local date and time the page was read |

Subtypes:

- **Ad** (`anuncio`): `texto` (text ad), `mapa` (sponsored business in the local block), `shopping`, `outro`.
- **AI** (`ia`): `ia_parcial` when the overview showed up collapsed, with a "Show more" button. The exported text is what was visible.
- **Map** (`mapa`): `local`.
- **Other** (`outro`): `snippet` (featured snippet), `paa` (People also ask), `video`, `noticia` (news), `imagens` (images), `shopping`, `discussoes` (discussions and forums), `buscas_relacionadas` (related searches), `conhecimento` (knowledge panel), `desconhecido` (unknown).

The CSV uses UTF-8 with BOM, `;` as separator and CRLF line breaks, so it opens straight in Excel with Portuguese regional settings. The XLSX has the sheets Todos (all), Organicos, Anuncios, IA, Mapas and Outros.

## Known limitations

- Google changes its HTML often. The extractor relies mostly on structure and visible text, and a few internal class names are kept as a fallback in `FALLBACK`, at the top of `src/lib/extract.js`. If the log reports "nenhum item reconhecido" (no item recognized) for a page, the layout has probably changed.
- Results depend on IP and location. The non-personalized search removes the account and history, but the IP region still has an influence. Choosing another country sets `gl`, and an IP in that country (e.g. through a VPN) gets closer to what a local user sees.
- Short intervals and many pages raise the chance of a captcha.
- A collection reads up to 20 pages.

## Development

```bash
npm install
npm test
```

The tests run the extractor and the export in Node with `linkedom`, against the synthetic page in `tests/fixtures/serp.html`.

Layout:

- `manifest.json`: permissions and side panel.
- `src/background/service-worker.js`: drives the collection (tabs, waits, pagination, pausing, link resolution).
- `src/lib/extract.js`: reads the Google page. It is injected into the tab on every page.
- `src/lib/rows.js`, `src/lib/export.js`, `src/lib/search-url.js`: row assembly, CSV/XLSX and the search URL.
- `src/sidepanel/`: side panel.

## Licenses

`vendor/xlsx.mini.min.js` is [SheetJS Community Edition](https://sheetjs.com) 0.20.3, distributed under the Apache 2.0 license.
