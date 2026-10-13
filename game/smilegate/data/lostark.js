// 로스트아크 게임 데이터
// 원본: https://lostark.game.onstove.com/News/Notice/List (공지사항 중 "업데이트 내역 안내" 글)
const base = 'https://lostark.game.onstove.com';
const search = '업데이트 내역';

module.exports = {
  game: 'lostark',
  name: '로스트아크',
  label: '로스트아크',
  short: 'LA',
  tagline: '로스트아크 업데이트 내역',
  genre: 'rpg',
  imageInBody: true, // 대표 이미지가 본문 첫 이미지이므로 기사 상단에는 다시 표시하지 않음
  base,
  sourceUrl: `${base}/News/Notice/List`,
  pages: 2, // 확인할 목록 페이지 수
  titleFilter: /업데이트\s*내역/,
  listUrl: (page) => `${base}/News/Notice/List?page=${page}&searchtype=2&searchtext=${encodeURIComponent(search)}&noticetype=all`,
};
