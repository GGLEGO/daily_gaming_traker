// Steam 무료 게임 수집기 + 장르 교차 필터용 데이터 (steam 할인과 별개)
// 7개 장르(협동·RPG·퍼즐·레이싱·AOS·카드·FPS)에서 maxprice=free 게임을 모두 모아 중복 제거하고,
// 각 게임이 속한 장르 집합을 함께 저장한다. 프론트에서 여러 장르를 AND 로 교차 필터링할 수 있다.
// MySQL 모드: steam_free_games 테이블(게임 1행, genres CSV). JSON 모드: store/steam_free.json.
const cheerio = require('cheerio');
const { fetchText, log, storage } = require('../../base');
const { currentPlayers } = require('..'); // steam/index.js 의 동시 접속자 조회 재사용

const COOKIE = 'birthtime=0; lastagecheckage=1-0-1990; wants_mature_content=1; Steam_Language=koreana';
const PER_GENRE = 100; // 장르별로 받을 최대 무료 게임 수 (합쳐서 중복 제거)
const MAX_GAMES = 400;  // 저장할 최대 게임 수 (안전 상한)

// 사용자가 요청한 장르 구분 (Steam 사용자 태그 ID)
const FREE_GENRES = [
  { id: 'coop', label: '협동', tags: [3843] },
  { id: 'rpg', label: 'RPG', tags: [122] },
  { id: 'puzzle', label: '퍼즐', tags: [1664] },
  { id: 'racing', label: '레이싱', tags: [699] },
  { id: 'aos', label: 'AOS', tags: [1718] },
  { id: 'card', label: '카드', tags: [1666] },
  { id: 'fps', label: 'FPS', tags: [1663] },
];
const GENRE_ORDER = FREE_GENRES.map((g) => g.id);

function searchUrl(tag) {
  return `https://store.steampowered.com/search/results/?query&start=0&count=${PER_GENRE}&maxprice=free&tags=${tag}&filter=topsellers&infinite=1&cc=kr&l=koreana`;
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

// 수집: 7개 장르에서 무료 게임을 모아 중복 제거, 각 게임의 장르 집합·인기순위를 매겨 저장
async function collect() {
  log('steam', '무료 게임(교차 필터) 수집 시작');
  try {
    const byId = new Map(); // appid -> { info, genres:Set, bestRank }
    for (const g of FREE_GENRES) {
      const seen = new Set();
      let rank = 0;
      for (const tag of g.tags) {
        const json = JSON.parse(await fetchText(searchUrl(tag), { headers: { Accept: 'application/json', Cookie: COOKIE } }));
        for (const it of parseRows(json)) {
          if (seen.has(it.appid)) continue;
          seen.add(it.appid);
          rank += 1;
          const cur = byId.get(it.appid) || { ...it, genres: new Set(), bestRank: Infinity };
          cur.genres.add(g.id);
          cur.bestRank = Math.min(cur.bestRank, rank);
          if (!cur.review && it.review) { cur.review = it.review; cur.reviewText = it.reviewText; }
          byId.set(it.appid, cur);
        }
      }
      log('steam', `무료-${g.label}: ${seen.size}개`);
    }
    let games = [...byId.values()].map((it) => ({ ...it, genres: GENRE_ORDER.filter((id) => it.genres.has(id)) }));
    // 인기순: 동시 접속자 많은 순 → 장르 topseller 상위 순. 접속자 없는 게임은 뒤로.
    await attachPlayers(games);
    games.sort((a, b) => (b.players || 0) - (a.players || 0) || a.bestRank - b.bestRank || a.name.localeCompare(b.name, 'ko'));
    games = games.slice(0, MAX_GAMES);

    if (storage.backend === 'mysql') await saveToSql(games);
    else await storage.saveFree({ updatedAt: new Date().toISOString(), genres: FREE_GENRES.map((g) => ({ id: g.id, label: g.label })), games, total: games.length });
    log('steam', `무료 목록 완료: ${games.length}개 (장르 ${FREE_GENRES.length}종)`);
    return { ok: true, count: games.length };
  } catch (e) {
    log('steam', `무료 목록 실패: ${e.message}`);
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
