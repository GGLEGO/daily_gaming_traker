// VALORANT 게임 데이터
// 원본: https://playvalorant.com/ko-kr/news/tags/patch-notes/ (Riot 공통 구조)
const base = 'https://playvalorant.com';

module.exports = {
  game: 'valorant',
  name: 'VALORANT',
  label: 'VALORANT',
  short: 'VAL',
  tagline: '발로란트 패치 노트',
  genre: 'fps',
  order: 2,
  base,
  sourceUrl: `${base}/ko-kr/news/tags/patch-notes/`,
  titleFilter: /패치\s*노트|patch/i,
};
