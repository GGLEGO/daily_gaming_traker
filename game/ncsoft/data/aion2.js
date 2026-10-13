// 아이온2 게임 데이터
// 원본: https://aion2.plaync.com/ko-kr/board/update/list (plaync 커뮤니티 API, 게시판 별칭 update_ko)
const base = 'https://aion2.plaync.com';

module.exports = {
  game: 'aion2',
  name: '아이온2',
  label: '아이온2',
  short: 'A2',
  tagline: '아이온2 업데이트 노트',
  genre: 'rpg',
  imageInBody: true,
  base,
  sourceUrl: `${base}/ko-kr/board/update/list`,
  service: 'aion2',      // plaync API 서비스 경로
  alias: 'update_ko',    // 게시판 별칭
  viewPath: '/ko-kr/board/update/view?articleId=',
  pages: 2,
  titleFilter: null,
};
