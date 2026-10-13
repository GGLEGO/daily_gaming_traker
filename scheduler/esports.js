// 게임별 대회·리그·경기 일정 수집기 (홈 "실시간 스트리머 방송" 옆 블록용)
// 게임마다 쓸 수 있는 출처가 달라 두 종류의 항목을 만든다.
//   kind: 'match' - 경기 일정 (시작 시각, 리그, 팀)   kind: 'news' - 대회·리그 소식 (제목, 날짜)
// 요청 시 가져오고 30분(TFT 는 60분) 캐시한다. 출처가 없거나 실패하면 items 가 비고 error 에 사유를 적는다.
const cheerio = require('cheerio');
const { fetchText, log } = require('../base');

const LIMIT = 10;
const DAYS_AHEAD = 21;      // 경기: 앞으로 3주
const NEWS_DAYS_BACK = 120; // 소식: 최근 4개월
const cache = new Map();

const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const now = () => Date.now();
const withinAhead = (iso) => { const t = new Date(iso).getTime(); return !isNaN(t) && t >= now() - 6 * 3600e3 && t <= now() + DAYS_AHEAD * 86400e3; };
const withinBack = (iso) => { const t = new Date(iso).getTime(); return !isNaN(t) && t >= now() - NEWS_DAYS_BACK * 86400e3; };
const TOURNAMENT_RE = /대회|리그|챔피언십|챔피언스|토너먼트|e스포츠|이스포츠|결승|공식 경기|FC PRO|eK/i;

// ---------- League of Legends: 공식 lolesports API (한국어) ----------
async function lol() {
  const url = 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=ko-KR';
  const json = JSON.parse(await fetchText(url, { headers: { 'x-api-key': '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z' } }));
  const events = (json.data && json.data.schedule && json.data.schedule.events) || [];
  return events
    .filter((e) => e.state !== 'completed' && withinAhead(e.startTime))
    .map((e) => ({
      kind: 'match',
      startAt: e.startTime,
      status: e.state === 'inProgress' ? 'live' : 'upcoming',
      league: e.league && e.league.name,
      stage: e.blockName || '',
      teams: ((e.match && e.match.teams) || []).map((t) => ({ name: t.name, code: t.code, image: t.image })),
      format: e.match && e.match.strategy ? `Bo${e.match.strategy.count}` : '',
      url: e.league && e.league.slug ? `https://lolesports.com/ko-KR/schedule?leagues=${e.league.slug}` : 'https://lolesports.com/ko-KR/schedule',
    }))
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
    .slice(0, LIMIT);
}

// ---------- VALORANT: vlr.gg 경기 목록 ----------
function etaToDate(eta) {
  // "Upcoming 6h 11m" / "3d 12h" / "LIVE"
  if (/live/i.test(eta)) return new Date().toISOString();
  let ms = 0;
  for (const m of eta.matchAll(/(\d+)\s*([dhm])/g)) ms += Number(m[1]) * ({ d: 86400e3, h: 3600e3, m: 60e3 }[m[2]]);
  return ms ? new Date(now() + ms).toISOString() : null;
}
async function valorant() {
  const html = await fetchText('https://www.vlr.gg/matches', { headers: { 'User-Agent': UA_BROWSER } });
  const $ = cheerio.load(html);
  const out = [];
  $('a.match-item').each((_, a) => {
    const $a = $(a);
    const eta = $a.find('.match-item-eta').text().replace(/\s+/g, ' ').trim();
    const startAt = etaToDate(eta);
    if (!startAt) return;
    const teams = $a.find('.match-item-vs-team-name').map((_, e) => ({ name: $(e).text().trim() })).get();
    const event = $a.find('.match-item-event').text().replace(/\s+/g, ' ').trim();
    const series = $a.find('.match-item-event-series').text().replace(/\s+/g, ' ').trim();
    out.push({
      kind: 'match',
      startAt,
      status: /live/i.test(eta) ? 'live' : 'upcoming',
      league: event.replace(series, '').trim() || event,
      stage: series,
      teams,
      format: '',
      url: `https://www.vlr.gg${$a.attr('href')}`,
    });
  });
  return out.filter((m) => withinAhead(m.startAt)).slice(0, LIMIT);
}

// ---------- TFT: Liquipedia 예정 경기 (요청 간격 제한이 있어 60분 캐시) ----------
async function tft() {
  const url = 'https://liquipedia.net/tft/api.php?action=parse&format=json&page=Liquipedia:Upcoming_and_ongoing_matches&prop=text&disablelimitreport=1';
  const json = JSON.parse(await fetchText(url, { headers: { 'User-Agent': 'TodayGameNews/1.0 (patch-note aggregator; dongripsw@gmail.com)' } }));
  if (json.error) throw new Error(json.error.code);
  const $ = cheerio.load(json.parse.text['*']);
  const out = [];
  $('.infobox_matches_content').each((_, t) => {
    const $t = $(t);
    const ts = Number($t.find('.timer-object').first().attr('data-timestamp'));
    if (!ts) return;
    const startAt = new Date(ts * 1000).toISOString();
    const left = $t.find('.team-left').text().replace(/\s+/g, ' ').trim();
    const right = $t.find('.team-right').text().replace(/\s+/g, ' ').trim();
    const tourA = $t.find('.match-filler a[title]').last();
    const tour = (tourA.text() || tourA.attr('title') || '').replace(/\s+/g, ' ').trim();
    const href = tourA.attr('href');
    out.push({
      kind: 'match', startAt, status: ts * 1000 <= now() ? 'live' : 'upcoming',
      league: tour, stage: '', teams: (left || right) ? [{ name: left || 'TBD' }, { name: right || 'TBD' }] : [],
      format: $t.find('.versus abbr').first().text().trim(),
      url: href ? `https://liquipedia.net${href}` : 'https://liquipedia.net/tft/',
    });
  });
  // 같은 대회·같은 시각의 중복 행은 하나로
  const seen = new Set();
  return out.filter((m) => withinAhead(m.startAt)).filter((m) => { const k = m.league + m.startAt + m.teams.map((t) => t.name).join(); return seen.has(k) ? false : (seen.add(k), true); }).slice(0, LIMIT);
}

// ---------- PUBG: 공식 e스포츠 일정 페이지 (Nuxt 상태 데이터) ----------
async function pubg() {
  const html = await fetchText('https://pubgesports.com/ko/schedule', { headers: { 'User-Agent': UA_BROWSER, 'Accept-Language': 'ko-KR' } });
  const i = html.indexOf('window.__NUXT__=');
  if (i < 0) throw new Error('__NUXT__ 상태 없음');
  const j = html.indexOf('</script>', i);
  // eslint-disable-next-line no-new-func
  const state = new Function(`return ${html.slice(i + 16, j).replace(/;\s*$/, '')}`)();
  let list = null;
  (function walk(o, d) { if (list || d > 8 || !o || typeof o !== 'object') return; if (Array.isArray(o.scheduleList)) { list = o.scheduleList; return; } for (const k in o) walk(o[k], d + 1); })(state, 0);
  if (!list) throw new Error('scheduleList 없음');
  // 공식 일정 페이지는 이번 달 경기를 보여주므로, 최근 7일의 끝난 경기도 함께 담는다 (앞으로의 경기가 없을 때 빈 블록 방지)
  const recent = (iso) => { const t = new Date(iso).getTime(); return !isNaN(t) && t >= now() - 7 * 86400e3 && t < now() - 6 * 3600e3; };
  return list
    .map((s) => ({
      kind: 'match',
      startAt: /Z|[+-]\d{2}:\d{2}$/.test(s.startAt || '') ? s.startAt : `${s.startAt}+09:00`,
      status: s.liveStartAt && s.liveEndAt && new Date(s.liveEndAt) < new Date() ? 'done' : (new Date(s.startAt) <= new Date() ? 'live' : 'upcoming'),
      league: s.shortTitle || s.title, stage: s.title || '', region: s.regionType || '',
      teams: [], format: '',
      url: s.liveOutLink || 'https://pubgesports.com/ko/schedule',
      image: s.tournamentLogoUrl || null,
    }))
    .map((m) => (recent(m.startAt) ? { ...m, status: 'done' } : m))
    .filter((m) => withinAhead(m.startAt) || recent(m.startAt))
    .sort((a, b) => new Date(b.startAt) - new Date(a.startAt))
    .slice(0, LIMIT)
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
}

// ---------- Overwatch: 공식 e스포츠 사이트 일정 페이지 (OWCS) ----------
// 페이지 소스 안에 경기 레코드가 JSON 문자열(따옴표가 \" 로 이스케이프됨)로 들어 있어 레코드 단위로 추출한다.
async function overwatch() {
  const url = 'https://esports.overwatch.com/en-us/schedule';
  const raw = await fetchText(url, { headers: { 'User-Agent': UA_BROWSER } });
  const html = raw.replace(/\\"/g, '"');
  const out = [];
  const re = /"datetime":"(20\d{2}-\d{2}-\d{2}T[^"]+)"/g;
  let m;
  const pick = (chunk, key) => { const r = chunk.match(new RegExp(`"${key}":(?:\\["([^"]*)"\\]|"([^"]*)"|(\\d+))`)); return r ? (r[1] ?? r[2] ?? r[3]) : ''; };
  while ((m = re.exec(html))) {
    const chunk = html.slice(m.index, m.index + 4000);
    const next = chunk.indexOf('"datetime"', 10);
    const rec = next > 0 ? chunk.slice(0, next) : chunk;
    const t1 = pick(rec, 'team1Name'); const t2 = pick(rec, 'team2Name');
    if (!t1 && !t2) continue;
    const status = pick(rec, 'matchStatus') || 'upcoming';
    const region = pick(rec, 'region').toUpperCase();
    const stage = [pick(rec, 'Stage Name'), pick(rec, 'event')].filter(Boolean).join(' · ');
    const s1 = pick(rec, 'Team 1 Score'); const s2 = pick(rec, 'Team 2 Score');
    out.push({
      kind: 'match', startAt: m[1],
      status: /live|inprogress/i.test(status) ? 'live' : /complete|final|done/i.test(status) ? 'done' : 'upcoming',
      league: 'OWCS', stage, region,
      teams: [{ name: t1 || 'TBD' }, { name: t2 || 'TBD' }],
      format: status === 'completed' && (s1 || s2) ? `${s1}:${s2}` : '',
      url,
    });
  }
  const recent = (iso) => { const t = new Date(iso).getTime(); return !isNaN(t) && t >= now() - 7 * 86400e3 && t < now() - 6 * 3600e3; };
  const seen = new Set();
  const uniq = out.filter((x) => { const k = x.startAt + x.teams.map((t) => t.name).join(); return seen.has(k) ? false : (seen.add(k), true); });
  const ahead = uniq.filter((x) => withinAhead(x.startAt)).sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
  if (ahead.length) return ahead.slice(0, LIMIT);
  return uniq.filter((x) => recent(x.startAt)).map((x) => ({ ...x, status: 'done' })).sort((a, b) => new Date(a.startAt) - new Date(b.startAt)).slice(-LIMIT);
}

// ---------- 이터널 리턴: 공식 e스포츠 소식 ----------
async function eternalreturn() {
  const json = JSON.parse(await fetchText('https://playeternalreturn.com/api/v1/posts/news?category=esports&page=1', { headers: { Accept: 'application/json', 'Accept-Language': 'ko-KR' } }));
  return (json.articles || [])
    .map((a) => { const ko = (a.i18ns || {}).ko_KR || {}; return { kind: 'news', title: (ko.title || '').trim(), startAt: a.created_at, league: 'ERM / KEL', url: ko.content_link || `https://playeternalreturn.com/posts/news/${a.id}`, image: a.thumbnail_url || null }; })
    .filter((n) => n.title && withinBack(n.startAt))
    .slice(0, LIMIT);
}

// ---------- 공지 목록에서 대회·리그 관련 글만 고르는 공통 도우미 ----------
function relDate(s, year) {
  // "5시간 전" / "4일 전" / "10.1(목)" / "2026.10.06" / "2026-10-06T.."
  s = String(s || '').trim();
  let m;
  if ((m = s.match(/(\d+)\s*분 전/))) return new Date(now() - m[1] * 60e3).toISOString();
  if ((m = s.match(/(\d+)\s*시간 전/))) return new Date(now() - m[1] * 3600e3).toISOString();
  if ((m = s.match(/(\d+)\s*일 전/))) return new Date(now() - m[1] * 86400e3).toISOString();
  if ((m = s.match(/(\d{4})[.-](\d{1,2})[.-](\d{1,2})/))) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T00:00:00+09:00`;
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})/))) return `${year || new Date().getFullYear()}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T00:00:00+09:00`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

// FC 온라인: 공지사항에서 공식 경기·리그·대회 안내
async function fconline() {
  const base = 'https://fconline.nexon.com';
  const out = [];
  for (let p = 1; p <= 3; p++) {
    const html = await fetchText(`${base}/news/notice/list${p > 1 ? `?n4PageNo=${p}` : ''}`);
    const $ = cheerio.load(html);
    $('.list_wrap .tr a[href*="n4ArticleSN="]').each((_, a) => {
      const title = $(a).find('.subject').text().replace(/\s+/g, ' ').replace(/새 글$/, '').trim();
      if (!TOURNAMENT_RE.test(title)) return;
      const m = ($(a).attr('href') || '').match(/n4ArticleSN=(\d+)/);
      out.push({ kind: 'news', title, startAt: relDate($(a).find('.date').text()), league: 'FC 온라인 공식 경기', url: `${base}/news/notice/view?n4ArticleSN=${m ? m[1] : ''}` });
    });
  }
  const seen = new Set();
  return out.filter((n) => (seen.has(n.url) ? false : (seen.add(n.url), true))).filter((n) => !n.startAt || withinBack(n.startAt)).slice(0, LIMIT);
}

const SOURCES = {
  lol: { fetch: lol, label: 'LoL e스포츠 공식 일정', ttl: 30 },
  valorant: { fetch: valorant, label: 'VCT · 발로란트 경기 일정', ttl: 30 },
  tft: { fetch: tft, label: 'TFT 대회 일정', ttl: 60 },
  pubg: { fetch: pubg, label: 'PUBG e스포츠 공식 일정', ttl: 30 },
  overwatch: { fetch: overwatch, label: 'OWCS 소식', ttl: 60 },
  eternalreturn: { fetch: eternalreturn, label: '이터널 리턴 e스포츠 소식', ttl: 30 },
  fconline: { fetch: fconline, label: 'FC 온라인 공식 경기 소식', ttl: 60 },
};

async function getEsports(game) {
  const src = SOURCES[game];
  if (!src) return null;
  const hit = cache.get(game);
  if (hit && now() - hit.at < src.ttl * 60e3) return hit.data;
  let items = [];
  let error = null;
  try { items = await src.fetch(); } catch (e) { error = e.message; log('esports', `${game} 실패: ${e.message}`); if (hit) return hit.data; }
  const data = { game, label: src.label, fetchedAt: new Date().toISOString(), items, error };
  cache.set(game, { at: now(), data });
  return data;
}

module.exports = { getEsports, ESPORTS_GAME_IDS: Object.keys(SOURCES) };
if (require.main === module) getEsports(process.argv[2] || 'lol').then((d) => { console.log(JSON.stringify(d, null, 1)); process.exit(0); });
