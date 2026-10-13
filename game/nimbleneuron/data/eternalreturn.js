// 이터널 리턴 게임 데이터
// 원본: https://playeternalreturn.com/posts/news?categoryPath=patchnote
const base = 'https://playeternalreturn.com';

module.exports = {
  game: 'eternalreturn',
  name: '이터널 리턴',
  label: '이터널 리턴',
  short: 'ER',
  tagline: '이터널 리턴 패치노트',
  genre: 'aos',
  base,
  sourceUrl: `${base}/posts/news?categoryPath=patchnote`,
  pages: 2,
  apiUrl: (page) => `${base}/api/v1/posts/news?category=patchnote&page=${page}`,
};
