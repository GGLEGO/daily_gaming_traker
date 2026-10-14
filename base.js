// 공통 에이전트 베이스: 원본 사이트를 가져와 파싱하고, 저장소(storage/: JSON 파일 또는 MySQL)와 비교해 새 패치를 추가한다.
// 저장된 최신 항목은 하네스(harness.js)를 통해 본문을 다시 확인해 원본이 수정됐으면 교체하고 이력을 남긴다.
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const harness = require('./harness'); // 수정 감지·이력·변경 이벤트 (하네스 층)
const storage = require('./storage'); // 저장 계층 (STORAGE=json | mysql)

const LOG_DIR = path.join(__dirname, 'logs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 TodayGMNewsBot/1.0';
const MAX_NEW_PER_RUN = 5; // 한 번 실행에 상세 페이지를 가져올 최대 신규 패치 수

function ensureDirs() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(game, msg) {
  ensureDirs();
  const line = `[${new Date().toISOString()}] [${game}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(LOG_DIR, 'agents.log'), line + '\n');
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', ...(opts.headers || {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeout || 30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

// 원본 HTML을 안전하게 정리: 스크립트/스타일/iframe 제거, 이벤트 핸들러 제거, 상대 링크를 절대 링크로 변경
function sanitizeHtml(html, baseUrl) {
  const $ = cheerio.load(`<div id="__root">${html}</div>`, null, false);
  $('script, style, iframe, object, embed, noscript, link, meta, form, input, button').remove();
  $('*').each((_, el) => {
    const attribs = el.attribs || {};
    for (const name of Object.keys(attribs)) {
      const v = attribs[name];
      if (/^on/i.test(name)) delete el.attribs[name];
      else if (/^(href|src|xlink:href)$/i.test(name) && /^\s*javascript:/i.test(v)) delete el.attribs[name];
      else if (name === 'style') delete el.attribs[name];
    }
  });
  $('a[href]').each((_, a) => {
    const href = $(a).attr('href');
    try { $(a).attr('href', new URL(href, baseUrl).toString()); } catch (e) { /* ignore */ }
    $(a).attr('target', '_blank');
    $(a).attr('rel', 'noopener noreferrer');
  });
  $('img[src]').each((_, img) => {
    const src = $(img).attr('src');
    try { $(img).attr('src', new URL(src, baseUrl).toString()); } catch (e) { /* ignore */ }
    $(img).attr('loading', 'lazy');
  });
  return $('#__root').html() || '';
}

function textOf(html) {
  return cheerio.load(`<div>${html}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

/**
 * 에이전트 실행 공통 루틴.
 * spec = { game, name, sourceUrl, listPatches(), fetchDetail(item) }
 *  - listPatches(): 원본 목록 [{id,title,url,publishedAt,summary,image,html?}]
 *  - fetchDetail(item): 본문 {html, image?, publishedAt?, summary?}
 */
async function runAgent(spec, { reason = 'scheduled' } = {}) {
  const { game } = spec;
  const meta = { name: spec.name, sourceUrl: spec.sourceUrl, ...(spec.registry || {}) };
  const startedAt = new Date().toISOString();
  // JSON 백엔드는 본문까지 들고 있다가 통째로 저장하고, MySQL 백엔드는 본문 없이 메타만 받아 ops 로 바뀐 것만 쓴다
  const wantHtml = !storage.features.unlimited;
  const store = await storage.loadStore(game, meta, { html: wantHtml });
  const ops = [];     // 저장 계층에 넘길 변경 작업 (insert / revise / meta)
  const events = [];  // 변경 이벤트 (new / backfill / updated / error)
  log(game, `수집 시작: ${spec.sourceUrl}`);
  try {
    const listed = await spec.listPatches();
    log(game, `원본 목록 ${listed.length}건 확인`);
    const known = new Map(store.items.map((it) => [it.id, it]));
    const fresh = listed.filter((it) => !known.has(it.id));
    const toFetch = fresh.slice(0, MAX_NEW_PER_RUN);
    log(game, `신규 패치 ${fresh.length}건 (이번 실행에서 ${toFetch.length}건 상세 수집)`);

    // 저장소에 있는 가장 최근 게시 시각. 이보다 오래된 글은 과거분 채우기(backfill)라 "신규"로 알리지 않는다.
    const newestKnown = store.items.reduce((m, it) => Math.max(m, new Date(it.publishedAt || 0).getTime() || 0), 0);
    let added = 0;
    for (const item of toFetch) {
      try {
        const detail = spec.fetchDetail ? await spec.fetchDetail(item) : {};
        const merged = { ...item, ...detail, fetchedAt: new Date().toISOString() };
        if (!merged.html) throw new Error('본문이 비어 있음');
        merged.html = sanitizeHtml(merged.html, merged.url);
        const plain = textOf(merged.html);
        if (!merged.summary) merged.summary = plain.slice(0, 180);
        merged.contentHash = harness.hashText(plain);
        store.items.push(merged);
        added += 1;
        const published = new Date(merged.publishedAt || 0).getTime() || 0;
        const kind = newestKnown && published && published < newestKnown ? 'backfill' : 'new';
        if (kind === 'backfill') merged.isBackfill = true;
        ops.push({ type: 'insert', item: merged, kind, plainText: plain });
        events.push(harness.event(kind, game, { id: merged.id, title: merged.title, url: merged.url, publishedAt: merged.publishedAt }));
        log(game, `${kind === 'backfill' ? '과거분 추가' : '추가'}: ${merged.title}`);
      } catch (e) {
        log(game, `상세 수집 실패 (${item.title}): ${e.message}`);
      }
    }

    // 하네스: 저장된 최신 항목과 제목이 바뀐 항목은 본문을 다시 받아 수정 여부를 판정한다
    let updated = 0;
    const recheck = harness.pickRecheck(store.items, listed, known);
    for (const { item, known: k, titleChanged } of recheck) {
      try {
        const detail = spec.fetchDetail ? await spec.fetchDetail(item) : {};
        const html = detail.html || item.html;
        if (!html) continue;
        const candidate = { ...item, ...detail, html: sanitizeHtml(html, item.url || k.url) };
        const changed = harness.applyRevision(k, candidate, textOf);
        if (changed) {
          updated += 1;
          ops.push({ type: 'revise', id: k.id, changed, title: k.title, html: k.html, plainText: textOf(k.html), summary: candidate.summary || null, contentHash: k.contentHash, image: candidate.image || null });
          events.push(harness.event('updated', game, { id: k.id, title: k.title, url: k.url, publishedAt: k.publishedAt, changed }));
          log(game, `수정 반영 (${changed.join(',')}): ${k.title}`);
        }
      } catch (e) {
        log(game, `재확인 실패 (${item.title}): ${e.message}`);
      }
    }

    // 기존 항목의 메타(날짜/링크/대표 이미지)는 원본 기준으로 갱신. 제목은 위에서 수정 판정을 거친다.
    for (const it of listed) {
      const k = known.get(it.id);
      if (!k) continue;
      k.publishedAt = it.publishedAt || k.publishedAt; k.url = it.url || k.url; k.image = k.image || it.image || null; if (!k.title) k.title = it.title;
      ops.push({ type: 'meta', id: k.id, title: it.title || null, publishedAt: it.publishedAt || null, url: it.url || null, image: it.image || null });
    }
    // 해시가 없는 예전 항목은 한 번 채워 둔다 (JSON 백엔드, 다음 실행부터 비교 가능)
    for (const it of store.items) if (!it.contentHash && it.html) it.contentHash = harness.hashText(textOf(it.html));

    store.items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
    const finishedAt = new Date().toISOString();
    const { total } = await storage.commitRun(game, { meta, store, ops, events, startedAt, finishedAt, ok: true, listedCount: listed.length, newCount: added, updatedCount: updated, reason });
    log(game, `완료: 총 ${total}건 보관 (신규 ${added}, 수정 ${updated}), 최신 "${store.items[0] && store.items[0].title}"`);
    return { ok: true, added, updated, total };
  } catch (e) {
    const finishedAt = new Date().toISOString();
    try {
      await storage.commitRun(game, { meta, store, ops: [], events: [harness.event('error', game, { message: e.message })], startedAt, finishedAt, ok: false, error: e.message, reason });
    } catch (e2) { log(game, `실패 기록도 실패: ${e2.message}`); }
    log(game, `실패: ${e.stack || e.message}`);
    return { ok: false, error: e.message };
  }
}

/**
 * 게임 데이터(game/<회사>/data/<game>.js)와 회사 에이전트(game/<회사>/agents.js)의 수집 함수를 합쳐
 * 등록부(game/index.js)가 쓰는 에이전트 객체를 만든다.
 *  data     = { game, name, label, short, tagline, genre, sourceUrl, imageInBody?, ...회사별 필드 }
 *  handlers = { listPatches(), fetchDetail(item) }
 */
function defineAgent(data, handlers) {
  for (const k of ['game', 'name', 'sourceUrl', 'short', 'tagline', 'genre']) {
    if (!data[k]) throw new Error(`게임 데이터에 ${k} 가 없습니다: ${JSON.stringify(data.game || data)}`);
  }
  const spec = {
    game: data.game,
    name: data.name,
    sourceUrl: data.sourceUrl,
    imageInBody: !!data.imageInBody,
    listPatches: handlers.listPatches,
    fetchDetail: handlers.fetchDetail,
    // 저장 계층(MySQL games 표)에 넘길 등록 메타. company 는 game/index.js 가 채운다
    registry: { label: data.label || data.name, short: data.short, tagline: data.tagline, genre: data.genre, imageInBody: !!data.imageInBody },
  };
  return { id: data.game, label: data.label || data.name, short: data.short, tagline: data.tagline, genre: data.genre, data, spec, run: (opts) => runAgent(spec, opts) };
}

// game/<회사>/data/*.js 를 모두 읽어 배열로 돌려준다 (order 필드 → 파일명 순)
function loadGameData(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()
    .map((f) => ({ file: f, data: require(path.join(dir, f)) }))
    .sort((a, b) => (a.data.order ?? 99) - (b.data.order ?? 99) || a.file.localeCompare(b.file))
    .map((x) => x.data);
}

// 회사 agents.js 를 직접 실행했을 때: node game/<회사>/agents.js [게임] → 그 회사 게임을 바로 수집한다
async function runCli(agents) {
  const only = process.argv[2];
  const targets = only ? agents.filter((a) => a.id === only) : agents;
  if (!targets.length) { console.error(`알 수 없는 게임: ${only} (가능: ${agents.map((a) => a.id).join(', ')})`); process.exit(2); }
  const results = {};
  await storage.init();
  for (const a of targets) results[a.id] = await a.run({ reason: 'cli' });
  await storage.close();
  console.log(JSON.stringify(results, null, 2));
  process.exit(Object.values(results).every((r) => r.ok) ? 0 : 1);
}

module.exports = { runAgent, defineAgent, loadGameData, runCli, fetchText, sanitizeHtml, textOf, log, storage };
