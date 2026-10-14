// 24시간 주기 스케줄러: 서버 시작 시 1회 실행 후, 매일 지정 시각(기본 09:00 KST)에 모든 에이전트를 실행한다.
// 시각은 환경변수 PATCH_CHECK_CRON (cron 표현식), PATCH_CHECK_TZ 로 바꿀 수 있다.
const cron = require('node-cron');
const { AGENTS, GAME_IDS } = require('../game/index');
const steam = require('../steam');
const { log } = require('../base');

const CRON = process.env.PATCH_CHECK_CRON || '0 9 * * *';
const STEAM_CRON = process.env.STEAM_CHECK_CRON || '0 */6 * * *'; // Steam 할인은 6시간마다 갱신
const TZ = process.env.PATCH_CHECK_TZ || 'Asia/Seoul';
const state = { running: false, lastRunAt: null, lastResults: {}, cron: CRON, steamCron: STEAM_CRON, tz: TZ, intervalHours: 24 };

async function runAll(reason = 'scheduled') {
  if (state.running) { log('scheduler', '이미 실행 중이라 건너뜀'); return state.lastResults; }
  state.running = true;
  log('scheduler', `전체 에이전트 실행 (${reason})`);
  try {
    for (const g of GAME_IDS) state.lastResults[g] = await AGENTS[g].run({ reason });
    state.lastResults.steam = await steam.run();
    state.lastRunAt = new Date().toISOString();
  } finally {
    state.running = false;
  }
  return state.lastResults;
}

function start({ runOnStart = true } = {}) {
  if (!cron.validate(CRON)) throw new Error(`잘못된 CRON 표현식: ${CRON}`);
  cron.schedule(CRON, () => runAll('cron'), { timezone: TZ });
  cron.schedule(STEAM_CRON, () => steam.run(), { timezone: TZ });
  log('scheduler', `스케줄 등록: "${CRON}" (${TZ}) - 24시간 주기, Steam 할인 "${STEAM_CRON}"`);
  if (runOnStart) setTimeout(() => runAll('startup').catch((e) => log('scheduler', e.message)), 1000);
}

module.exports = { start, runAll, state };
