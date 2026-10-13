// 아이온2 업데이트 노트 에이전트
// 원본: https://aion2.plaync.com/ko-kr/board/update/list (plaync 커뮤니티 API, 게시판 별칭 update_ko)
const { runAgent } = require('../../base');
const { makePlayncHandlers } = require('./plaync');

const SITE = 'https://aion2.plaync.com';
const { listPatches, fetchDetail } = makePlayncHandlers({
  service: 'aion2',
  alias: 'update_ko',
  site: SITE,
  viewPath: '/ko-kr/board/update/view?articleId=',
});

const spec = {
  game: 'aion2',
  name: '아이온2',
  sourceUrl: `${SITE}/ko-kr/board/update/list`,
  imageInBody: true,
  listPatches,
  fetchDetail,
};

module.exports = { spec, run: () => runAgent(spec) };
if (require.main === module) runAgent(spec).then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
