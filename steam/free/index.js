// Steam 무료 게임 목록 수집기 (steam 할인과 별개)
// 장르별로 maxprice=free 인기순(topsellers) 상위 10개를 모아 SQL 테이블(steam_free_games)에 저장한다.
// MySQL 모드: steam_free_games 테이블. JSON 모드: store/steam_free.json (storage.saveFree/loadFree).
const cheerio = require('cheerio');
const { fetchText, log, storage } = require('../../base');
const { currentPlayers } = require('..'); // steam/index.js 의 동시 접속자 조회 재사용

const COOKIE = 'birthtime=0; lastagecheckage=1-0-1990; wants_mature_content=1; Steam_Language=koreana';
const LIST_COUNT = 10; // 장르당 보여줄 무료 게임 수

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

function searchUrl(tag) {
  return `https://store.steampowered.com/search/results/?query&start=0&count=25&maxprice=free&tags=${tag}&filter=topsellers&infinite=1&cc=kr&l=koreana`;
}

// 무료 게임 행 파싱 (할인 조건 없음)
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

// ---- SQL 테이블 보장 / 저장 / 조회 ----
const TABLE_SQL = `CREATE TABLE IF NOT EXISTS steam_free_games (
  genre VARCHAR(16) NOT NULL, rank_no TINYINT UNSIGNED NOT NULL,
  appid VARCHAR(16) NOT NULL, name VARCHAR(300) NOT NULL, url VARCHAR(500) NOT NULL,
  image VARCHAR(600) NULL, capsule VARCHAR(600) NULL, review VARCHAR(16) NULL,
  review_text VARCHAR(100) NULL, released VARCHAR(60) NULL, players INT UNSIGNED NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (genre, rank_no)) ENGINE=InnoDB`;

async function saveToSql(genres) {
  const conn = await storage.db().getConnection();
  try {
    await conn.query(TABLE_SQL);
    await conn.beginTransaction();
    await conn.query('DELETE FROM steam_free_games');
    for (const g of genres) {
      for (let i = 0; i < g.items.length; i++) {
        const it = g.items[i];
        await conn.query(
          'INSERT INTO steam_free_games (genre, rank_no, appid, name, url, image, capsule, review, review_text, released, players) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [g.id, i + 1, it.appid, it.name || '', it.url || '', it.image || null, it.capsule || null, it.review || null, it.reviewText || null, it.released || null, typeof it.players === 'number' ? it.players : null],
        );
      }
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function loadFromSql() {
  await storage.db().query(TABLE_SQL);
  const [rows] = await storage.db().query('SELECT genre, rank_no, appid, name, url, image, capsule, review, review_text, released, players FROM steam_free_games ORDER BY genre, rank_no');
  const [[u]] = await storage.db().query('SELECT MAX(updated_at) AS updatedAt FROM steam_free_games');
  const byGenre = {};
  for (const r of rows) {
    (byGenre[r.genre] = byGenre[r.genre] || []).push({
      appid: r.appid, name: r.name, url: r.url, image: r.image, capsule: r.capsule,
      review: r.review, reviewText: r.review_text, released: r.released, players: r.players,
    });
  }
  const genres = FREE_GENRES.filter((g) => byGenre[g.id]).map((g) => ({ id: g.id, label: g.label, items: byGenre[g.id] }));
  return { updatedAt: u && u.updatedAt ? new Date(u.updatedAt).toISOString() : null, genres, items: genres.flatMap((g) => g.items) };
}

// 수집: 장르별 무료 게임 인기순 10개 + 동시 접속자 → SQL(또는 JSON)에 저장
async function collect() {
  log('steam', '무료 게임 목록 수집 시작');
  try {
    const genres = [];
    for (const g of FREE_GENRES) {
      const seen = new Map();
      for (const tag of g.tags) {
        const json = JSON.parse(await fetchText(searchUrl(tag), { headers: { Accept: 'application/json', Cookie: COOKIE } }));
        for (const it of parseRows(json)) if (!seen.has(it.appid)) seen.set(it.appid, it);
      }
      const items = [...seen.values()].slice(0, LIST_COUNT);
      await attachPlayers(items);
      genres.push({ id: g.id, label: g.label, items });
      log('steam', `무료-${g.label}: ${items.length}개`);
    }
    if (storage.backend === 'mysql') await saveToSql(genres);
    else await storage.saveFree({ updatedAt: new Date().toISOString(), source: 'Steam 무료 게임 · 장르별 인기순', genres, items: genres.flatMap((g) => g.items) });
    log('steam', `무료 목록 완료: ${genres.map((g) => `${g.label} ${g.items.length}`).join(', ')}`);
    return { ok: true, count: genres.reduce((n, g) => n + g.items.length, 0) };
  } catch (e) {
    log('steam', `무료 목록 실패: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

async function load() {
  try {
    if (storage.backend === 'mysql') return await loadFromSql();
    return await storage.loadFree();
  } catch (e) { return { updatedAt: null, genres: [], items: [] }; }
}

module.exports = { collect, load, FREE_GENRES };
if (require.main === module) storage.init().then(collect).then(async (r) => { await storage.close(); console.log(r); process.exit(r.ok ? 0 : 1); });
