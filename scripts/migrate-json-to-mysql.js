// store/*.json (JSON 백엔드 데이터) 를 MySQL 로 옮긴다. 여러 번 실행해도 안전하다 (있는 행은 갱신).
//   npm run db:migrate
// 순서: companies/games (등록부 기준) → patches → patch_revisions → agent_runs → change_events → app_state(steam_deals)
const fs = require('fs');
const path = require('path');
process.env.STORAGE = 'mysql';
require('../config');
const { AGENTS, GAME_IDS, COMPANIES } = require('../game/index');
const mysqlStore = require('../storage/mysql');
const { textOf, toDate } = require('../storage/common');

const STORE_DIR = path.join(__dirname, '..', 'store');
const readJson = (f) => { const p = path.join(STORE_DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };

async function main() {
  await mysqlStore.init();
  const db = mysqlStore.db();
  const summary = { games: 0, patches: 0, revisions: 0, runs: 0, events: 0 };

  // 1. 회사 / 게임
  for (const c of Object.values(COMPANIES)) {
    await db.query('INSERT INTO companies (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)', [c.id, c.name]);
  }
  for (const id of GAME_IDS) {
    const a = AGENTS[id];
    await mysqlStore.ensureGame(id, { ...a.spec.registry, name: a.spec.name, sourceUrl: a.spec.sourceUrl, company: a.company, companyName: COMPANIES[a.company].name });
    summary.games += 1;
  }

  // 2. 패치 + 수정 이력 + 실행 기록
  for (const id of GAME_IDS) {
    const s = readJson(`${id}.json`);
    if (!s || !Array.isArray(s.items)) { console.log(`${id}: store 파일 없음, 건너뜀`); continue; }
    for (const it of s.items) {
      const plain = textOf(it.html || '');
      await db.query(
        `INSERT INTO patches (game_id, source_id, title, url, published_at, summary, image, category, html, plain_text, content_hash, fetched_at, updated_at, revision_count, is_backfill)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE title = VALUES(title), url = VALUES(url), published_at = VALUES(published_at), summary = VALUES(summary), image = VALUES(image),
           category = VALUES(category), html = VALUES(html), plain_text = VALUES(plain_text), content_hash = VALUES(content_hash),
           updated_at = VALUES(updated_at), revision_count = VALUES(revision_count)`,
        [id, it.id, it.title || '', it.url || '', toDate(it.publishedAt), it.summary || null, it.image || null, it.category || null,
          it.html || '', plain, it.contentHash || require('../harness').hashText(plain), toDate(it.fetchedAt) || new Date(), toDate(it.updatedAt), it.revisionCount || 0, it.isBackfill ? 1 : 0],
      );
      summary.patches += 1;
      const revs = it.revisions || [];
      if (revs.length) {
        const [[row]] = await db.query('SELECT id FROM patches WHERE game_id = ? AND source_id = ?', [id, it.id]);
        // revisions[0] 이 가장 최근(직전) 버전. revision_no 는 1부터 오래된 순
        const total = it.revisionCount || revs.length;
        for (let i = 0; i < revs.length; i++) {
          const r = revs[i];
          const no = total - i;
          await db.query(
            `INSERT INTO patch_revisions (patch_id, revision_no, title, content_hash, html, changed, fetched_at, replaced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title = VALUES(title), content_hash = VALUES(content_hash), html = VALUES(html), changed = VALUES(changed), fetched_at = VALUES(fetched_at), replaced_at = VALUES(replaced_at)`,
            [row.id, no, r.title || '', r.contentHash || '', r.html || null, (r.changed || ['html']).join(','), toDate(r.fetchedAt) || toDate(r.replacedAt) || new Date(), toDate(r.replacedAt) || new Date()],
          );
          summary.revisions += 1;
        }
      }
    }
    if (s.lastRun) {
      await db.query(
        'INSERT INTO agent_runs (game_id, started_at, finished_at, ok, listed_count, new_count, updated_count, reason, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, toDate(s.lastRun), toDate(s.lastSuccess) || toDate(s.lastRun), s.lastError ? 0 : 1, s.items.length, s.newCount || 0, s.updatedCount || 0, 'migration', s.lastError || null],
      );
      summary.runs += 1;
    }
    console.log(`${id}: 패치 ${s.items.length}건`);
  }

  // 3. 변경 이벤트 (오래된 것부터 넣어 id 순서가 시간 순이 되게 한다)
  const changes = readJson('changes.json');
  if (changes && Array.isArray(changes.events)) {
    const events = [...changes.events].reverse().filter((e) => AGENTS[e.game]);
    await mysqlStore.recordEvents(events);
    summary.events = events.length;
  }

  // 4. Steam 할인
  const deals = readJson('steam_deals.json');
  if (deals) await mysqlStore.saveDeals(deals);

  console.log('완료:', summary);
  await mysqlStore.close();
}

main().catch(async (e) => { console.error(`실패: ${e.message}`); try { await mysqlStore.close(); } catch (_) { /* ignore */ } process.exit(1); });
