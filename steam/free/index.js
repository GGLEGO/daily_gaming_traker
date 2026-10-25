// Steam 무료 게임 수집기 + 장르 교차 필터용 데이터 (steam 할인과 별개)
// 7개 장르(협동·RPG·퍼즐·레이싱·AOS·카드·FPS)에서 maxprice=free 게임을 모두 모아 중복 제거하고,
// 각 게임이 속한 장르 집합을 함께 저장한다. 프론트에서 여러 장르를 AND 로 교차 필터링할 수 있다.
// MySQL 모드: steam_free_games 테이블(게임 1행, genres CSV). JSON 모드: store/steam_free.json.
const cheerio = require('cheerio');
const { fetchText, log, storage } = require('../../base');
const { currentPlayers } = require('..'); // steam/index.js 의 동시 접속자 조회 재사용

const COOKIE = 'birthtime=0; lastagecheckage=1-0-1990; wants_mature_content=1; Steam_Language=koreana';
const PER_GENRE = 200; // 장르별로 받을 최대 무료 게임 수 (합쳐서 중복 제거)
const MAX_GAMES = 500;  // 저장할 최대 게임 수 (안전 상한)

// 장르 구분 (Steam 사용자 태그 ID)
const FREE_GENRES = [
  { id: 'action', label: '액션', tags: [19] },
  { id: 'casual', label: '캐주얼', tags: [597] },
  { id: 'strategy', label: '전략', tags: [9] },
  { id: 'adventure', label: '어드벤처', tags: [21] },
  { id: 'anime', label: '애니', tags: [4085] },
  { id: 'simulation', label: '시뮬레이션', tags: [599] },
  { id: 'mmorpg', label: 'MMORPG', tags: [1684] },
  { id: 'openworld', label: '오픈월드', tags: [1695] },
  { id: 'horror', label: '호러', tags: [1667] },
  { id: 'indie', label: '인디', tags: [492] },
  { id: 'sports', label: '스포츠', tags: [701] },
];
const GENRE_ORDER = FREE_GENRES.map((g) => g.id);

const PAGE = 100; // Steam 검색은 요청당 최대 100개 → 여러 페이지로 나눠 받는다
function searchUrl(tag, start) {
  return `https://store.steampowered.com/search/results/?query&start=${start}&count=${PAGE}&maxprice=free&tags=${tag}&filter=topsellers&infinite=1&cc=kr&l=koreana`;
}

function parseRows(json) {
  const $ = cheerio.load(json.results_html || '');
  const out = [];
  $('a.search_result_row').each((_, a) => {
    const $a = $(a);
    const appid = $a.attr('data-ds-appid');
    if (!appid || /,/.test(appid)) return; // 번들 제외
    const review = $a.find('.search_review_summary').first();
    out.push({
      appid,
      name: $a.find('.title').first().text().trim(),
      url: `https://store.steampowered.com/app/${appid}/`,
      image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
      capsule: $a.find('.search_capsule img').first().attr('src') || null,
      review: review.hasClass('positive') ? 'positive' : review.hasClass('mixed') ? 'mixed' : review.hasClass('negative') ? 'negative' : null,
      reviewText: (review.attr('data-tooltip-html') || '').split('<br>')[0] || '',
      released: $a.find('.search_released').first().text().trim(),
    });
  });
  return out;
}

async function attachPlayers(items, batch = 10) {
  for (let i = 0; i < items.length; i += batch) {
    await Promise.all(items.slice(i, i + batch).map(async (it) => { it.players = await currentPlayers(it.appid); }));
  }
  return items;
}

// ---- SQL 테이블 (게임 1행 + 장르 CSV) ----
const TABLE_SQL = `CREATE TABLE IF NOT EXISTS steam_free_games (
  appid VARCHAR(16) NOT NULL, name VARCHAR(300) NOT NULL, url VARCHAR(500) NOT NULL,
  image VARCHAR(600) NULL, capsule VARCHAR(600) NULL, review VARCHAR(16) NULL,
  review_text VARCHAR(100) NULL, released VARCHAR(60) NULL, players INT UNSIGNED NULL,
  genres VARCHAR(120) NOT NULL, pop_rank SMALLINT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (appid)) ENGINE=InnoDB`;

// 테이블 보장: 없으면 생성, 옛 스키마(genres 열 없음)면 캐시이므로 드롭 후 재생성
async function ensureSchema() {
  const db = storage.db();
  await db.query(TABLE_SQL);
  const [cols] = await db.query("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'steam_free_games' AND column_name = 'genres'");
  if (!cols[0].n) { await db.query('DROP TABLE steam_free_games'); await db.query(TABLE_SQL); }
}

async function saveToSql(games) {
  await ensureSchema();
  const conn = await storage.db().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM steam_free_games');
    for (let i = 0; i < games.length; i++) {
      const it = games[i];
      await conn.query(
        'INSERT INTO steam_free_games (appid, name, url, image, capsule, review, review_text, released, players, genres, pop_rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [it.appid, it.name || '', it.url || '', it.image || null, it.capsule || null, it.review || null, it.reviewText || null, it.released || null, typeof it.players === 'number' ? it.players : null, it.genres.join(','), i + 1],
      );
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function loadFromSql() {
  await ensureSchema();
  const [rows] = await storage.db().query('SELECT appid, name, url, image, capsule, review, review_text, released, players, genres FROM steam_free_games ORDER BY pop_rank');
  const [[u]] = await storage.db().query('SELECT MAX(updated_at) AS updatedAt FROM steam_free_games');
  const games = rows.map((r) => ({
    appid: r.appid, name: r.name, url: r.url, image: r.image, capsule: r.capsule,
    review: r.review, reviewText: r.review_text, released: r.released, players: r.players,
    genres: String(r.genres || '').split(',').filter(Boolean),
  }));
  return { updatedAt: u && u.updatedAt ? new Date(u.updatedAt).toISOString() : null, genres: FREE_GENRES.map((g) => ({ id: g.id, label: g.label })), games, total: games.length };
}

// ── 하네스 2단계: 분류 ──
// 우리 장르 ↔ Steam 공식 장르(appdetails genres, 영어). 공식 장르가 없는 것(anime/openworld/horror)은 태그로만 판정한다.
const OFFICIAL = { action: 'Action', casual: 'Casual', strategy: 'Strategy', adventure: 'Adventure', simulation: 'Simulation', indie: 'Indie', sports: 'Sports', mmorpg: 'Massively Multiplayer' };
const TAG_ONLY = new Set(['anime', 'openworld', 'horror']);

async function fetchOfficialGenres(appid) {
  try {
    const r = JSON.parse(await fetchText(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=kr&l=english&filters=genres`, { timeout: 10000 }));
    const data = r[appid] && r[appid].data;
    return data && Array.isArray(data.genres) ? data.genres.map((x) => x.description) : [];
  } catch (e) { return null; } // null = 조회 실패 → 태그 기준 유지
}

// 게임의 최종 장르: 공식 장르로 판정 가능한 장르는 공식 장르로 확정, 태그 전용 장르는 검색 태그(provisional)로 인정
function classifyGenres(provisional, official) {
  if (official === null) return GENRE_ORDER.filter((id) => provisional.has(id)); // 조회 실패 시 태그 기준
  return GENRE_ORDER.filter((id) => (OFFICIAL[id] ? official.includes(OFFICIAL[id]) : (TAG_ONLY.has(id) && provisional.has(id))));
}

// 하네스: 검색(수집) → 분류(Steam 공식 장르로 교정) → SQL 등록
async function collect() {
  log('steam', '무료 게임 하네스 시작 (검색 → 분류 → 저장)');
  try {
    // 1) 검색: 장르 태그로 무료 게임 후보를 모으고 중복 제거 (임시 장르·순위 기록)
    const byId = new Map();
    for (const g of FREE_GENRES) {
      const seen = new Set();
      let rank = 0;
      for (const tag of g.tags) {
        for (let start = 0; start < PER_GENRE; start += PAGE) {
          const json = JSON.parse(await fetchText(searchUrl(tag, start), { headers: { Accept: 'application/json', Cookie: COOKIE } }));
          const rows = parseRows(json);
          if (!rows.length) break;
          for (const it of rows) {
            if (seen.has(it.appid)) continue;
            seen.add(it.appid);
            rank += 1;
            const cur = byId.get(it.appid) || { ...it, provisional: new Set(), bestRank: Infinity };
            cur.provisional.add(g.id);
            cur.bestRank = Math.min(cur.bestRank, rank);
            if (!cur.review && it.review) { cur.review = it.review; cur.reviewText = it.reviewText; }
            byId.set(it.appid, cur);
          }
        }
      }
    }
    let games = [...byId.values()].sort((a, b) => a.bestRank - b.bestRank || a.name.localeCompare(b.name, 'ko')).slice(0, MAX_GAMES);
    log('steam', `검색: 후보 ${games.length}개`);

    // 2) 분류: Steam 공식 장르(appdetails)로 각 게임의 장르를 바로잡는다 (4개 동시, 실패 시 태그 기준 유지)
    let confirmed = 0;
    for (let i = 0; i < games.length; i += 4) {
      await Promise.all(games.slice(i, i + 4).map(async (it) => {
        const official = await fetchOfficialGenres(it.appid);
        it.genres = classifyGenres(it.provisional, official);
        if (official !== null) confirmed += 1;
      }));
    }
    games = games.filter((it) => it.genres.length); // 우리 장르 어디에도 안 맞으면 제외
    log('steam', `분류: 공식 장르 ${confirmed}개 확인, 최종 ${games.length}개`);

    // 3) SQL 등록: 접속자 수를 붙여 인기순 정렬 후 저장
    await attachPlayers(games);
    games.sort((a, b) => (b.players || 0) - (a.players || 0) || a.bestRank - b.bestRank || a.name.localeCompare(b.name, 'ko'));
    if (storage.backend === 'mysql') await saveToSql(games);
    else await storage.saveFree({ updatedAt: new Date().toISOString(), genres: FREE_GENRES.map((g) => ({ id: g.id, label: g.label })), games, total: games.length });
    log('steam', `저장 완료: ${games.length}개 (장르 ${FREE_GENRES.length}종)`);
    return { ok: true, count: games.length };
  } catch (e) {
    log('steam', `무료 하네스 실패: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

async function load() {
  try {
    if (storage.backend === 'mysql') return await loadFromSql();
    const d = await storage.loadFree();
    if (!d.genres) d.genres = FREE_GENRES.map((g) => ({ id: g.id, label: g.label }));
    if (!d.games) d.games = [];
    return d;
  } catch (e) { return { updatedAt: null, genres: FREE_GENRES.map((g) => ({ id: g.id, label: g.label })), games: [], total: 0 }; }
}

module.exports = { collect, load, FREE_GENRES };
if (require.main === module) storage.init().then(collect).then(async (r) => { await storage.close(); console.log(r); process.exit(r.ok ? 0 : 1); });
