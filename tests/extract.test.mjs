import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { finalizeRows, redirectsToResolve } from '../src/lib/rows.js';

await import('../src/lib/extract.js');
const { extract, findNext, detectBlock } = globalThis.SerpPage;

const html = await readFile(new URL('./fixtures/serp.html', import.meta.url), 'utf8');
const BASE = 'https://www.google.com.br/search?q=dentista+campinas';
const opts = { baseUrl: BASE, isVisible: (el) => !el.closest('[hidden]') };

function load(markup = html) {
  return parseHTML(markup).document;
}

const RESOLVED = new Map([
  ['https://www.google.com.br/goto?url=TOKEN123', 'https://www.cifrado.com.br/clinica/implante'],
  ['https://www.google.com.br/goto?url=FONTE1', 'https://www.vanish.com.br/mancha'],
  ['https://www.google.com.br/goto?url=FONTE2', 'https://www.vanish.com.br/mancha'],
]);

const rows = (resolved = RESOLVED) => finalizeRows(extract(load(), opts), resolved);

test('segue a ordem visual e marca cada tipo', () => {
  const main = rows().filter((r) => r.area === 'principal');
  assert.deepEqual(
    main.map((r) => [r.posicao_pagina, r.tipo, r.subtipo]),
    [
      [1, 'anuncio', 'texto'],
      [2, 'anuncio', 'texto'],
      [3, 'ia', 'ia_parcial'],
      [4, 'organico', ''],
      [5, 'mapa', 'local'],
      [6, 'mapa', 'local'],
      [7, 'anuncio', 'mapa'],
      [8, 'outro', 'video'],
      [9, 'outro', 'paa'],
      [10, 'organico', ''],
      [11, 'organico', ''],
      [12, 'organico', ''],
      [13, 'organico', ''],
      [14, 'anuncio', 'texto'],
      [15, 'outro', 'buscas_relacionadas'],
    ],
  );
});

test('mantém o mesmo site em posições diferentes, inclusive a mesma URL', () => {
  const organic = rows().filter((r) => r.tipo === 'organico');
  assert.deepEqual(
    organic.map((r) => r.url),
    [
      'https://www.exemplo.com.br/dentistas',
      'https://www.exemplo.com.br/clinicas',
      'https://doctoralia.com.br/dentista/campinas',
      'https://www.cifrado.com.br/clinica/implante',
      'https://www.exemplo.com.br/dentistas',
    ],
  );
  assert.equal(organic.filter((r) => r.dominio === 'exemplo.com.br').length, 3);
});

test('links /goto do Google viram o destino real', () => {
  const extracted = extract(load(), opts);
  assert.deepEqual(redirectsToResolve(extracted), [
    'https://www.google.com.br/goto?url=FONTE1',
    'https://www.google.com.br/goto?url=FONTE2',
    'https://www.google.com.br/goto?url=VIDEO1',
    'https://www.google.com.br/goto?url=TOKEN123',
  ]);
  const cifrado = rows().find((r) => r.titulo === 'Página com link cifrado');
  assert.equal(cifrado.url, 'https://www.cifrado.com.br/clinica/implante');
  assert.equal(cifrado.dominio, 'cifrado.com.br');
});

test('nunca pede o link de um anúncio', () => {
  const ad = { tipo: 'anuncio', url: 'https://www.google.com.br/goto?url=AD', fontes: [], sitelinks: [] };
  assert.deepEqual(redirectsToResolve([ad]), []);
});

test('sem resolução, a linha mantém o domínio exibido e fica sem URL', () => {
  const cifrado = rows(new Map()).find((r) => r.titulo === 'Página com link cifrado');
  assert.equal(cifrado.url, '');
  assert.equal(cifrado.dominio, 'cifrado.com.br');
  assert.equal(cifrado.url_exibida, 'https://www.cifrado.com.br › clinica');
});

test('sitelinks ficam na linha do resultado pai', () => {
  const first = rows().find((r) => r.tipo === 'organico');
  assert.equal(first.titulo, 'Dentistas em Campinas - Exemplo');
  assert.equal(first.url_exibida, 'www.exemplo.com.br › dentistas');
  assert.equal(first.trecho, 'Lista completa de dentistas em Campinas com avaliações.');
  assert.equal(
    first.sitelinks,
    'Implante | https://www.exemplo.com.br/implante || Clareamento | https://www.exemplo.com.br/clareamento',
  );
});

test('anúncios usam a URL de destino, ignoram o diálogo oculto e guardam o rótulo', () => {
  const [ad] = rows().filter((r) => r.tipo === 'anuncio');
  assert.equal(ad.rotulo, 'Patrocinado');
  assert.equal(ad.titulo, 'Clínica Sorriso - Avaliação grátis');
  assert.equal(ad.url, 'https://clinica-sorriso.com.br/promo');
  assert.equal(ad.url_exibida, 'www.clinica-sorriso.com.br');
  assert.equal(ad.sitelinks, 'Contato | https://clinica-sorriso.com.br/contato');
});

test('IA guarda o texto visível e as fontes externas sem repetir destino', () => {
  const ia = rows().find((r) => r.tipo === 'ia');
  assert.equal(ia.titulo, 'Visão geral criada por IA');
  assert.match(ia.trecho, /^Em Campinas há muitas clínicas/);
  assert.equal(ia.fontes, 'Guia Saúde | https://guia-saude.com.br/campinas || Vanish | https://www.vanish.com.br/mancha');
});

test('mapa gera uma linha por estabelecimento e separa o patrocinado', () => {
  const local = rows().filter((r) => r.subtipo === 'local' || r.subtipo === 'mapa');
  assert.deepEqual(
    local.map((r) => [r.tipo, r.titulo, r.url, r.rotulo]),
    [
      ['mapa', 'Dr. João Odontologia', 'https://drjoao.com.br/', 'Locais'],
      ['mapa', 'Sorriso Feliz', 'https://www.google.com/maps?cid=222', 'Locais'],
      ['anuncio', 'Dra. Ana Implantes', 'https://dra-ana.com.br/', 'Patrocinado · Locais'],
    ],
  );
});

test('perguntas, vídeos e buscas relacionadas entram como outro', () => {
  const all = rows();
  assert.equal(all.find((r) => r.subtipo === 'paa').trecho, 'Quanto custa um dentista em Campinas? || Qual o melhor dentista de Campinas?');
  assert.equal(all.find((r) => r.subtipo === 'video').titulo, 'Vídeos');
  assert.equal(all.find((r) => r.subtipo === 'buscas_relacionadas').trecho, 'dentista 24h campinas || dentista barato campinas');
});

test('barra lateral fica fora da numeração', () => {
  const lateral = rows().filter((r) => r.area === 'lateral');
  assert.equal(lateral.length, 1);
  assert.equal(lateral[0].subtipo, 'conhecimento');
  assert.equal(lateral[0].posicao_pagina, null);
  assert.equal(lateral[0].url, 'https://cro.org.br/');
});

test('ignora blocos ocultos e contêineres de anúncio vazios', () => {
  const all = rows();
  assert.ok(!all.some((r) => r.titulo === 'Resultado oculto'));
  assert.equal(all.filter((r) => r.tipo === 'anuncio' && !r.titulo).length, 0);
});

test('encontra o botão Próxima', () => {
  assert.equal(findNext(load()).getAttribute('id'), 'pnnext');
  const noNext = load(html.replace(/<a id="pnnext"[^>]*>Próxima<\/a>/, ''));
  assert.equal(findNext(noNext), null);
});

test('reconhece captcha e aviso de cookies', () => {
  const sorry = load('<html><body><form id="captcha-form"></form></body></html>');
  assert.equal(detectBlock(sorry, { pathname: '/sorry/index', hostname: 'www.google.com' }).reason, 'captcha');
  assert.equal(detectBlock(load(), { pathname: '/search', hostname: 'consent.google.com' }).reason, 'consentimento');
  assert.equal(detectBlock(load(), { pathname: '/search', hostname: 'www.google.com.br' }), null);
});
