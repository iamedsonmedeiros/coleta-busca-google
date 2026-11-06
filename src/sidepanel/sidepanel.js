import { LANGUAGES, COUNTRIES } from '../lib/search-url.js';
import { TYPE_LABELS, toCsv, toXlsx, buildFileName } from '../lib/export.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'settings';
const ACTIVE = ['running', 'waiting'];
const STATUS_LABELS = {
  idle: 'Pronto',
  running: 'Coletando',
  waiting: 'Aguardando',
  paused: 'Pausado',
  done: 'Concluído',
  cancelled: 'Interrompido',
  error: 'Atenção',
};
const FIELDS = ['term', 'pages', 'minDelay', 'maxDelay', 'hl', 'gl', 'depersonalized', 'resolveLinks'];
const CHECKBOXES = ['depersonalized', 'resolveLinks'];

let port = null;
let current = { status: 'idle', rows: [], pagesRead: [], log: [], config: null };
let filter = 'todos';
let lastRowsRef = null;
let clearArmedUntil = 0;

function fillSelect(select, options) {
  for (const { value, label } of options) select.add(new Option(label, value));
}

function readForm() {
  return {
    term: $('term').value.trim(),
    pages: Number($('pages').value),
    minDelay: Number($('minDelay').value),
    maxDelay: Number($('maxDelay').value),
    hl: $('hl').value,
    gl: $('gl').value,
    depersonalized: $('depersonalized').checked,
    resolveLinks: $('resolveLinks').checked,
  };
}

async function loadSettings() {
  const saved = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] || {};
  for (const key of FIELDS) {
    if (saved[key] === undefined) continue;
    if (CHECKBOXES.includes(key)) $(key).checked = Boolean(saved[key]);
    else $(key).value = saved[key];
  }
}

function saveSettings() {
  chrome.storage.local.set({ [SETTINGS_KEY]: readForm() });
}

async function refreshIncognitoHint() {
  const needs = $('depersonalized').checked;
  const allowed = needs ? await chrome.extension.isAllowedIncognitoAccess() : true;
  $('incognitoHint').hidden = allowed;
}

function send(type, extra = {}) {
  try {
    port?.postMessage({ type, ...extra });
  } catch {
    connect();
    port.postMessage({ type, ...extra });
  }
}

function connect() {
  port = chrome.runtime.connect({ name: 'panel' });
  port.onMessage.addListener((msg) => {
    if (msg.type !== 'state') return;
    current = msg.state;
    render();
  });
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connect, 500);
  });
}

function countsByType(rows) {
  const counts = { todos: rows.length };
  for (const tipo of Object.keys(TYPE_LABELS)) counts[tipo] = 0;
  for (const r of rows) counts[r.tipo] = (counts[r.tipo] || 0) + 1;
  return counts;
}

function renderFilters(rows) {
  const counts = countsByType(rows);
  const box = $('filters');
  box.replaceChildren();
  for (const [key, label] of [['todos', 'Todos'], ...Object.entries(TYPE_LABELS)]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(filter === key));
    b.textContent = `${label} ${counts[key] || 0}`;
    b.addEventListener('click', () => {
      filter = key;
      lastRowsRef = null;
      render();
    });
    box.append(b);
  }
}

function safeHref(url) {
  return /^https?:\/\//i.test(url || '') ? url : null;
}

function renderTable(rows) {
  const visible = filter === 'todos' ? rows : rows.filter((r) => r.tipo === filter);
  $('empty').hidden = visible.length > 0;
  $('empty').textContent = rows.length ? 'Nenhum item deste tipo.' : 'Nenhum item coletado ainda.';
  $('table').hidden = visible.length === 0;
  const body = $('tbody');
  body.replaceChildren();
  for (const r of visible) {
    const tr = document.createElement('tr');

    const pos = document.createElement('td');
    pos.textContent = r.posicao_geral ?? '—';
    pos.title = r.area === 'lateral' ? 'Barra lateral: fora da numeração' : `Posição ${r.posicao_pagina} na página`;

    const page = document.createElement('td');
    page.textContent = r.pagina;

    const type = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.dataset.tipo = r.tipo;
    badge.textContent = TYPE_LABELS[r.tipo] || r.tipo;
    if (r.subtipo) {
      const sub = document.createElement('small');
      sub.textContent = r.subtipo.replace(/_/g, ' ');
      badge.append(sub);
    }
    type.append(badge);

    const title = document.createElement('td');
    const label = r.titulo || r.rotulo || '(sem título)';
    const href = safeHref(r.url);
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = label;
      title.append(a);
    } else {
      title.append(label);
    }
    const detail = document.createElement('span');
    detail.className = 'domain';
    detail.textContent = r.dominio || (r.trecho ? r.trecho.slice(0, 140) : '');
    if (detail.textContent) title.append(detail);

    tr.append(pos, page, type, title);
    body.append(tr);
  }
}

function renderLog(log) {
  const list = $('log');
  list.replaceChildren(
    ...log.map((e) => {
      const li = document.createElement('li');
      li.textContent = `${e.at.slice(11)} — ${e.text}`;
      return li;
    }),
  );
}

function renderStatus() {
  const s = current;
  const total = s.config?.pages || 0;
  const read = s.pagesRead?.length || 0;
  $('status').dataset.status = s.status;
  $('statusLabel').textContent = STATUS_LABELS[s.status] || s.status;
  $('progressText').textContent = total ? `Página ${read} de ${total} · ${s.rows.length} itens` : '';
  $('progress').max = total || 1;
  $('progress').value = read;
  let message = s.message || '';
  if (s.status === 'waiting' && s.nextAt) {
    const secs = Math.max(0, Math.ceil((s.nextAt - Date.now()) / 1000));
    message = `${message} Próxima em ${secs} s.`;
  }
  $('message').textContent = message;
}

function render() {
  const s = current;
  const active = ACTIVE.includes(s.status);
  const paused = s.status === 'paused';

  for (const key of FIELDS) $(key).disabled = active;
  $('startBtn').disabled = active;
  $('pauseBtn').hidden = !active;
  $('resumeBtn').hidden = !paused;
  $('cancelBtn').hidden = !(active || paused);

  const hasRows = s.rows.length > 0;
  $('csvBtn').disabled = !hasRows || active;
  $('xlsxBtn').disabled = !hasRows || active;
  $('clearBtn').disabled = !hasRows || active;

  renderStatus();
  if (s.rows !== lastRowsRef) {
    lastRowsRef = s.rows;
    renderFilters(s.rows);
    renderTable(s.rows);
  }
  renderLog(s.log || []);
}

async function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } catch (err) {
    $('message').textContent = `Não foi possível salvar o arquivo: ${err?.message || err}`;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function exportCsv() {
  const name = buildFileName(current.config?.term, new Date(), 'csv');
  download(new Blob([toCsv(current.rows)], { type: 'text/csv;charset=utf-8' }), name);
}

function exportXlsx() {
  const name = buildFileName(current.config?.term, new Date(), 'xlsx');
  const data = toXlsx(current.rows);
  download(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
}

async function onSubmit(event) {
  event.preventDefault();
  const config = readForm();
  if (config.maxDelay < config.minDelay) {
    $('maxDelay').value = config.minDelay;
    config.maxDelay = config.minDelay;
  }
  saveSettings();
  const win = await chrome.windows.getCurrent();
  filter = 'todos';
  send('start', { config, windowId: win.id });
}

function onClear() {
  if (Date.now() > clearArmedUntil) {
    clearArmedUntil = Date.now() + 3000;
    $('clearBtn').textContent = 'Confirmar';
    setTimeout(() => {
      $('clearBtn').textContent = 'Limpar';
    }, 3000);
    return;
  }
  clearArmedUntil = 0;
  $('clearBtn').textContent = 'Limpar';
  send('clear');
}

async function init() {
  fillSelect($('hl'), LANGUAGES);
  fillSelect($('gl'), COUNTRIES);
  await loadSettings();
  await refreshIncognitoHint();

  $('form').addEventListener('submit', onSubmit);
  $('form').addEventListener('change', saveSettings);
  $('depersonalized').addEventListener('change', refreshIncognitoHint);
  $('openSettings').addEventListener('click', () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` }));
  $('pauseBtn').addEventListener('click', () => send('pause'));
  $('resumeBtn').addEventListener('click', () => send('resume'));
  $('cancelBtn').addEventListener('click', () => send('cancel'));
  $('csvBtn').addEventListener('click', exportCsv);
  $('xlsxBtn').addEventListener('click', exportXlsx);
  $('clearBtn').addEventListener('click', onClear);
  window.addEventListener('focus', refreshIncognitoHint);

  connect();
  render();
  setInterval(() => {
    if (current.status === 'waiting') renderStatus();
  }, 500);
  setInterval(() => send('ping'), 20000);
}

init();
