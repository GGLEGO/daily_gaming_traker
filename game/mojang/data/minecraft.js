// 마인크래프트(자바 에디션) 게임 데이터
// 원본: 공식 런처가 쓰는 패치노트 JSON (목록 + 항목별 본문 파일)
//   목록: https://launchercontent.mojang.com/v2/javaPatchNotes.json
//   본문: https://launchercontent.mojang.com/v2/<contentPath>
const host = 'https://launchercontent.mojang.com';

module.exports = {
  game: 'minecraft',
  name: 'Minecraft',
  label: '마인크래프트',
  short: 'MC',
  tagline: '마인크래프트 자바 에디션 패치 노트',
  genre: 'etc', // 내비에서는 "샌드박스" 블록으로 표시 (games.genre ENUM 에 이미 있는 값이라 DB 변경 불필요)
  host,
  sourceUrl: 'https://www.minecraft.net/en-us/updates',
  listUrl: `${host}/v2/javaPatchNotes.json`,
  detailBase: `${host}/v2/`,   // + contentPath (예: javaPatchNotes/26-4-snapshot-4.json)
  assetBase: host,             // 본문·대표 이미지의 /v2/images 경로 앞에 붙인다
};
