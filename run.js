// 수동 실행: node run.js [게임 아이디] (생략하면 전체)
const { AGENTS, GAME_IDS } = require('./game/index');
const { storage } = require('./base');

async function main() {
  const targets = process.argv[2] ? [process.argv[2]] : GAME_IDS;
  for (const g of targets) {
    if (!AGENTS[g]) { console.error(`알 수 없는 게임: ${g} (가능: ${GAME_IDS.join(', ')})`); process.exit(2); }
  }
  await storage.init();
  console.error(`저장 방식: ${storage.backend}`);
  const results = {};
  for (const g of targets) results[g] = await AGENTS[g].run({ reason: 'cli' });
  await storage.close();
  console.log(JSON.stringify(results, null, 2));
  process.exit(Object.values(results).every((r) => r.ok) ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
