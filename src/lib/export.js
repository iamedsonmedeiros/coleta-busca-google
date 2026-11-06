export const COLUMNS = [
  'termo',
  'pagina',
  'posicao_geral',
  'posicao_pagina',
  'posicao_do_tipo',
  'area',
  'tipo',
  'subtipo',
  'rotulo',
  'titulo',
  'url',
  'dominio',
  'url_exibida',
  'trecho',
  'sitelinks',
  'fontes',
  'coletado_em',
];

export const TYPE_LABELS = {
  organico: 'Orgânico',
  anuncio: 'Anúncio',
  ia: 'IA',
  mapa: 'Mapa',
  outro: 'Outro',
};

const SHEETS = [
  ['Todos', null],
  ['Organicos', 'organico'],
  ['Anuncios', 'anuncio'],
  ['IA', 'ia'],
  ['Mapas', 'mapa'],
  ['Outros', 'outro'],
];

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// BOM e ponto e vírgula: é o que o Excel em português espera para abrir acentos e colunas certos.
export function toCsv(rows) {
  const lines = [COLUMNS.join(';'), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(';'))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function toXlsx(rows, XLSX = globalThis.XLSX) {
  const wb = XLSX.utils.book_new();
  for (const [name, tipo] of SHEETS) {
    const subset = tipo ? rows.filter((r) => r.tipo === tipo) : rows;
    const data = subset.map((r) => Object.fromEntries(COLUMNS.map((c) => [c, r[c] ?? ''])));
    const ws = XLSX.utils.json_to_sheet(data, { header: COLUMNS });
    if (!data.length) XLSX.utils.sheet_add_aoa(ws, [COLUMNS], { origin: 'A1' });
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
}

export function buildFileName(term, date, ext) {
  const slug =
    String(term || 'busca')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'busca';
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  return `busca-google-${slug}-${stamp}.${ext}`;
}
