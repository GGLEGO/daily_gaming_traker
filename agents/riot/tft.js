// 전략적 팀 전투(TFT) 패치노트 에이전트
// 원본: https://teamfighttactics.leagueoflegends.com/ko-kr/news/tags/patch-notes/ (Riot 공통 구조)
const { runAgent } = require('../../base');
const { listRiotPatches, fetchRiotDetail } = require('./riot');

const BASE = 'https://teamfighttactics.leagueoflegends.com';
const LIST_URL = `${BASE}/ko-kr/news/tags/patch-notes/`;

const spec = {
  game: 'tft',
  name: '전략적 팀 전투',
  sourceUrl: LIST_URL,
  listPatches: () => listRiotPatches(BASE, LIST_URL, /패치|patch/i),
  fetchDetail: fetchRiotDetail,
};

module.exports = { spec, run: () => runAgent(spec) };
if (require.main === module) runAgent(spec).then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
