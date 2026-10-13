// 전략적 팀 전투(TFT) 게임 데이터
// 원본: https://teamfighttactics.leagueoflegends.com/ko-kr/news/tags/patch-notes/ (Riot 공통 구조)
const base = 'https://teamfighttactics.leagueoflegends.com';

module.exports = {
  game: 'tft',
  name: '전략적 팀 전투',
  label: 'TFT',
  short: 'TFT',
  tagline: '전략적 팀 전투 패치 노트',
  genre: 'aos',
  order: 3,
  base,
  sourceUrl: `${base}/ko-kr/news/tags/patch-notes/`,
  titleFilter: /패치|patch/i,
};
