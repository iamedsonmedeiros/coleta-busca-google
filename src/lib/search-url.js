export const LANGUAGES = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'en', label: 'Inglês' },
  { value: 'es', label: 'Espanhol' },
];

export const COUNTRIES = [
  { value: 'br', label: 'Brasil' },
  { value: 'pt', label: 'Portugal' },
  { value: 'us', label: 'Estados Unidos' },
  { value: 'es', label: 'Espanha' },
  { value: 'mx', label: 'México' },
  { value: 'ar', label: 'Argentina' },
];

export function buildSearchUrl({ term, hl = 'pt-BR', gl = 'br', depersonalized = false }) {
  const host = gl === 'br' ? 'www.google.com.br' : 'www.google.com';
  const url = new URL(`https://${host}/search`);
  url.searchParams.set('q', term.trim());
  url.searchParams.set('hl', hl);
  url.searchParams.set('gl', gl);
  if (depersonalized) {
    url.searchParams.set('pws', '0');
    url.searchParams.set('nfpr', '1');
  }
  return url.toString();
}

// Google pagina de 10 em 10 pelo parâmetro start, independentemente de quantos itens a página mostra.
export function pageFromUrl(href) {
  try {
    const start = Number(new URL(href).searchParams.get('start') || 0);
    return Number.isFinite(start) && start >= 0 ? Math.floor(start / 10) + 1 : null;
  } catch {
    return null;
  }
}
