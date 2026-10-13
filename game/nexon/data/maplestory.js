// 메이플스토리 게임 데이터
// 원본: https://maplestory.nexon.com/News/Update (업데이트 게시판)
const base = 'https://maplestory.nexon.com';

module.exports = {
  game: 'maplestory',
  name: '메이플스토리',
  label: '메이플스토리',
  short: 'MS',
  tagline: '메이플스토리 업데이트 안내',
  genre: 'rpg',
  order: 1,
  imageInBody: true, // 대표 이미지가 본문 첫 이미지이므로 기사 상단에는 다시 표시하지 않음
  base,
  sourceUrl: `${base}/News/Update`,
  board: 'updateBoard',
  pages: 2,
  listUrl: (page) => (page === 1 ? `${base}/News/Update` : `${base}/News/Update?page=${page}`),
};
