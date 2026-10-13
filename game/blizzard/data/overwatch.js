// Overwatch 게임 데이터
// 원본: https://overwatch.blizzard.com/ko-kr/news/patch-notes/
const base = 'https://overwatch.blizzard.com';

module.exports = {
  game: 'overwatch',
  name: 'Overwatch',
  label: 'Overwatch',
  short: 'OW',
  tagline: '오버워치 패치 노트',
  genre: 'fps',
  base,
  sourceUrl: `${base}/ko-kr/news/patch-notes/`,
  minSeed: 6,       // 저장소에 이 수보다 적으면 이전 달 아카이브까지 가져온다
  archiveMonths: 2, // 확인할 이전 달 수
  archiveUrl: (year, month) => `${base}/ko-kr/news/patch-notes/live/${year}/${String(month).padStart(2, '0')}`,
};
