import { buildSearchUrl, pageFromUrl, LANGUAGES, COUNTRIES } from '../lib/search-url.js';
import { finalizeRows, redirectsToResolve } from '../lib/rows.js';

const STATE_KEY = 'collection';
const EXTRACTOR_FILE = 'src/lib/extract.js';
const ALLOWED_HOSTS = ['www.google.com', 'www.google.com.br'];
const MAX_PAGES = 20;
const MIN_DELAY_FLOOR = 3;
const LOAD_TIMEOUT_MS = 30000;
const ACTIVE = ['running', 'waiting'];

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const ports = new Set();
const redirects = new Map();
let state = null;
let controller = null;

function unwrapGoogleUrl(href) {
  try {
    const u = new URL(href);
    const target = u.searchParams.get('q') || u.searchParams.get('url');
    if (/(^|\.)google\./i.test(u.hostname) && u.pathname === '/url' && target && /^https?:/i.test(target)) return target;
    return u.toString();
  } catch {
    return '';
  }
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const location = details.responseHeaders?.find((h) => h.name.toLowerCase() === 'location')?.value;
    if (location) redirects.set(details.url, unwrapGoogleUrl(new URL(location, details.url).toString()));
  },
  { urls: ALLOWED_HOSTS.map((host) => `https://${host}/goto*`) },
  ['responseHeaders'],
);

function initialState() {
  return {
    status: 'idle',
    config: null,
    tabId: null,
    windowId: null,
    rows: [],
    pagesRead: [],
    pendingAction: null,
    message: '',
    nextAt: null,
    startedAt: null,
    log: [],
  };
}

async function getState() {
  if (state) return state;
  const stored = (await chrome.storage.session.get(STATE_KEY))[STATE_KEY];
  state = stored || initialState();
  if (ACTIVE.includes(state.status)) {
    state.status = 'paused';
    state.nextAt = null;
    state.message = 'A coleta foi interrompida pelo navegador. Clique em Continuar para retomar.';
  }
  return state;
}

function update(patch) {
  Object.assign(state, patch);
  chrome.storage.session.set({ [STATE_KEY]: state }).catch(() => {});
  for (const port of ports) port.postMessage({ type: 'state', state });
}

function addLog(text) {
  const entry = { at: localTimestamp(new Date()), text };
  update({ log: [...state.log, entry].slice(-100) });
}

function localTimestamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function normalizeConfig(c = {}) {
  const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.round(num(c.pages, 3))));
  const minDelay = Math.max(MIN_DELAY_FLOOR, num(c.minDelay, 5));
  const maxDelay = Math.max(minDelay, num(c.maxDelay, 12));
  return {
    term: String(c.term || '').trim(),
    pages,
    minDelay,
    maxDelay,
    depersonalized: Boolean(c.depersonalized),
    resolveLinks: c.resolveLinks !== false,
    hl: LANGUAGES.some((l) => l.value === c.hl) ? c.hl : 'pt-BR',
    gl: COUNTRIES.some((g) => g.value === c.gl) ? c.gl : 'br',
  };
}

const randomBetween = (min, max) => min + Math.random() * (max - min);

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

function checkpoint(signal) {
  if (signal.aborted) throw signal.reason;
}

async function waitForTab(tabId, signal, isReady) {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (isReady(tab)) return tab;
    await sleep(400, signal);
  }
  throw new Error('a página demorou demais para carregar');
}

function hostOf(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

async function inspectTab(tab) {
  const u = hostOf(tab.url);
  if (!u || !ALLOWED_HOSTS.includes(u.hostname)) {
    if (u?.hostname.startsWith('consent.')) {
      return { blocked: { reason: 'consentimento', message: 'O Google abriu o aviso de cookies. Escolha uma opção na aba da busca e clique em Continuar.' } };
    }
    return { blocked: { reason: 'fora_da_busca', message: 'A aba saiu da busca do Google. Volte para a página de resultados e clique em Continuar.' } };
  }
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [EXTRACTOR_FILE] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.SerpPage.inspect() });
  return res.result;
}

async function resolveLinks(tabId, rows, signal) {
  const urls = redirectsToResolve(rows);
  if (!urls.length) return new Map();
  update({ message: `Descobrindo o endereço real de ${urls.length} links…` });
  await chrome.scripting.executeScript({ target: { tabId }, files: [EXTRACTOR_FILE] });
  await chrome.scripting.executeScript({ target: { tabId }, func: (list) => globalThis.SerpPage.requestRedirects(list), args: [urls] });
  checkpoint(signal);
  const resolved = new Map(urls.filter((u) => redirects.has(u)).map((u) => [u, redirects.get(u)]));
  for (const u of urls) redirects.delete(u);
  if (resolved.size < urls.length) addLog(`${urls.length - resolved.size} de ${urls.length} links ficaram sem endereço real.`);
  return resolved;
}

async function clickNextInTab(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: [EXTRACTOR_FILE] });
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: () => globalThis.SerpPage.clickNext() });
  return res.result;
}

function renumber(rows) {
  const sorted = [...rows].sort((a, b) => a.pagina - b.pagina);
  let overall = 0;
  const byType = {};
  return sorted.map((r) => {
    if (r.area !== 'principal') return { ...r, posicao_geral: null, posicao_do_tipo: null };
    byType[r.tipo] = (byType[r.tipo] || 0) + 1;
    return { ...r, posicao_geral: ++overall, posicao_do_tipo: byType[r.tipo] };
  });
}

function addPage(page, pageRows) {
  const collectedAt = localTimestamp(new Date());
  const fresh = pageRows.map((r) => ({ termo: state.config.term, pagina: page, ...r, coletado_em: collectedAt }));
  const replaced = state.pagesRead.includes(page);
  const rows = renumber([...state.rows.filter((r) => r.pagina !== page), ...fresh]);
  const pagesRead = [...new Set([...state.pagesRead, page])].sort((a, b) => a - b);
  update({ rows, pagesRead });
  addLog(`Página ${page}${replaced ? ' relida' : ''}: ${pageRows.length} itens.`);
  if (!pageRows.length) addLog(`Página ${page}: nenhum item reconhecido. O layout do Google pode ter mudado.`);
}

function finish(message) {
  update({ status: 'done', pendingAction: null, nextAt: null, message });
  addLog(message);
}

async function runLoop() {
  controller?.abort();
  const ctrl = new AbortController();
  controller = ctrl;
  const { signal } = ctrl;
  const cfg = state.config;
  const tabId = state.tabId;

  try {
    while (true) {
      if (state.pendingAction === 'next') {
        const delay = randomBetween(cfg.minDelay, cfg.maxDelay) * 1000;
        update({ status: 'waiting', nextAt: Date.now() + delay, message: `Página ${state.pagesRead.at(-1)} lida. Aguardando para abrir a próxima.` });
        await sleep(delay, signal);
        update({ status: 'running', nextAt: null, message: 'Rolando a página e clicando em Próxima…' });
        const before = (await chrome.tabs.get(tabId)).url;
        checkpoint(signal);
        const clicked = await clickNextInTab(tabId);
        checkpoint(signal);
        if (!clicked) {
          finish(`O Google não mostrou mais páginas. Coleta encerrada com ${state.pagesRead.length} página(s).`);
          return;
        }
        update({ pendingAction: 'read' });
        await waitForTab(tabId, signal, (t) => t.url !== before && t.status === 'complete');
      }

      update({ status: 'running', message: 'Carregando a página…' });
      const tab = await waitForTab(tabId, signal, (t) => t.status === 'complete');
      await sleep(randomBetween(1500, 3000), signal);
      update({ message: 'Lendo os resultados…' });
      const result = await inspectTab(await chrome.tabs.get(tab.id));
      checkpoint(signal);

      if (result.blocked) {
        update({ status: 'paused', nextAt: null, message: result.blocked.message });
        addLog(`Pausado: ${result.blocked.message}`);
        return;
      }

      const resolved = cfg.resolveLinks ? await resolveLinks(tabId, result.rows, signal) : new Map();
      addPage(pageFromUrl(result.url) ?? state.pagesRead.length + 1, finalizeRows(result.rows, resolved));
      if (state.pagesRead.length >= cfg.pages) {
        finish(`Coleta concluída: ${state.pagesRead.length} página(s), ${state.rows.length} itens.`);
        return;
      }
      if (!result.hasNext) {
        finish(`O Google não mostrou mais páginas. Coleta encerrada com ${state.pagesRead.length} página(s).`);
        return;
      }
      update({ pendingAction: 'next' });
    }
  } catch (err) {
    if (signal.aborted) return;
    const closed = /no tab with id/i.test(err?.message || '');
    const message = closed
      ? 'A aba da coleta foi fechada. As linhas já coletadas continuam disponíveis.'
      : `Falha: ${err?.message || err}. Clique em Continuar para tentar de novo.`;
    update({ status: closed ? 'cancelled' : 'paused', nextAt: null, message, ...(closed ? { tabId: null } : {}) });
    addLog(message);
  } finally {
    if (controller === ctrl) controller = null;
  }
}

async function start(rawConfig, windowId) {
  await getState();
  if (ACTIVE.includes(state.status)) return;
  const config = normalizeConfig(rawConfig);
  if (!config.term) {
    update({ status: 'error', message: 'Digite o termo da busca.' });
    return;
  }
  const url = buildSearchUrl(config);

  let tabId;
  let targetWindowId;
  try {
    if (config.depersonalized) {
      if (!(await chrome.extension.isAllowedIncognitoAccess())) {
        update({ status: 'error', message: 'Para buscar sem personalização, ative "Permitir no modo anônimo" nos detalhes da extensão.' });
        return;
      }
      const win = await chrome.windows.create({ incognito: true, url, focused: true });
      if (!win?.tabs?.[0]) throw new Error('o Chrome não abriu a janela anônima');
      tabId = win.tabs[0].id;
      targetWindowId = win.id;
    } else {
      const tab = await chrome.tabs.create({ url, active: true, ...(windowId ? { windowId } : {}) });
      tabId = tab.id;
      targetWindowId = tab.windowId;
    }
  } catch (err) {
    update({ status: 'error', message: `Não foi possível abrir a busca: ${err?.message || err}` });
    return;
  }

  Object.assign(state, initialState());
  update({
    status: 'running',
    config,
    tabId,
    windowId: targetWindowId,
    startedAt: localTimestamp(new Date()),
    pendingAction: 'read',
    message: 'Abrindo a busca…',
  });
  addLog(`Coleta iniciada: "${config.term}", ${config.pages} página(s), ${config.depersonalized ? 'janela anônima sem personalização' : 'janela normal'}.`);
  runLoop();
}

async function pause() {
  await getState();
  if (!ACTIVE.includes(state.status)) return;
  controller?.abort();
  update({ status: 'paused', nextAt: null, message: 'Pausado. Clique em Continuar para seguir.' });
  addLog('Pausado pelo usuário.');
}

async function resume() {
  await getState();
  if (state.status !== 'paused' || !state.tabId) return;
  try {
    await chrome.tabs.get(state.tabId);
  } catch {
    update({ status: 'cancelled', tabId: null, message: 'A aba da coleta foi fechada. Inicie uma nova coleta.' });
    return;
  }
  update({ status: 'running', message: 'Retomando…' });
  addLog('Coleta retomada.');
  runLoop();
}

async function cancel(reason = 'Coleta cancelada. As linhas já coletadas continuam disponíveis para exportar.') {
  await getState();
  if (!ACTIVE.includes(state.status) && state.status !== 'paused') return;
  controller?.abort();
  update({ status: 'cancelled', nextAt: null, pendingAction: null, message: reason });
  addLog(reason);
}

async function clear() {
  await getState();
  if (ACTIVE.includes(state.status)) return;
  Object.assign(state, initialState());
  update({});
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await getState();
  if (tabId !== state.tabId) return;
  if (ACTIVE.includes(state.status) || state.status === 'paused') {
    controller?.abort();
    update({ status: 'cancelled', nextAt: null, pendingAction: null, tabId: null, message: 'A aba da coleta foi fechada. As linhas já coletadas continuam disponíveis.' });
  } else {
    update({ tabId: null });
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'panel') return;
  ports.add(port);
  port.onDisconnect.addListener(() => {
    ports.delete(port);
    if (!ports.size && state && ACTIVE.includes(state.status)) {
      cancel('O painel foi fechado e a coleta parou. As linhas já coletadas foram mantidas.');
    }
  });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'start') start(msg.config, msg.windowId);
    else if (msg.type === 'pause') pause();
    else if (msg.type === 'resume') resume();
    else if (msg.type === 'cancel') cancel();
    else if (msg.type === 'clear') clear();
  });
  getState().then((s) => port.postMessage({ type: 'state', state: s }));
});
