// Daily Gaming Tracker 서버: 정적 프론트 + 패치노트 API + 24시간 주기 수집 스케줄러
// 저장 방식은 config.js (STORAGE=json | mysql) 로 정하고, 모든 데이터 접근은 storage/ 를 거친다.
const path = require('path');
const express = require('express');
const config = require('./config');
const { AGENTS, GAME_IDS, GENRES } = require('./game/index');
const { storage } = require('./base');
const harness = require('./harness'); // 수정 이력 응답 가공
const scheduler = require('./scheduler'); // 24시간 스케줄러 (scheduler/ 폴더)
const steam = require('./steam'); // Steam 할인 수집기 (steam/ 폴더)
const streams = require('./stream'); // 실시간 방송 수집기 (stream/ 폴더)
const esports = require('./scheduler/esports'); // 대회·리그·경기 일정 수집기 (scheduler/ 폴더);
const { createChatRouter } = require('./chatbot');
const news = require('./news'); // 게임 뉴스 모듈 (news/ 폴더)

const app = express();
const PORT = config.PORT;
const PUBLIC = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.static(PUBLIC, { extensions: ['html'] }));
app.use(createChatRouter()); // 챗봇: /api/chat, /chatbot/*

// async 핸들러의 예외를 JSON 오류로 돌려준다
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function gameMeta(id) {
  const a = AGENTS[id];
  return { id, label: a.label, short: a.short, tagline: a.tagline, genre: a.genre || 'etc', sourceUrl: a.spec.sourceUrl, imageInBody: !!a.spec.imageInBody };
}

function readStore(id, opts) {
  return storage.loadStore(id, { name: AGENTS[id].label, sourceUrl: AGENTS[id].spec.sourceUrl }, opts);
}

function listItem(it) {
  const { html, revisions, plain, ...rest } = it;
  return { ...rest, revisionCount: it.revisionCount || 0 };
}

// 상세 응답: 이전 버전 본문은 빼고 수정 이력 메타만 함께 내려준다
function detailItem(it) {
  return { ...it, revisions: harness.publicRevisions(it) };
}

// ---- API ----
app.get('/api/games', wrap(async (req, res) => {
  const out = [];
  for (const id of GAME_IDS) {
    const s = await readStore(id, { html: false, limit: 1 });
    out.push({ ...gameMeta(id), count: s.count ?? s.items.length, lastSuccess: s.lastSuccess, lastError: s.lastError, latest: s.items[0] ? listItem(s.items[0]) : null });
  }
  res.json(out);
}));

// 게임 장르 목록 (네비게이션 블록 순서)
app.get('/api/genres', (req, res) => {
  res.json(GENRES.map((g) => ({ ...g, games: GAME_IDS.filter((id) => (AGENTS[id].genre || 'etc') === g.id) })));
});

// Steam 인기 할인 게임 (홈 배너용)
app.get('/api/deals', wrap(async (req, res) => {
  try { res.json(await steam.loadDealsWithPlayers()); } catch (e) { res.json(await steam.loadDeals()); }
}));

// 실시간 스트리머 방송 (SOOP + 치지직, 시청자순 5개씩)
app.get('/api/streams', (req, res) => {
  res.json({ games: streams.STREAM_GAME_IDS.map((id) => ({ id, label: streams.GAME_CATEGORIES[id].label, short: streams.GAME_CATEGORIES[id].short || (AGENTS[id] && AGENTS[id].short) || id.toUpperCase() })) });
});
// (:sgame - 방송·일정 전용 게임은 패치 에이전트 목록(:game 검사)과 별개로 받을 수 있도록 다른 파라미터 이름을 쓴다)
app.get('/api/streams/:sgame', async (req, res) => {
  try {
    const data = await streams.getStreams(req.params.sgame);
    if (!data) return res.status(404).json({ error: '방송 정보를 제공하지 않는 게임입니다.' });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `방송 정보를 가져오지 못했습니다: ${e.message}` });
  }
});

// 게임 뉴스 (구글 뉴스 RSS, 분류별 30분 캐시)
app.get('/api/news', async (req, res) => {
  try {
    const data = await news.getNews(String(req.query.cat || 'all'));
    if (!data) return res.status(404).json({ error: '알 수 없는 뉴스 분류입니다.' });
    res.json({ ...data, categories: news.CATEGORIES.map((c) => ({ id: c.id, label: c.label })) });
  } catch (e) {
    res.status(502).json({ error: `뉴스를 가져오지 못했습니다: ${e.message}` });
  }
});

// 게임별 대회·리그·경기 일정 (홈 방송 블록 옆)
app.get('/api/esports/:sgame', async (req, res) => {
  try {
    const data = await esports.getEsports(req.params.sgame);
    if (!data) return res.status(404).json({ error: '일정 정보를 제공하지 않는 게임입니다.' });
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `일정 정보를 가져오지 못했습니다: ${e.message}` });
  }
});

app.get('/api/status', wrap(async (req, res) => {
  const games = {};
  for (const id of GAME_IDS) {
    const s = await readStore(id, { html: false, limit: 1 });
    games[id] = { count: s.count ?? s.items.length, lastRun: s.lastRun, lastSuccess: s.lastSuccess, lastError: s.lastError, newCount: s.newCount || 0, updatedCount: s.updatedCount || 0 };
  }
  res.json({ storage: storage.backend, scheduler: scheduler.state, games });
}));

// 최근 변경 이벤트 (신규 패치 / 원문 수정 반영 / 과거분 채우기 / 수집 오류)
app.get('/api/changes', wrap(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
  const type = String(req.query.type || '');
  const since = req.query.since ? new Date(String(req.query.since)) : null;
  const data = await storage.loadChanges({ limit, type, since });
  const events = data.events.filter((e) => AGENTS[e.game]);
  res.json({
    updatedAt: data.updatedAt,
    total: data.total,
    events: events.map((e) => ({ ...e, gameLabel: AGENTS[e.game].label, gameShort: AGENTS[e.game].short })),
  });
}));

app.param('game', (req, res, next, game) => {
  if (!AGENTS[game]) return res.status(404).json({ error: `알 수 없는 게임: ${game}` });
  req.game = game;
  next();
});

app.get('/api/:game/patches', wrap(async (req, res) => {
  const s = await readStore(req.game, { html: false });
  res.json({ game: gameMeta(req.game), lastSuccess: s.lastSuccess, lastError: s.lastError, items: s.items.map(listItem) });
}));

app.get('/api/:game/patches/latest', wrap(async (req, res) => {
  const s = await readStore(req.game, { html: false, limit: 1 });
  if (!s.items.length) return res.status(404).json({ error: '아직 수집된 패치가 없습니다.' });
  const it = await storage.getItem(req.game, s.items[0].id);
  res.json({ game: gameMeta(req.game), item: detailItem(it) });
}));

app.get('/api/:game/patches/:id', wrap(async (req, res) => {
  const it = await storage.getItem(req.game, req.params.id);
  if (!it) return res.status(404).json({ error: '패치를 찾을 수 없습니다.' });
  res.json({ game: gameMeta(req.game), item: detailItem(it) });
}));

// 로컬에서만 허용하는 수동 갱신 (브라우저 주소창에서 호출 가능)
app.post('/api/refresh', wrap(async (req, res) => {
  const ip = req.ip || '';
  if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip)) return res.status(403).json({ error: '로컬에서만 허용됩니다.' });
  const results = await scheduler.runAll('manual');
  res.json(results);
}));

// ---- 검색: 제목/요약/본문 텍스트에서 검색어(공백 구분, AND) 를 찾는다 ----
app.get('/api/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const words = q.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase());
  if (!words.length) return res.json({ q, total: 0, items: [], byGame: {} });
  const r = await storage.search(words, { gameIds: GAME_IDS, limit: 50 });
  const byGame = Object.fromEntries(GAME_IDS.map((id) => [id, { label: AGENTS[id].label, count: r.byGame[id] || 0 }]));
  const items = r.items.filter((it) => AGENTS[it.game]).map((it) => ({ ...listItem(it), gameShort: AGENTS[it.game].short }));
  res.json({ q, total: r.total, items, byGame });
}));

// ---- 페이지 라우트 (SPA 스타일) ----
app.get('/search', (req, res) => res.sendFile(path.join(PUBLIC, 'search.html')));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.get('/:game', (req, res, next) => {
  if (!AGENTS[req.params.game]) return next();
  res.sendFile(path.join(PUBLIC, 'game.html'));
});
app.get('/:game/:id', (req, res, next) => {
  if (!AGENTS[req.params.game]) return next();
  res.sendFile(path.join(PUBLIC, 'game.html'));
});
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.status(404).sendFile(path.join(PUBLIC, '404.html'));
});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server]', err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: `서버 오류: ${err.message}` });
  res.status(500).send('서버 오류');
});

(async () => {
  await storage.init(); // MySQL 이면 접속과 스키마를 확인하고, JSON 이면 store/ 폴더를 만든다
  app.listen(PORT, async () => {
    console.log(`Daily Gaming Tracker 실행 중: http://localhost:${PORT} (저장 방식: ${storage.backend})`);
    if (process.env.DISABLE_SCHEDULER !== '1') {
      // 데이터가 하나도 없으면 바로 수집, 있으면 스케줄만 등록하고 시작 시에도 1회 확인
      let hasData = false;
      for (const id of GAME_IDS) { if (await storage.countItems(id)) { hasData = true; break; } }
      scheduler.start({ runOnStart: true });
      if (!hasData) console.log('초기 데이터가 없어 수집을 시작합니다.');
    }
  });
})().catch((e) => { console.error(`시작 실패: ${e.message}`); process.exit(1); });
