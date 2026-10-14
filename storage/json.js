// JSON 파일 백엔드: store/<game>.json, store/changes.json, store/steam_deals.json
// 로컬 개발용. 게임당 MAX_ITEMS(40) 건까지만 보관하고 오래된 것은 밀어낸다.
const fs = require('fs');
const path = require('path');
const { textOf, scoreMatch } = require('./common');

const DIR = path.join(__dirname, '..', 'store');
const CHANGES_PATH = path.join(DIR, 'changes.json');
const DEALS_PATH = path.join(DIR, 'steam_deals.json');
const MAX_ITEMS = 40;   // 게임당 보관할 최대 패치 수
const MAX_EVENTS = 300; // 보관할 변경 이벤트 수

const features = { unlimited: false, maxItems: MAX_ITEMS };

function ensureDir() { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); }
function storePath(game) { return path.join(DIR, `${game}.json`); }

function readJson(p, fallback) {
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* 손상 시 새로 시작 */ }
  return fallback;
}
function writeJson(p, obj) {
  ensureDir();
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

async function init() { ensureDir(); }
async function close() {}

function emptyStore(game, meta) {
  return { game, ...(meta || {}), lastRun: null, lastSuccess: null, lastError: null, newCount: 0, updatedCount: 0, items: [] };
}

async function loadStore(game, meta, { html = true } = {}) {
  const store = readJson(storePath(game), null) || emptyStore(game, meta);
  if (meta) { if (meta.name) store.name = meta.name; if (meta.sourceUrl) store.sourceUrl = meta.sourceUrl; }
  if (!Array.isArray(store.items)) store.items = [];
  if (!html) store.items = store.items.map(({ html: _h, revisions, ...rest }) => rest);
  return store;
}

async function countItems(game) {
  const s = readJson(storePath(game), null);
  return s && Array.isArray(s.items) ? s.items.length : 0;
}

async function getItem(game, id) {
  const s = readJson(storePath(game), null);
  const it = s && s.items && s.items.find((x) => x.id === id);
  if (!it) return null;
  return { ...it, revisions: (it.revisions || []).map(({ html: _h, ...meta }) => meta) };
}

// 수집 1회 결과 반영: base.runAgent 가 메모리에서 고친 store 를 그대로 저장하고 이벤트를 쌓는다 (ops 는 쓰지 않음)
async function commitRun(game, run) {
  const store = run.store;
  store.game = game;
  if (run.meta) { store.name = run.meta.name; store.sourceUrl = run.meta.sourceUrl; }
  store.lastRun = run.startedAt;
  if (run.ok) {
    store.lastSuccess = run.finishedAt;
    store.lastError = null;
    store.newCount = run.newCount || 0;
    store.updatedCount = run.updatedCount || 0;
    store.items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
    store.items = store.items.slice(0, MAX_ITEMS);
  } else {
    store.lastError = `${run.finishedAt} ${run.error}`;
  }
  writeJson(storePath(game), store);
  await recordEvents(run.events || []);
  return { total: store.items.length };
}

async function recordEvents(events) {
  if (!events || !events.length) return;
  const store = readJson(CHANGES_PATH, { updatedAt: null, events: [] });
  store.events = [...events, ...(store.events || [])].slice(0, MAX_EVENTS);
  store.updatedAt = new Date().toISOString();
  writeJson(CHANGES_PATH, store);
}

async function loadChanges({ limit = 30, type = '', since = null } = {}) {
  const store = readJson(CHANGES_PATH, { updatedAt: null, events: [] });
  let events = store.events || [];
  if (type) events = events.filter((e) => e.type === type);
  if (since && !isNaN(since)) events = events.filter((e) => new Date(e.at) >= since);
  return { updatedAt: store.updatedAt, total: events.length, events: events.slice(0, limit) };
}

// 본문 평문 캐시 (수정되면 updatedAt 이 바뀌어 새로 만든다)
const plainCache = new Map();
function plainOf(game, it) {
  const key = `${game}/${it.id}/${it.updatedAt || it.fetchedAt}`;
  if (!plainCache.has(key)) {
    if (plainCache.size > 2000) plainCache.clear();
    plainCache.set(key, textOf(it.html || ''));
  }
  return plainCache.get(key);
}

async function search(words, { game = null, gameIds = null, limit = 50 } = {}) {
  const ids = game ? [game] : (gameIds || fs.readdirSync(DIR).filter((f) => /^[a-z0-9]+\.json$/.test(f) && !/^(changes|steam_deals)\.json$/.test(f)).map((f) => f.replace(/\.json$/, '')));
  const items = [];
  const byGame = {};
  for (const id of ids) {
    const s = readJson(storePath(id), null);
    if (!s || !Array.isArray(s.items)) continue;
    byGame[id] = 0;
    for (const it of s.items) {
      const plain = plainOf(id, it);
      const m = scoreMatch(words, { title: it.title, summary: it.summary, plain });
      if (!m) continue;
      byGame[id] += 1;
      const { html: _h, revisions, ...rest } = it;
      items.push({ ...rest, revisionCount: it.revisionCount || 0, game: id, ...m, plain });
    }
  }
  items.sort((a, b) => b.score - a.score || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return { total: items.length, items: items.slice(0, limit), byGame };
}

async function loadDeals() {
  return readJson(DEALS_PATH, { updatedAt: null, lastError: null, genres: [], items: [] });
}
async function saveDeals(obj) { writeJson(DEALS_PATH, obj); }

module.exports = { features, init, close, loadStore, countItems, getItem, commitRun, recordEvents, loadChanges, search, loadDeals, saveDeals, DIR };
