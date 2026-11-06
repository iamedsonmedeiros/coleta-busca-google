import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { COLUMNS, toCsv, toXlsx, buildFileName } from '../src/lib/export.js';
import { buildSearchUrl, pageFromUrl } from '../src/lib/search-url.js';

vm.runInThisContext(await readFile(new URL('../vendor/xlsx.mini.min.js', import.meta.url), 'utf8'));
const { XLSX } = globalThis;

const rows = [
  { termo: 'café', pagina: 1, posicao_geral: 1, tipo: 'anuncio', titulo: 'Loja; "promo"', url: 'https://a.com' },
  { termo: 'café', pagina: 1, posicao_geral: 2, tipo: 'organico', titulo: 'A', url: 'https://a.com/x', trecho: 'linha 1\nlinha 2' },
  { termo: 'café', pagina: 2, posicao_geral: 3, tipo: 'organico', titulo: 'A de novo', url: 'https://a.com/x' },
];

test('CSV tem BOM, ponto e vírgula e aspas escapadas', () => {
  const csv = toCsv(rows);
  assert.ok(csv.startsWith('\uFEFF'));
  const [header, first] = csv.slice(1).split('\r\n');
  assert.equal(header, COLUMNS.join(';'));
  assert.ok(first.includes('"Loja; ""promo"""'));
  assert.ok(csv.includes('"linha 1\nlinha 2"'));
});

test('XLSX tem uma aba geral e uma por tipo', () => {
  const wb = XLSX.read(toXlsx(rows, XLSX), { type: 'array' });
  assert.deepEqual(wb.SheetNames, ['Todos', 'Organicos', 'Anuncios', 'IA', 'Mapas', 'Outros']);
  const all = XLSX.utils.sheet_to_json(wb.Sheets.Todos);
  assert.equal(all.length, 3);
  assert.equal(all[2].url, 'https://a.com/x');
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets.Organicos).length, 2);
  const emptyHeader = XLSX.utils.sheet_to_json(wb.Sheets.IA, { header: 1 })[0];
  assert.deepEqual(emptyHeader, COLUMNS);
});

test('nome do arquivo leva termo e data', () => {
  assert.equal(buildFileName('Café em São Paulo!', new Date(2026, 9, 23, 9, 5), 'csv'), 'busca-google-cafe-em-sao-paulo-20261023-0905.csv');
});

test('URL da busca sem personalização', () => {
  const normal = new URL(buildSearchUrl({ term: ' dentista ', hl: 'pt-BR', gl: 'br' }));
  assert.equal(normal.host, 'www.google.com.br');
  assert.equal(normal.searchParams.get('q'), 'dentista');
  assert.equal(normal.searchParams.get('pws'), null);
  const anon = new URL(buildSearchUrl({ term: 'dentist', hl: 'en', gl: 'us', depersonalized: true }));
  assert.equal(anon.host, 'www.google.com');
  assert.equal(anon.searchParams.get('pws'), '0');
  assert.equal(anon.searchParams.get('nfpr'), '1');
  assert.equal(anon.searchParams.get('filter'), null);
});

test('página derivada do parâmetro start', () => {
  assert.equal(pageFromUrl('https://www.google.com/search?q=x'), 1);
  assert.equal(pageFromUrl('https://www.google.com/search?q=x&start=20'), 3);
});
