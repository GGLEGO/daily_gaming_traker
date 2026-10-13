// League of Legends 게임 데이터
// 원본: https://www.leagueoflegends.com/ko-kr/news/tags/patch-notes/
const base = 'https://www.leagueoflegends.com';

module.exports = {
  game: 'lol',
  name: 'League of Legends',
  label: 'League of Legends',
  short: 'LoL',
  tagline: '리그 오브 레전드 패치 노트',
  genre: 'aos',
  order: 1,
  base,
  sourceUrl: `${base}/ko-kr/news/tags/patch-notes/`,
  titleFilter: /패치\s*노트|patch/i,
};
