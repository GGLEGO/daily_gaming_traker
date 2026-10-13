// VALORANT 패치노트 에이전트
// 원본: https://playvalorant.com/ko-kr/news/tags/patch-notes/ (Riot 공통 구조)
const { runAgent } = require('../../base');
const { listRiotPatches, fetchRiotDetail } = require('./riot');

const BASE = 'https://playvalorant.com';
const LIST_URL = `${BASE}/ko-kr/news/tags/patch-notes/`;

const spec = {
  game: 'valorant',
  name: 'VALORANT',
  sourceUrl: LIST_URL,
  listPatches: () => listRiotPatches(BASE, LIST_URL, /패치\s*노트|patch/i),
  fetchDetail: fetchRiotDetail,
};

module.exports = { spec, run: () => runAgent(spec) };
if (require.main === module) runAgent(spec).then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
