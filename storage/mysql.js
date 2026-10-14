// MySQL 백엔드: sql/update.sql 스키마(companies, games, agent_runs, patches, patch_revisions, change_events, app_state)
// 배포용. 보관 상한 없이 전부 저장하고, 검색은 FULLTEXT(ngram) 인덱스를 쓴다.
// 드라이버: mysql2 (npm i mysql2). 시각은 모두 UTC 로 저장한다 (timezone: 'Z').
const config = require('../config');
const { textOf, scoreMatch, iso, toDate } = require('./common');

const features = { unlimited: true, maxItems: Infinity };

let pool = null;
function db() {
  if (pool) return pool;
  let mysql;
  try { mysql = require('mysql2/promise'); } catch (e) { throw new Error('mysql2 패키지가 없습니다. npm install mysql2 를 실행하세요.'); }
  pool = mysql.createPool({
    ...config.mysql,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: 'Z',
    charset: 'utf8mb4_0900_ai_ci',
    namedPlaceholders: false,
    supportBigNumbers: true,
  });
  return pool;
}

async function init() {
  const [rows] = await db().query('SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', ['patches']);
  if (!rows[0].n) throw new Error(`MySQL 에 patches 표가 없습니다. 먼저 npm run db:init 으로 sql/update.sql 을 적용하세요 (${config.mysql.host}:${config.mysql.port}/${config.mysql.database})`);
}
async function close() { if (pool) { await pool.end(); pool = null; } }

// ---------- 행 ↔ 항목 변환 ----------
const ITEM_COLS = 'p.id AS pk, p.source_id, p.title, p.url, p.published_at, p.summary, p.image, p.category, p.content_hash, p.fetched_at, p.updated_at, p.revision_count, p.is_backfill';
function rowToItem(r, html) {
  const it = {
    id: r.source_id,
    title: r.title,
    url: r.url,
    publishedAt: iso(r.published_at),
    summary: r.summary || '',
    image: r.image || null,
    category: r.category || undefined,
    contentHash: r.content_hash,
    fetchedAt: iso(r.fetched_at),
    revisionCount: r.revision_count || 0,
  };
  if (r.updated_at) it.updatedAt = iso(r.updated_at);
  if (r.is_backfill) it.isBackfill = true;
  if (html && r.html != null) it.html = r.html;
  return it;
}

async function gameStatus(game) {
  const [rows] = await db().query('SELECT patch_count, last_run, last_success, last_error, new_count, updated_count FROM v_game_status WHERE game_id = ?', [game]);
  const r = rows[0] || {};
  return { count: r.patch_count || 0, lastRun: iso(r.last_run), lastSuccess: iso(r.last_success), lastError: r.last_error || null, newCount: r.new_count || 0, updatedCount: r.updated_count || 0 };
}

// 게임 행이 없으면 등록부 메타로 만들어 둔다 (FK 때문에 패치보다 먼저 있어야 한다)
async function ensureGame(game, meta) {
  if (!meta) return;
  const company = meta.company || 'etc';
  await db().query('INSERT INTO companies (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [company, meta.companyName || company]);
  await db().query(
    `INSERT INTO games (id, company_id, name, label, short, tagline, genre, source_url, image_in_body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE company_id = VALUES(company_id), name = VALUES(name), label = VALUES(label), short = VALUES(short),
       tagline = VALUES(tagline), genre = VALUES(genre), source_url = VALUES(source_url), image_in_body = VALUES(image_in_body)`,
    [game, company, meta.name || game, meta.label || meta.name || game, meta.short || game.toUpperCase().slice(0, 10), meta.tagline || '', meta.genre || 'etc', meta.sourceUrl || '', meta.imageInBody ? 1 : 0],
  );
}

async function loadStore(game, meta, { html = true, limit = null } = {}) {
  const cols = html ? `${ITEM_COLS}, p.html` : ITEM_COLS;
  const [rows] = await db().query(`SELECT ${cols} FROM patches p WHERE p.game_id = ? ORDER BY p.published_at DESC, p.id DESC${limit ? ' LIMIT ' + Number(limit) : ''}`, [game]);
  const status = await gameStatus(game);
  return { game, name: meta && meta.name, sourceUrl: meta && meta.sourceUrl, ...status, items: rows.map((r) => rowToItem(r, html)) };
}

async function countItems(game) {
  const [rows] = await db().query('SELECT COUNT(*) AS n FROM patches WHERE game_id = ?', [game]);
  return rows[0].n;
}

async function getItem(game, id) {
  const [rows] = await db().query(`SELECT ${ITEM_COLS}, p.html FROM patches p WHERE p.game_id = ? AND p.source_id = ?`, [game, id]);
  if (!rows.length) return null;
  const it = rowToItem(rows[0], true);
  const [revs] = await db().query(
    'SELECT title, content_hash, changed, fetched_at, replaced_at FROM patch_revisions WHERE patch_id = ? ORDER BY revision_no DESC',
    [rows[0].pk],
  );
  it.revisions = revs.map((r) => ({ title: r.title, contentHash: r.content_hash, changed: String(r.changed || '').split(',').filter(Boolean), fetchedAt: iso(r.fetched_at), replacedAt: iso(r.replaced_at) }));
  return it;
}

// ---------- 수집 1회 반영 (트랜잭션) ----------
async function commitRun(game, run) {
  await ensureGame(game, run.meta);
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      'INSERT INTO agent_runs (game_id, started_at, finished_at, ok, listed_count, new_count, updated_count, reason, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [game, toDate(run.startedAt), toDate(run.finishedAt), run.ok ? 1 : 0, run.listedCount || 0, run.newCount || 0, run.updatedCount || 0, run.reason || 'scheduled', run.error || null],
    );
    for (const op of run.ops || []) {
      if (op.type === 'insert') {
        const it = op.item;
        await conn.query(
          `INSERT INTO patches (game_id, source_id, title, url, published_at, summary, image, category, html, plain_text, content_hash, fetched_at, is_backfill)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE title = VALUES(title), published_at = VALUES(published_at), url = VALUES(url), image = COALESCE(image, VALUES(image))`,
          [game, it.id, it.title || '', it.url || '', toDate(it.publishedAt), it.summary || null, it.image || null, it.category || null,
            it.html || '', op.plainText != null ? op.plainText : textOf(it.html), it.contentHash, toDate(it.fetchedAt) || new Date(), op.kind === 'backfill' ? 1 : 0],
        );
      } else if (op.type === 'revise') {
        const [[row]] = await conn.query('SELECT id, revision_count FROM patches WHERE game_id = ? AND source_id = ? FOR UPDATE', [game, op.id]);
        if (!row) continue;
        await conn.query(
          `INSERT INTO patch_revisions (patch_id, revision_no, title, content_hash, html, changed, fetched_at, replaced_at)
           SELECT id, revision_count + 1, title, content_hash, html, ?, COALESCE(updated_at, fetched_at), ? FROM patches WHERE id = ?`,
          [op.changed.join(','), new Date(), row.id],
        );
        // 직전 버전만 본문을 남기고 그보다 오래된 이력의 본문은 비운다
        await conn.query('UPDATE patch_revisions SET html = NULL WHERE patch_id = ? AND revision_no <= ?', [row.id, row.revision_count]);
        const sets = ['updated_at = ?', 'revision_count = revision_count + 1'];
        const vals = [new Date()];
        if (op.changed.includes('html')) {
          sets.push('html = ?', 'plain_text = ?', 'content_hash = ?');
          vals.push(op.html, op.plainText != null ? op.plainText : textOf(op.html), op.contentHash);
          if (op.summary) { sets.push('summary = ?'); vals.push(op.summary); }
        }
        if (op.changed.includes('title')) { sets.push('title = ?'); vals.push(op.title); }
        if (op.image) { sets.push('image = ?'); vals.push(op.image); }
        vals.push(row.id);
        await conn.query(`UPDATE patches SET ${sets.join(', ')} WHERE id = ?`, vals);
      } else if (op.type === 'meta') {
        await conn.query(
          'UPDATE patches SET published_at = COALESCE(?, published_at), url = COALESCE(?, url), image = COALESCE(image, ?), title = IF(title = \'\', COALESCE(?, title), title) WHERE game_id = ? AND source_id = ?',
          [toDate(op.publishedAt), op.url || null, op.image || null, op.title || null, game, op.id],
        );
      }
    }
    await insertEvents(conn, run.events || []);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  const n = await countItems(game);
  return { total: n };
}

async function insertEvents(conn, events) {
  for (const e of events) {
    const changed = Array.isArray(e.changed) ? e.changed.join(',') : (e.changed || null);
    if (e.id) {
      await conn.query(
        `INSERT INTO change_events (game_id, patch_id, type, title, url, published_at, changed, message, created_at)
         SELECT ?, p.id, ?, ?, ?, ?, ?, ?, ? FROM patches p WHERE p.game_id = ? AND p.source_id = ?
         UNION ALL SELECT ?, NULL, ?, ?, ?, ?, ?, ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM patches WHERE game_id = ? AND source_id = ?)`,
        [e.game, e.type, e.title || null, e.url || null, toDate(e.publishedAt), changed, e.message || null, toDate(e.at) || new Date(), e.game, e.id,
          e.game, e.type, e.title || null, e.url || null, toDate(e.publishedAt), changed, e.message || null, toDate(e.at) || new Date(), e.game, e.id],
      );
    } else {
      await conn.query(
        'INSERT INTO change_events (game_id, patch_id, type, title, url, published_at, changed, message, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)',
        [e.game, e.type, e.title || null, e.url || null, toDate(e.publishedAt), changed, e.message || null, toDate(e.at) || new Date()],
      );
    }
  }
}

async function recordEvents(events) {
  if (!events || !events.length) return;
  const conn = await db().getConnection();
  try { await conn.beginTransaction(); await insertEvents(conn, events); await conn.commit(); } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

async function loadChanges({ limit = 30, type = '', since = null } = {}) {
  const where = [];
  const vals = [];
  if (type) { where.push('e.type = ?'); vals.push(type); }
  if (since && !isNaN(since)) { where.push('e.created_at >= ?'); vals.push(since); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[cnt]] = await db().query(`SELECT COUNT(*) AS n, MAX(e.created_at) AS last FROM change_events e ${w}`, vals);
  const [rows] = await db().query(
    `SELECT e.created_at, e.type, e.game_id, p.source_id, e.title, e.url, e.published_at, e.changed, e.message
       FROM change_events e LEFT JOIN patches p ON p.id = e.patch_id ${w}
      ORDER BY e.created_at DESC, e.id DESC LIMIT ${Number(limit)}`,
    vals,
  );
  const [[last]] = await db().query('SELECT MAX(created_at) AS last FROM change_events');
  return {
    updatedAt: iso(last && last.last),
    total: cnt.n,
    events: rows.map((r) => ({
      at: iso(r.created_at), type: r.type, game: r.game_id, id: r.source_id || undefined, title: r.title || undefined, url: r.url || undefined,
      publishedAt: iso(r.published_at), changed: r.changed ? String(r.changed).split(',') : undefined, message: r.message || undefined,
    })),
  };
}

// ---------- 검색 ----------
// 2글자 이상 단어는 ngram FULLTEXT(BOOLEAN MODE, 모두 포함)로 후보를 좁히고, 1글자가 섞이면 LIKE 로 받는다.
// 점수·발췌문은 JSON 백엔드와 같은 scoreMatch 로 계산해 두 백엔드의 결과 모양을 맞춘다.
async function search(words, { game = null, limit = 50 } = {}) {
  const vals = [];
  let where;
  if (words.every((w) => w.length >= 2)) {
    const q = words.map((w) => `+"${w.replace(/["+\-<>()~*@]/g, ' ').trim()}"`).join(' ');
    where = 'MATCH (p.title, p.summary, p.plain_text) AGAINST (? IN BOOLEAN MODE)';
    vals.push(q);
  } else {
    where = words.map(() => '(LOWER(p.title) LIKE ? OR LOWER(p.summary) LIKE ? OR LOWER(p.plain_text) LIKE ?)').join(' AND ');
    for (const w of words) { const like = `%${w.replace(/[%_\\]/g, (c) => '\\' + c)}%`; vals.push(like, like, like); }
  }
  if (game) { where += ' AND p.game_id = ?'; vals.push(game); }
  const [rows] = await db().query(
    `SELECT p.game_id, ${ITEM_COLS}, p.plain_text FROM patches p WHERE ${where} ORDER BY p.published_at DESC LIMIT 400`,
    vals,
  );
  const items = [];
  const byGame = {};
  for (const r of rows) {
    const it = rowToItem(r, false);
    const m = scoreMatch(words, { title: it.title, summary: it.summary, plain: r.plain_text || '' });
    if (!m) continue; // ngram 이 더 넓게 잡은 후보는 여기서 걸러진다
    byGame[r.game_id] = (byGame[r.game_id] || 0) + 1;
    items.push({ ...it, game: r.game_id, ...m, plain: r.plain_text || '' });
  }
  items.sort((a, b) => b.score - a.score || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return { total: items.length, items: items.slice(0, limit), byGame };
}

// ---------- Steam 할인 결과 (app_state 에 JSON 으로) ----------
async function loadDeals() {
  const [rows] = await db().query('SELECT value FROM app_state WHERE name = ?', ['steam_deals']);
  if (!rows.length) return { updatedAt: null, lastError: null, genres: [], items: [] };
  const v = rows[0].value;
  return typeof v === 'string' ? JSON.parse(v) : v;
}
async function saveDeals(obj) {
  await db().query('INSERT INTO app_state (name, value) VALUES (?, CAST(? AS JSON)) ON DUPLICATE KEY UPDATE value = VALUES(value)', ['steam_deals', JSON.stringify(obj)]);
}

module.exports = { features, init, close, loadStore, countItems, getItem, commitRun, recordEvents, loadChanges, search, loadDeals, saveDeals, ensureGame, db };
