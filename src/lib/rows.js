const MAX_SOURCES = 10;

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isGoogleRedirect(url) {
  const u = parseUrl(url);
  return Boolean(u && /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(u.hostname) && u.pathname === '/goto');
}

function domainOf(url) {
  const u = parseUrl(url);
  return u ? u.hostname.replace(/^www\./i, '') : '';
}

// Só a URL principal de cada linha e as primeiras fontes da IA: cada /goto custa um pedido ao Google.
// Anúncios ficam de fora: pedir o link deles conta como clique pago para o anunciante.
export function redirectsToResolve(rows) {
  const urls = new Set();
  for (const r of rows) {
    if (r.tipo === 'anuncio') continue;
    if (isGoogleRedirect(r.url)) urls.add(r.url);
    if (r.tipo === 'ia') {
      for (const f of r.fontes.filter((l) => isGoogleRedirect(l.url)).slice(0, MAX_SOURCES)) urls.add(f.url);
    }
  }
  return [...urls];
}

function joinLinks(list) {
  return list.map((l) => (l.url ? `${l.title} | ${l.url}` : l.title)).filter(Boolean).join(' || ');
}

// Troca os /goto resolvidos pelo destino; os que ficaram sem resposta somem, sobrando só o título.
export function finalizeRows(rows, resolved = new Map()) {
  const fix = (url) => (isGoogleRedirect(url) ? resolved.get(url) || '' : url);
  return rows.map((r) => {
    const url = fix(r.url);
    const seen = new Set();
    const fontes = r.fontes
      .map((l) => ({ title: l.title, url: fix(l.url) }))
      .filter((l) => {
        const key = l.url || l.title;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return {
      ...r,
      url,
      dominio: url && url !== r.url ? domainOf(url) : r.dominio,
      sitelinks: joinLinks(r.sitelinks.map((l) => ({ title: l.title, url: fix(l.url) }))),
      fontes: joinLinks(fontes),
    };
  });
}
