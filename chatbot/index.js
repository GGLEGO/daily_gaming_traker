// 사이트 챗봇 서버 모듈
// - POST /api/chat : 대화 기록을 받아 Claude(claude-opus-5-5)에게 답을 받는다.
// - Claude 는 사이트 데이터(패치 노트 검색, 최신 패치, 게임 목록, 실시간 방송, 대회 일정)를 도구로 조회해 답한다.
// - API 키가 없으면 AI 대신 패치 노트 검색 결과를 돌려주는 안내 모드로 동작한다.
const fs = require('fs');
const path = require('path');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
require('../config'); // .env (ANTHROPIC_API_KEY 등) 를 먼저 읽는다
const { AGENTS, GAME_IDS } = require('../game/index');
const { storage, textOf } = require('../base');
const streams = require('../stream');
const esports = require('../scheduler/esports');

const MODEL = process.env.CHATBOT_MODEL || 'claude-opus-5-5';
const MAX_TURNS = 12;        // 클라이언트가 보내는 최근 대화 수
const MAX_TOOL_ROUNDS = 6;   // 한 답변에서 도구 호출 반복 상한
const client = new Anthropic(); // ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ant auth 프로필을 자동으로 찾는다

// ---------- 사이트 데이터 조회 (도구 구현) ----------
function gameMeta(id) {
  const a = AGENTS[id];
  return { id, label: a.label, short: a.short, genre: a.genre, tagline: a.tagline };
}
// 게임 줄임말·별칭 (공백 제거·소문자 기준으로 매칭). 키는 모두 공백 없이 소문자로 적는다.
const GAME_ALIASES = {
  lol: ['롤', '리그오브레전드', '리그', 'leagueoflegends', 'league'],
  tft: ['롤체', '전략적팀전투', '팀전투', 'teamfighttactics'],
  eternalreturn: ['이리', '이터널리턴', 'eternalreturn', 'er'],
  lostark: ['로아', '로스트아크', 'lostark'],
  minecraft: ['마크', '마인크래프트', 'minecraft', 'mc'],
  overwatch: ['옵치', '오버워치', 'overwatch', 'ow'],
  valorant: ['발로', '발로란트', 'valorant', 'val'],
  pubg: ['배그', '배틀그라운드', 'pubg', '플레이어언노운스배틀그라운드'],
  maplestory: ['메이플', '메이플스토리', 'maplestory'],
  fconline: ['피온', '피파온라인', 'fc온라인', 'fconline', 'fifaonline'],
};
// 별칭 → 게임 id 역색인 (공백 제거·소문자)
const ALIAS_INDEX = {};
for (const [id, names] of Object.entries(GAME_ALIASES)) {
  for (const n of names) ALIAS_INDEX[n.toLowerCase().replace(/\s+/g, '')] = id;
}

function resolveGame(input) {
  if (!input) return null;
  const q = String(input).toLowerCase().trim();
  const qc = q.replace(/\s+/g, ''); // 공백 제거형 ("리그 오브 레전드" → "리그오브레전드")
  // 1) 정확 일치: id / 라벨 / 약칭 / 별칭
  const exact = GAME_IDS.find((id) => id === q || AGENTS[id].label.toLowerCase() === q || AGENTS[id].short.toLowerCase() === q
    || AGENTS[id].label.toLowerCase().replace(/\s+/g, '') === qc);
  if (exact) return exact;
  if (ALIAS_INDEX[qc] && AGENTS[ALIAS_INDEX[qc]]) return ALIAS_INDEX[qc];
  // 2) 부분 포함: 라벨·태그라인이 입력과 겹치는 경우
  const byLabel = GAME_IDS.find((id) => AGENTS[id].label.toLowerCase().includes(q) || q.includes(AGENTS[id].label.toLowerCase()) || AGENTS[id].tagline.includes(q));
  if (byLabel) return byLabel;
  // 3) 별칭이 입력 안에 포함 (예: "롤 패치" → lol). 2글자 이상 별칭만, 긴 별칭 우선
  const aliasHit = Object.keys(ALIAS_INDEX).filter((n) => n.length >= 2 && qc.includes(n)).sort((a, b) => b.length - a.length)[0];
  if (aliasHit && AGENTS[ALIAS_INDEX[aliasHit]]) return ALIAS_INDEX[aliasHit];
  return null;
}
async function searchPatchNotes({ query, game, limit = 5 }) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const gameId = game ? resolveGame(game) : null;
  if (game && !gameId) return [];
  const out = [];
  if (!words.length) {
    // 검색어가 없으면 최신 글을 돌려준다
    for (const id of gameId ? [gameId] : GAME_IDS) {
      const s = await storage.loadStore(id, {}, { html: false, limit });
      for (const it of s.items) out.push({ game: id, gameLabel: AGENTS[id].label, title: it.title, publishedAt: it.publishedAt, url: `/${id}/${encodeURIComponent(it.id)}`, source: it.url, excerpt: it.summary || '' });
    }
  } else {
    const r = await storage.search(words, { game: gameId, gameIds: GAME_IDS, limit: Math.max(limit * 4, 20) });
    for (const it of r.items) {
      if (!AGENTS[it.game]) continue;
      const body = it.plain || '';
      const pos = body.toLowerCase().indexOf(words[0]);
      const excerpt = pos >= 0 ? body.slice(Math.max(0, pos - 200), pos + 400) : body.slice(0, 400);
      out.push({ game: it.game, gameLabel: AGENTS[it.game].label, title: it.title, publishedAt: it.publishedAt, url: `/${it.game}/${encodeURIComponent(it.id)}`, source: it.url, excerpt });
    }
  }
  out.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return out.slice(0, limit);
}
async function latestPatch({ game, full = false }) {
  const id = resolveGame(game);
  if (!id) return { error: `알 수 없는 게임: ${game}. 가능한 게임: ${GAME_IDS.map((g) => AGENTS[g].label).join(', ')}` };
  const s = await storage.loadStore(id, {}, { html: false, limit: 6 });
  if (!s.items.length) return { game: id, gameLabel: AGENTS[id].label, error: '아직 수집된 패치가 없습니다.' };
  const it = await storage.getItem(id, s.items[0].id);
  const body = textOf(it.html || '');
  return { game: id, gameLabel: AGENTS[id].label, title: it.title, publishedAt: it.publishedAt, url: `/${id}/${encodeURIComponent(it.id)}`, source: it.url, content: full ? body.slice(0, 6000) : body.slice(0, 1500), history: s.items.slice(1, 6).map((x) => ({ title: x.title, publishedAt: x.publishedAt })) };
}

const TOOLS = [
  {
    name: 'list_games',
    description: '이 사이트가 다루는 게임 목록(아이디, 이름, 장르)과 각 게임의 최신 패치 제목을 돌려준다.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false, required: [] },
    strict: true,
  },
  {
    name: 'search_patch_notes',
    description: '수집된 패치 노트의 제목과 본문에서 검색어를 찾는다. 챔피언·영웅·아이템·스킬 이름이나 기능 이름으로 변경 내용을 찾을 때 쓴다. 공백으로 나눈 단어가 모두 포함된 글만 돌려준다.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '검색어 (예: "암베사", "로드호그 갈고리")' },
        game: { type: ['string', 'null'], description: '게임 아이디 또는 이름. 모든 게임에서 찾으려면 null' },
        limit: { type: 'integer', description: '최대 결과 수 (기본 5, 최대 10)' },
      },
      additionalProperties: false,
      required: ['query', 'game', 'limit'],
    },
    strict: true,
  },
  {
    name: 'get_latest_patch',
    description: '특정 게임의 최신 패치 노트 본문(앞부분)과 최근 패치 이력을 돌려준다.',
    input_schema: {
      type: 'object',
      properties: {
        game: { type: 'string', description: '게임 아이디 또는 이름 (예: lol, 오버워치)' },
        full: { type: 'boolean', description: '본문을 길게(최대 6000자) 받을지 여부' },
      },
      additionalProperties: false,
      required: ['game', 'full'],
    },
    strict: true,
  },
  {
    name: 'get_live_streams',
    description: '특정 게임을 지금 방송 중인 SOOP·치지직 스트리머를 시청자순으로 돌려준다.',
    input_schema: { type: 'object', properties: { game: { type: 'string' } }, additionalProperties: false, required: ['game'] },
    strict: true,
  },
  {
    name: 'get_esports_schedule',
    description: '특정 게임의 대회·리그·경기 일정 또는 대회 소식을 돌려준다.',
    input_schema: { type: 'object', properties: { game: { type: 'string' } }, additionalProperties: false, required: ['game'] },
    strict: true,
  },
];

async function runTool(name, input) {
  switch (name) {
    case 'list_games': {
      const out = [];
      for (const id of GAME_IDS) { const s = await storage.loadStore(id, {}, { html: false, limit: 1 }); out.push({ ...gameMeta(id), latest: s.items[0] ? { title: s.items[0].title, publishedAt: s.items[0].publishedAt } : null }); }
      return out;
    }
    case 'search_patch_notes':
      return searchPatchNotes({ query: input.query, game: input.game || null, limit: Math.min(Number(input.limit) || 5, 10) });
    case 'get_latest_patch':
      return latestPatch({ game: input.game, full: !!input.full });
    case 'get_live_streams': {
      const id = resolveGame(input.game);
      if (!id) return { error: `알 수 없는 게임: ${input.game}` };
      const d = await streams.getStreams(id);
      return d ? { game: id, soop: d.soop.map((s) => ({ name: s.name, title: s.title, viewers: s.viewers, url: s.url })), chzzk: d.chzzk.map((s) => ({ name: s.name, title: s.title, viewers: s.viewers, url: s.url })) } : { error: '이 게임은 방송 정보를 제공하지 않습니다.' };
    }
    case 'get_esports_schedule': {
      const id = resolveGame(input.game);
      if (!id) return { error: `알 수 없는 게임: ${input.game}` };
      const d = await esports.getEsports(id);
      return d ? { game: id, label: d.label, items: d.items } : { error: '이 게임은 일정 정보를 제공하지 않습니다.' };
    }
    default:
      return { error: `알 수 없는 도구: ${name}` };
  }
}

// ---------- 시스템 프롬프트 (안정적인 부분은 캐시) ----------
function systemPrompt() {
  const games = GAME_IDS.map((id) => `- ${id}: ${AGENTS[id].label} (${AGENTS[id].genre})`).join('\n');
  return `당신은 게임 패치 노트 사이트 "Daily Gaming Tracker"의 안내 챗봇입니다.
이 사이트는 아래 게임의 공식 패치 노트를 매일 수집해 보여주고, 실시간 스트리머 방송(SOOP·치지직)과 대회·리그 일정, Steam 인기 할인도 안내합니다.

다루는 게임:
${games}

답변 원칙:
- 한국어로, 짧고 정확하게 답합니다. 사용자가 다른 언어로 물으면 그 언어로 답합니다.
- 패치 내용·수치·날짜는 반드시 도구로 조회한 결과만 근거로 삼습니다. 도구 결과에 없는 내용은 지어내지 말고 "수집된 패치 노트에서 찾지 못했다"고 말합니다.
- 패치를 인용할 때는 게임 이름, 패치 제목, 게시일을 함께 적고, 사이트 안 링크(url)를 마크다운 링크로 붙입니다. 링크는 "/lol/..." 처럼 사이트 내부 경로를 그대로 씁니다.
- 질문이 여러 게임에 걸치면 게임별로 나누어 답합니다.
- 사이트 사용법 질문(검색, 장르 블록, 방송 블록 등)에는 화면 구성을 설명합니다: 상단 검색창, 장르 블록(FPS/RPG/AOS/스포츠)을 누르면 게임 버튼이 펼쳐지고, 게임을 누르면 최신 패치 전문을 볼 수 있습니다.
- 사이트와 무관한 요청은 정중히 범위를 안내합니다.
- 답변은 작은 대화창에 표시됩니다. 서식은 **굵게**, "- " 목록, [링크](url) 만 쓰고, 표(|)와 제목(#)은 쓰지 않습니다. 순위는 목록으로 적습니다.`;
}

function dynamicContext() {
  return `현재 시각(KST): ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`;
}

// ---------- API 키 없이 동작하는 안내 모드 ----------
async function fallbackReply(userText) {
  // 문장 전체로 먼저 찾고, 없으면 단어별로 찾아 합친다 (조사·물음표 등은 제거)
  const clean = String(userText).replace(/[?？!！.,、]/g, ' ');
  let hits = await searchPatchNotes({ query: clean, game: null, limit: 3 });
  if (!hits.length) {
    const words = clean.split(/\s+/).map((w) => w.replace(/(은|는|이|가|을|를|의|에서|으로|로|도|과|와|에|에게|부터|까지)$/, '')).filter((w) => w.length >= 2 && !/^(어떻게|어떤|뭐|무엇|알려줘|알려|바뀌|변경|패치|업데이트|최신|요약|있어|있나|해줘|좀)/.test(w));
    const seen = new Set();
    for (const w of words) for (const h of await searchPatchNotes({ query: w, game: null, limit: 3 })) { const k = h.game + h.title; if (!seen.has(k)) { seen.add(k); hits.push(h); } }
    hits = hits.slice(0, 5);
  }
  const head = 'AI 응답 기능이 꺼져 있어 패치 노트 검색 결과만 보여드립니다. (서버에 ANTHROPIC_API_KEY 를 설정하면 Claude 가 답변합니다)';
  if (!hits.length) return `${head}\n\n"${userText}" 와 일치하는 패치 노트를 찾지 못했습니다. 챔피언·영웅·아이템 이름으로 다시 물어보세요.`;
  return `${head}\n\n` + hits.map((h) => `- **${h.gameLabel}** · [${h.title}](${h.url}) (${(h.publishedAt || '').slice(0, 10)})\n  ${h.excerpt.slice(0, 160)}…`).join('\n');
}

// ---------- Claude 호출 (도구 사용 루프) ----------
async function askClaude(history) {
  const messages = history.map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  const used = [];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default', // 안전 분류기가 거절하면 서버가 대체 모델로 같은 요청을 이어간다
      system: [
        { type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: dynamicContext() },
      ],
      tools: TOOLS,
      output_config: { effort: 'low' },
      messages,
    });
    if (response.stop_reason === 'refusal') {
      return { reply: '죄송합니다. 그 요청에는 답변해 드릴 수 없습니다.', toolsUsed: used };
    }
    if (response.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: response.content }); continue; }
    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !toolUses.length) {
      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { reply: text || '답변을 만들지 못했습니다. 다시 물어봐 주세요.', toolsUsed: used, truncated: response.stop_reason === 'max_tokens' };
    }
    messages.push({ role: 'assistant', content: response.content });
    const results = [];
    for (const t of toolUses) {
      used.push(t.name);
      let out;
      try { out = await runTool(t.name, t.input || {}); } catch (e) { out = { error: e.message }; }
      results.push({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(out).slice(0, 20000) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: '조회가 너무 길어져 답변을 마치지 못했습니다. 질문을 조금 더 구체적으로 해 주세요.', toolsUsed: used };
}

// ---------- Express 라우터 ----------
const rate = new Map(); // ip -> [timestamps]
function limited(ip) {
  const nowMs = Date.now();
  const arr = (rate.get(ip) || []).filter((t) => nowMs - t < 60e3);
  arr.push(nowMs);
  rate.set(ip, arr);
  return arr.length > 20;
}

function createChatRouter() {
  const router = express.Router();
  router.use('/chatbot', express.static(path.join(__dirname, 'public')));
  router.get('/api/chat/status', (req, res) => {
    const profileDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.config', 'anthropic');
    const aiEnabled = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE || fs.existsSync(profileDir));
    res.json({ model: MODEL, aiEnabled, mode: aiEnabled ? 'ai' : 'fallback' });
  });
  router.post('/api/chat', express.json({ limit: '64kb' }), async (req, res) => {
    if (limited(req.ip)) return res.status(429).json({ error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' });
    const raw = Array.isArray(req.body && req.body.messages) ? req.body.messages : [];
    const history = raw
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_TURNS);
    if (!history.length || history[history.length - 1].role !== 'user') return res.status(400).json({ error: '마지막 메시지는 사용자 메시지여야 합니다.' });
    const userText = history[history.length - 1].content;
    try {
      const out = await askClaude(history);
      res.json({ ...out, mode: 'ai' });
    } catch (e) {
      // 키가 아예 없으면 SDK 가 요청 전에 AnthropicError("Could not resolve authentication method") 를 던진다
      const is = (cls) => typeof cls === 'function' && e instanceof cls;
      const noCredential = is(Anthropic.AuthenticationError)
        || (is(Anthropic.APIError) && e.status === 401)
        || /could not resolve authentication|api ?key|auth ?token/i.test((e && e.message) || '');
      if (noCredential) {
        return res.json({ reply: await fallbackReply(userText), toolsUsed: ['search_patch_notes'], mode: 'fallback' });
      }
      if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'AI 서비스 사용량이 많습니다. 잠시 후 다시 시도해 주세요.' });
      if (e instanceof Anthropic.APIConnectionError) return res.json({ reply: await fallbackReply(userText), toolsUsed: ['search_patch_notes'], mode: 'fallback', note: 'AI 서비스에 연결하지 못했습니다.' });
      if (e instanceof Anthropic.APIError) return res.status(502).json({ error: `AI 서비스 오류 (${e.status}): ${e.message}` });
      console.error('[chatbot]', e);
      res.status(500).json({ error: '챗봇 처리 중 오류가 났습니다.' });
    }
  });
  return router;
}

module.exports = { createChatRouter, TOOLS, runTool, searchPatchNotes };
