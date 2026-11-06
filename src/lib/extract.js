// Roda dentro da aba do Google (via chrome.scripting) e também no Node, nos testes.
// Script clássico, sem import/export, para poder ser injetado como arquivo.
(() => {
  const LABELS = {
    ai: /(vis[aã]o geral (criada )?(por|de|com) ia|ai overview|resumen (creado|generado) (con|por) ia)/i,
    sponsored: /^(patrocinad[oa]s?|sponsored|an[uú]ncios?|ads?)$/i,
    paa: /(as pessoas tamb[eé]m perguntam|outras perguntas|people also ask|otras preguntas|preguntas relacionadas)/i,
    local: /^(locais|lugares|empresas|resultados locais|places|businesses|sitios|negocios)\b/i,
    related: /(as pessoas tamb[eé]m pesquisam|pesquisas relacionadas|buscas relacionadas|outras pessoas pesquisaram|related searches|people also search|b[uú]squedas relacionadas)/i,
    snippet: /(sobre trechos em destaque|about featured snippets|acerca de los fragmentos destacados)/i,
    video: /^(v[ií]deos?( curtos)?|short videos)\b/i,
    news: /^(principais not[ií]cias|not[ií]cias|top stories|news|noticias destacadas)\b/i,
    images: /^(imagens|images|im[aá]genes)\b/i,
    shopping: /^(produtos|compras|shopping|products|ofertas)\b/i,
    discussions: /^(discuss[oõ]es e f[oó]runs|discussions and forums|debates y foros)\b/i,
    showMore: /^(mostrar mais|ver mais|show more|mostrar m[aá]s)$/i,
    website: /^(site|website|sitio web)$/i,
  };

  // Classes ofuscadas do Google: servem só de reserva e mudam sem aviso.
  const FALLBACK = {
    resultCard: '.MjjYud',
    snippet: '.VwiC3b, [data-sncf], .ITZIwc',
    adDisplayUrl: '.x2VHCd, span[role="text"]',
    adDescription: '.Va3FIb',
    localItem: '.VkpGBb',
    localDetails: '.rllt__details',
    localName: '.dbg0pd, .OSrXXb',
    inlineSitelinks: '.HiHjCd a',
    featuredText: '.hgKElc',
  };

  const LEAF_REGIONS = ['tads', 'bottomads', 'tadsb', 'bres'];
  const AD_REGIONS = ['tads', 'bottomads', 'tadsb'];
  const CONTAINER_REGIONS = ['rso', 'tvcap', 'botstuff', ...LEAF_REGIONS];
  const SKIP = '#foot, [role="navigation"], #appbar, #result-stats, #slim_appbar, script, style, noscript, template';
  const HIDDEN_UI = '[role="dialog"], g-dialog';
  const MAX_CELL = 32000;
  const MAX_SOURCES = 10;

  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const text = (el) => {
    if (!el) return '';
    return clean(typeof el.innerText === 'string' ? el.innerText : el.textContent);
  };

  function defaultIsVisible(el) {
    const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    if (style) {
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      // Wrappers com display: contents não têm caixa própria; os filhos são avaliados um a um.
      if (style.display === 'contents') return true;
    }
    if (typeof el.getClientRects !== 'function') return true;
    return [...el.getClientRects()].some((r) => r.width > 0 || r.height > 0);
  }

  function isGoogleHost(host) {
    return /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(host) || /(^|\.)(googleadservices|gstatic|googleusercontent)\.com$/i.test(host);
  }

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  // Links /goto?url=<token> são o redirecionamento cifrado do Google: o destino só aparece no cabeçalho Location.
  function isGoogleRedirect(url) {
    const u = parseUrl(url);
    return Boolean(u && isGoogleHost(u.hostname) && u.pathname === '/goto');
  }

  function domainOf(url) {
    const u = parseUrl(url);
    return u && !isGoogleRedirect(url) ? u.hostname.replace(/^www\./i, '') : '';
  }

  function domainFromDisplay(display) {
    const m = clean(display).match(/^(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i);
    return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
  }

  function makeContext(doc, opts) {
    const isVisible = opts.isVisible || defaultIsVisible;
    const baseUrl = opts.baseUrl || doc.location?.href || 'https://www.google.com/';

    function resolveHref(a) {
      const raw = a?.getAttribute?.('href');
      if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return '';
      let u;
      try {
        u = new URL(raw, baseUrl);
      } catch {
        return '';
      }
      if (isGoogleHost(u.hostname)) {
        const target = u.searchParams.get('q') || u.searchParams.get('url') || u.searchParams.get('adurl');
        if (['/url', '/interstitial', '/aclk', '/pagead/aclk'].includes(u.pathname) && target && /^https?:/i.test(target)) {
          return target;
        }
      }
      return u.toString();
    }

    function adHref(a) {
      const pcu = a?.getAttribute?.('data-pcu');
      if (pcu) return pcu.split(',')[0].trim();
      return resolveHref(a);
    }

    function isOutbound(url) {
      const u = parseUrl(url);
      return Boolean(u && (!isGoogleHost(u.hostname) || isGoogleRedirect(url)));
    }

    function visibleKids(el) {
      return [...el.children].filter((c) => !c.matches(SKIP) && isVisible(c));
    }

    function links(el, { outboundOnly = true } = {}) {
      const seen = new Set();
      const out = [];
      for (const a of el.querySelectorAll('a[href]')) {
        if (!isVisible(a) || a.closest(HIDDEN_UI)) continue;
        const url = a.hasAttribute('data-pcu') ? adHref(a) : resolveHref(a);
        if (!url || (outboundOnly && !isOutbound(url)) || seen.has(url)) continue;
        seen.add(url);
        const own = text(a);
        const aria = clean(a.getAttribute('aria-label'));
        const title = text(a.querySelector('h3, [role="heading"]')) || (aria.length > own.length ? aria : own);
        out.push({ title: title.slice(0, 160), url, el: a });
      }
      return out;
    }

    function blockLabel(block) {
      for (const h of block.querySelectorAll('[role="heading"], h1, h2, h3, h4')) {
        if (h.closest('a') || h.closest(HIDDEN_UI) || !isVisible(h)) continue;
        const t = text(h);
        if (t && t.length <= 80) return t;
      }
      return '';
    }

    function pickHeading(el) {
      const candidates = [...el.querySelectorAll('h3, [role="heading"]')].filter(
        (h) => !h.closest(HIDDEN_UI) && isVisible(h) && text(h),
      );
      return candidates.find((h) => h.tagName === 'H3' || h.getAttribute('aria-level') === '3') || candidates[0] || null;
    }

    function findLabelEl(block, regex) {
      for (const el of block.querySelectorAll('span, div')) {
        if (el.children.length > 2 || el.closest('h3, a') || el.closest(HIDDEN_UI)) continue;
        const t = text(el);
        if (t.length <= 14 && regex.test(t) && isVisible(el)) return t;
      }
      return '';
    }

    function longestText(root, exclude = []) {
      let best = '';
      for (const el of root.querySelectorAll('div, span')) {
        if (el.querySelector('h3, cite, [role="heading"]') || el.closest(HIDDEN_UI)) continue;
        if (exclude.some((x) => x && (x === el || x.contains(el)))) continue;
        if (!isVisible(el)) continue;
        const t = text(el);
        if (t.length > best.length) best = t;
      }
      return best;
    }

    return { isVisible, resolveHref, adHref, isOutbound, visibleKids, links, blockLabel, pickHeading, findLabelEl, longestText };
  }

  function outermost(els) {
    return els.filter((el) => !els.some((other) => other !== el && other.contains(el)));
  }

  const plainLinks = (list) => list.map(({ title, url }) => ({ title, url }));

  function row(fields) {
    return {
      area: 'principal',
      tipo: 'outro',
      subtipo: '',
      rotulo: '',
      titulo: '',
      url: '',
      dominio: '',
      url_exibida: '',
      trecho: '',
      sitelinks: [],
      fontes: [],
      ...fields,
    };
  }

  // Divide a página em blocos de nível superior, na ordem do documento (= ordem visual).
  function segmentMain(ctx, root) {
    const blocks = [];
    const regionSelector = CONTAINER_REGIONS.map((id) => `#${id}`).join(', ');

    function listBlocks(container, depth) {
      const kids = ctx.visibleKids(container);
      if (kids.length === 1 && depth < 6 && !kids[0].matches(`${FALLBACK.resultCard}, .g`) && ctx.visibleKids(kids[0]).length >= 2) {
        listBlocks(kids[0], depth + 1);
        return;
      }
      for (const k of kids) {
        const nested = outermost([...k.querySelectorAll(FALLBACK.resultCard)]);
        if (!k.matches(FALLBACK.resultCard) && nested.length >= 2 && depth < 6) listBlocks(k, depth + 1);
        else blocks.push(k);
      }
    }

    function walk(el) {
      for (const child of ctx.visibleKids(el)) {
        if (child.id === 'rhs') continue;
        if (child.id === 'rso') listBlocks(child, 0);
        else if (LEAF_REGIONS.includes(child.id)) blocks.push(child);
        else if (child.matches(regionSelector) || child.querySelector(regionSelector)) walk(child);
        else blocks.push(child);
      }
    }

    walk(root);
    return blocks;
  }

  function pickCite(container) {
    const cites = [...container.querySelectorAll('cite')].map(text).filter(Boolean);
    return cites.find((c) => domainFromDisplay(c)) || cites[0] || '';
  }

  function organicUnits(ctx, block) {
    const units = [];
    const titles = [...block.querySelectorAll('h3')].filter((h) => h.closest('a[href]') && ctx.isVisible(h));
    for (const h3 of titles) {
      let card = h3.closest('a[href]');
      while (card && card !== block && !card.querySelector('cite')) card = card.parentElement;
      card = card || block;
      const owner = units.find((u) => card.contains(u.h3));
      if (owner) owner.sitelinkTitles.push(h3);
      else units.push({ h3, sitelinkTitles: [] });
    }
    for (const unit of units) {
      let container = unit.h3;
      while (container.parentElement && container.parentElement !== block && !units.some((u) => u !== unit && container.parentElement.contains(u.h3))) {
        container = container.parentElement;
      }
      unit.container = units.length === 1 ? block : container;
    }
    return units;
  }

  function organicRow(ctx, unit, fields = {}) {
    const anchor = unit.h3.closest('a[href]');
    const url = ctx.resolveHref(anchor);
    const display = pickCite(unit.container);
    const sitelinkAnchors = unit.sitelinkTitles.map((h) => h.closest('a[href]'));
    const sitelinks = unit.sitelinkTitles.map((h) => ({ title: text(h), url: ctx.resolveHref(h.closest('a[href]')) }));
    const known = new Set([url, ...sitelinks.map((s) => s.url)]);
    for (const a of unit.container.querySelectorAll(FALLBACK.inlineSitelinks)) {
      const href = ctx.resolveHref(a);
      if (href && !known.has(href) && ctx.isOutbound(href) && ctx.isVisible(a)) {
        known.add(href);
        sitelinks.push({ title: text(a), url: href });
      }
    }
    const snippetEl = [...unit.container.querySelectorAll(FALLBACK.snippet)].find(
      (el) => ctx.isVisible(el) && !sitelinkAnchors.some((a) => a?.contains(el) || el.contains(a)),
    );
    const trecho = snippetEl ? text(snippetEl) : ctx.longestText(unit.container, [anchor, ...sitelinkAnchors]);
    return row({
      tipo: 'organico',
      titulo: text(unit.h3),
      url,
      dominio: domainOf(url) || domainFromDisplay(display),
      url_exibida: display,
      trecho,
      sitelinks,
      ...fields,
    });
  }

  function textAdRow(ctx, ad, label) {
    const heading = ctx.pickHeading(ad);
    const anchor = heading?.querySelector('a[href]') || heading?.closest('a[href]') || ad.querySelector('a[data-pcu], a[href]');
    const url = ctx.adHref(anchor);
    const title = text(heading) || text(anchor);
    const display = [...ad.querySelectorAll(FALLBACK.adDisplayUrl)].map(text).find(Boolean) || anchor?.getAttribute('data-dtld') || '';
    const descriptions = [...ad.querySelectorAll(FALLBACK.adDescription)].map(text).filter((t) => t && t !== title);
    const trecho = descriptions.sort((a, b) => b.length - a.length)[0] || ctx.longestText(ad, [heading, ...ad.querySelectorAll('a[data-pcu]')]);
    const sitelinks = ctx.links(ad).filter((l) => l.url !== url && !l.el.hasAttribute('data-pcu'));
    return row({
      tipo: 'anuncio',
      subtipo: 'texto',
      rotulo: ctx.findLabelEl(ad, LABELS.sponsored) || label || 'Patrocinado',
      titulo: title,
      url,
      dominio: domainOf(url) || domainFromDisplay(display),
      url_exibida: display,
      trecho,
      sitelinks: plainLinks(sitelinks),
    });
  }

  function adRows(ctx, block, label) {
    const textAds = outermost([...block.querySelectorAll('[data-text-ad]')]).filter(ctx.isVisible);
    if (block.matches('[data-text-ad]')) textAds.unshift(block);
    if (textAds.length) return textAds.map((ad) => textAdRow(ctx, ad, label));
    const list = ctx.links(block);
    if (!list.length && !text(block)) return [];
    return [
      row({
        tipo: 'anuncio',
        subtipo: /(R\$|US\$|€|\$)\s?\d/.test(text(block)) ? 'shopping' : 'outro',
        rotulo: label || 'Patrocinado',
        titulo: ctx.blockLabel(block) || label || 'Patrocinado',
        url: list[0]?.url || '',
        dominio: domainOf(list[0]?.url || ''),
        fontes: plainLinks(list),
      }),
    ];
  }

  function aiRow(ctx, block, title) {
    const label = title || ctx.blockLabel(block) || 'Visão geral criada por IA';
    let body = text(block.querySelector('#m-x-content') || block);
    if (body.startsWith(label)) body = body.slice(label.length).trim();
    const partial = [...block.querySelectorAll('[role="button"], button, div, span')].some(
      (el) => el.children.length <= 2 && LABELS.showMore.test(text(el)) && ctx.isVisible(el) && !el.closest(HIDDEN_UI),
    );
    return row({
      tipo: 'ia',
      subtipo: partial ? 'ia_parcial' : '',
      rotulo: label,
      titulo: label,
      trecho: body,
      fontes: plainLinks(ctx.links(block)).slice(0, MAX_SOURCES * 3),
    });
  }

  function localRows(ctx, block, label) {
    let items = [...block.querySelectorAll(FALLBACK.localItem)];
    if (!items.length) items = [...block.querySelectorAll(FALLBACK.localDetails)].map((d) => d.closest('[data-cid], [role="button"]') || d.parentElement);
    if (!items.length) items = [...block.querySelectorAll('[data-cid]')];
    items = outermost(items).filter(ctx.isVisible);
    if (!items.length) {
      return [row({ tipo: 'mapa', subtipo: 'local', rotulo: label, titulo: label || 'Mapa', trecho: text(block).slice(0, 500), fontes: plainLinks(ctx.links(block)) })];
    }
    return items.map((item) => {
      // O card do estabelecimento e os botões "Site"/"Rotas" costumam ser irmãos dentro do mesmo item da lista.
      const scope = item.parentElement && item.parentElement !== block && outermost([...item.parentElement.querySelectorAll(FALLBACK.localDetails)]).length === 1 ? item.parentElement : item;
      const nameEl = item.querySelector(`${FALLBACK.localName}, [role="heading"]`);
      const name = text(nameEl) || text(item).split(' ').slice(0, 6).join(' ');
      const sponsored = ctx.findLabelEl(item, LABELS.sponsored);
      let trecho = text(item.querySelector(FALLBACK.localDetails) || item);
      if (sponsored && trecho.startsWith(sponsored)) trecho = trecho.slice(sponsored.length).trim();
      if (trecho.startsWith(name)) trecho = trecho.slice(name.length).trim();
      if (sponsored) {
        // O "Site" do anúncio local é um /aclk (clique pago, sem destino legível): fica só o domínio declarado.
        const adRoot = item.closest('[data-dtld], [data-is-ad]') || scope;
        const adLink = adRoot.querySelector('a[data-pcu]');
        const url = adLink ? ctx.adHref(adLink) : '';
        const declared = adRoot.getAttribute('data-dtld') || '';
        return row({
          tipo: 'anuncio',
          subtipo: 'mapa',
          rotulo: `${sponsored} · ${label || 'Mapa'}`,
          titulo: name,
          url,
          dominio: domainOf(url) || declared.replace(/^www\./, ''),
          url_exibida: declared,
          trecho,
        });
      }
      const all = ctx.links(scope, { outboundOnly: false });
      const site = all.find((l) => LABELS.website.test(l.title) && ctx.isOutbound(l.url)) || all.find((l) => ctx.isOutbound(l.url));
      const cid = item.getAttribute('data-cid') || item.querySelector('[data-cid]')?.getAttribute('data-cid');
      const maps = all.find((l) => /\/maps/.test(l.url));
      const url = site?.url || maps?.url || (cid ? `https://www.google.com/maps?cid=${cid}` : '');
      return row({ tipo: 'mapa', subtipo: 'local', rotulo: label, titulo: name, url, dominio: site ? domainOf(site.url) : '', trecho });
    });
  }

  function classifyBlock(ctx, block, pendingAiTitle) {
    const blockText = text(block);
    if (!blockText) return [];
    const label = ctx.blockLabel(block);

    if (pendingAiTitle) return [aiRow(ctx, block, pendingAiTitle)];
    if (AD_REGIONS.includes(block.id) || block.closest('#tads, #bottomads, #tadsb') || block.matches('[data-text-ad]') || block.querySelector('[data-text-ad]')) {
      return adRows(ctx, block, ctx.findLabelEl(block, LABELS.sponsored));
    }
    if (block.querySelector('#m-x-content') || LABELS.ai.test(label)) return [aiRow(ctx, block, LABELS.ai.test(label) ? label : '')];
    const isLocal = block.querySelector(`${FALLBACK.localItem}, ${FALLBACK.localDetails}`) || LABELS.local.test(label);
    if (!isLocal) {
      const sponsored = ctx.findLabelEl(block, LABELS.sponsored);
      if (sponsored && !block.querySelector('h3')) return adRows(ctx, block, sponsored);
    }
    if (block.querySelector('.related-question-pair, [data-q]') || LABELS.paa.test(label)) {
      let questions = [...block.querySelectorAll('[data-q]')].map((el) => clean(el.getAttribute('data-q')));
      if (!questions.length) questions = [...block.querySelectorAll('.related-question-pair, [aria-expanded]')].map(text);
      return [row({ subtipo: 'paa', rotulo: label, titulo: label || 'As pessoas também perguntam', trecho: [...new Set(questions.filter(Boolean))].join(' || ') })];
    }
    if (block.id === 'bres' || LABELS.related.test(label)) {
      const terms = ctx.links(block, { outboundOnly: false }).map((l) => l.title).filter(Boolean);
      return [row({ subtipo: 'buscas_relacionadas', rotulo: label, titulo: label || 'Buscas relacionadas', trecho: terms.join(' || ') })];
    }
    const headed = [
      ['video', LABELS.video],
      ['noticia', LABELS.news],
      ['imagens', LABELS.images],
      ['shopping', LABELS.shopping],
      ['discussoes', LABELS.discussions],
    ].find(([, re]) => re.test(label));
    if (headed) {
      const list = ctx.links(block);
      return [row({ subtipo: headed[0], rotulo: label, titulo: label, url: list[0]?.url || '', dominio: domainOf(list[0]?.url || ''), fontes: plainLinks(list) })];
    }
    if (isLocal) return localRows(ctx, block, label);
    if (LABELS.snippet.test(blockText)) {
      const units = organicUnits(ctx, block);
      if (units.length) {
        const r = organicRow(ctx, units[0], { tipo: 'outro', subtipo: 'snippet', rotulo: 'Trecho em destaque' });
        const answer = text(block.querySelector(FALLBACK.featuredText));
        if (answer) r.trecho = answer;
        return [r];
      }
    }
    const units = organicUnits(ctx, block);
    if (units.length) return units.map((u) => organicRow(ctx, u));
    const list = ctx.links(block);
    if (!list.length) return [];
    return [row({ subtipo: 'desconhecido', rotulo: label, titulo: label || list[0].title, url: list[0].url, dominio: domainOf(list[0].url), trecho: blockText.slice(0, 500), fontes: plainLinks(list) })];
  }

  function lateralRows(ctx, rhs) {
    if (!rhs || !ctx.isVisible(rhs) || !text(rhs)) return [];
    const sponsored = ctx.findLabelEl(rhs, LABELS.sponsored);
    if (sponsored) return adRows(ctx, rhs, sponsored).map((r) => ({ ...r, area: 'lateral' }));
    const list = ctx.links(rhs);
    const official = rhs.querySelector('[data-attrid="visit_official_site"] a[href], a[data-attrid="visit_official_site"]');
    const url = official ? ctx.resolveHref(official) : list[0]?.url || '';
    return [
      row({
        area: 'lateral',
        subtipo: 'conhecimento',
        rotulo: 'Painel de conhecimento',
        titulo: text(rhs.querySelector('[data-attrid="title"]')) || ctx.blockLabel(rhs),
        url,
        dominio: domainOf(url),
        trecho: text(rhs.querySelector('[data-attrid="description"], .kno-rdesc')),
        fontes: plainLinks(list),
      }),
    ];
  }

  function extract(doc, opts = {}) {
    const ctx = makeContext(doc, opts);
    const root = doc.querySelector('#rcnt') || doc.querySelector('#center_col') || doc.querySelector('#main') || doc.body;
    const rows = [];
    let pendingAiTitle = '';
    for (const block of segmentMain(ctx, root)) {
      const t = text(block);
      if (!block.querySelector('a[href]') && t.length <= 80 && LABELS.ai.test(t)) {
        pendingAiTitle = t;
        continue;
      }
      rows.push(...classifyBlock(ctx, block, pendingAiTitle));
      pendingAiTitle = '';
    }
    rows.forEach((r, i) => {
      r.posicao_pagina = i + 1;
    });
    const lateral = lateralRows(ctx, doc.querySelector('#rhs')).map((r) => ({ ...r, posicao_pagina: null }));
    return [...rows, ...lateral].map((r) => {
      for (const k of Object.keys(r)) if (typeof r[k] === 'string' && r[k].length > MAX_CELL) r[k] = r[k].slice(0, MAX_CELL);
      return r;
    });
  }

  function detectBlock(doc, loc) {
    const captcha = { reason: 'captcha', message: 'O Google pediu uma verificação (captcha). Resolva na aba da busca e clique em Continuar.' };
    if ((loc.pathname || '').startsWith('/sorry')) return captcha;
    if (doc.querySelector('#captcha-form, form[action*="sorry"], iframe[src*="recaptcha"]')) return captcha;
    const hasResults = doc.querySelector('#search, #rso, #botstuff');
    if (!hasResults && /tr[aá]fego incomum|unusual traffic|n[aã]o sou um rob[oô]|not a robot/i.test(text(doc.body).slice(0, 5000))) return captcha;
    const consentDialog = [...doc.querySelectorAll('[role="dialog"], form[action*="consent"]')].find(
      (el) => defaultIsVisible(el) && /antes de continuar|before you continue|antes de ir a google/i.test(text(el)),
    );
    if ((loc.hostname || '').startsWith('consent.') || consentDialog) {
      return { reason: 'consentimento', message: 'O Google abriu o aviso de cookies. Escolha uma opção na aba da busca e clique em Continuar.' };
    }
    return null;
  }

  function findNext(doc) {
    const direct = doc.querySelector('a#pnnext[href]');
    if (direct) return direct;
    const pageLinks = [...doc.querySelectorAll('a[href*="start="]')];
    return (
      pageLinks.find((a) => /^(pr[oó]xima|p[aá]gina seguinte|next|siguiente)/i.test(clean(a.getAttribute('aria-label')))) ||
      pageLinks.find((a) => /^(pr[oó]xima|mais|next|siguiente)$/i.test(text(a))) ||
      null
    );
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function clickNext() {
    const link = findNext(document);
    if (!link) return false;
    const steps = 3 + Math.floor(Math.random() * 3);
    for (let i = 1; i <= steps; i++) {
      window.scrollTo({ top: (document.documentElement.scrollHeight * i) / steps, behavior: 'smooth' });
      await wait(350 + Math.random() * 650);
    }
    link.scrollIntoView({ block: 'center', behavior: 'smooth' });
    await wait(400 + Math.random() * 800);
    // O clique sai depois do retorno: a navegação derruba o contexto do script.
    setTimeout(() => link.click(), 50);
    return true;
  }

  // Pede cada /goto sem seguir o redirecionamento; o service worker lê o Location pelo webRequest.
  // Roda na aba para usar os cookies da sessão (inclusive anônima), aos quais o token está preso.
  async function requestRedirects(urls, minGap = 250, maxGap = 700) {
    let done = 0;
    for (const url of urls) {
      try {
        await fetch(url, { redirect: 'manual', credentials: 'include', cache: 'no-store' });
        done++;
      } catch {
        // Falha de rede: a linha fica sem URL resolvida.
      }
      await wait(minGap + Math.random() * (maxGap - minGap));
    }
    return done;
  }

  function inspect() {
    const blocked = detectBlock(document, location);
    if (blocked) return { blocked, url: location.href, rows: [], hasNext: false };
    return { blocked: null, url: location.href, rows: extract(document), hasNext: Boolean(findNext(document)) };
  }

  globalThis.SerpPage = { extract, detectBlock, findNext, clickNext, inspect, requestRedirects };
})();
