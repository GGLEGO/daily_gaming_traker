// League of Legends 패치노트 에이전트
// 원본: https://www.leagueoflegends.com/ko-kr/news/tags/patch-notes/
const { runAgent } = require('../../base');
const { listRiotPatches, fetchRiotDetail } = require('./riot');

const BASE = 'https://www.leagueoflegends.com';
const LIST_URL = `${BASE}/ko-kr/news/tags/patch-notes/`;

const spec = {
  game: 'lol',
  name: 'League of Legends',
  sourceUrl: LIST_URL,
  listPatches: () => listRiotPatches(BASE, LIST_URL, /패치\s*노트|patch/i),
  fetchDetail: fetchRiotDetail,
};

module.exports = { spec, run: () => runAgent(spec) };
if (require.main === module) runAgent(spec).then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
