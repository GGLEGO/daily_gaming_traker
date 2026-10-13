// 수동 실행: node run.js [게임 아이디] (생략하면 전체)
const { AGENTS, GAME_IDS } = require('./agents/index');

async function main() {
  const targets = process.argv[2] ? [process.argv[2]] : GAME_IDS;
  const results = {};
  for (const g of targets) {
    if (!AGENTS[g]) { console.error(`알 수 없는 게임: ${g} (가능: ${GAME_IDS.join(', ')})`); process.exit(2); }
    results[g] = await AGENTS[g].run();
  }
  console.log(JSON.stringify(results, null, 2));
  process.exit(Object.values(results).every((r) => r.ok) ? 0 : 1);
}
main();
