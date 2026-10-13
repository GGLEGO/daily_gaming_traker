// FC 온라인 게임 데이터
// 원본: https://fconline.nexon.com/news/notice/list
// "업데이트" 게시판은 이미지 위주의 이벤트 페이지로만 연결되어 본문을 가져올 수 없다.
// 대신 공지사항 중 정기점검·업데이트 안내 글(업데이트 내용이 항목별로 정리되어 있음)을 패치 내역으로 가져온다.
const base = 'https://fconline.nexon.com';

module.exports = {
  game: 'fconline',
  name: 'FC 온라인',
  label: 'FC 온라인',
  short: 'FC',
  tagline: 'FC 온라인 정기점검·업데이트 안내',
  genre: 'sports',
  order: 2,
  imageInBody: true,
  base,
  sourceUrl: `${base}/news/notice/list`,
  board: 'noticeBoard',
  pages: 4, // 공지 목록 페이지 수 (페이지당 20건)
  listUrl: (page) => (page === 1 ? `${base}/news/notice/list` : `${base}/news/notice/list?n4PageNo=${page}`),
  include: /정기점검|업데이트|패치/,
  includeSort: /점검|업데이트/,
  exclude: /사전\s*안내|예정\s*안내|미진행|연장|당첨자|설문/,
};
