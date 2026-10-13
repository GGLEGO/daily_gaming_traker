// 등록된 게임 에이전트 목록. 새 게임을 추가하려면 agents/<회사>/<game>.js 를 만들고 여기에 등록한다.
const lol = require('./riot/lol');
const overwatch = require('./blizzard/overwatch');
const valorant = require('./riot/valorant');
const tft = require('./riot/tft');
const lostark = require('./smilegate/lostark');
const maplestory = require('./nexon/maplestory');
const eternalreturn = require('./nimbleneuron/eternalreturn');
const fconline = require('./nexon/fconline');
const pubg = require('./krafton/pubg');
const aion2 = require('./ncsoft/aion2');

const AGENTS = {
  lol: { ...lol, label: 'League of Legends', short: 'LoL', tagline: '리그 오브 레전드 패치 노트', genre: 'aos' },
  overwatch: { ...overwatch, label: 'Overwatch', short: 'OW', tagline: '오버워치 패치 노트', genre: 'fps' },
  valorant: { ...valorant, label: 'VALORANT', short: 'VAL', tagline: '발로란트 패치 노트', genre: 'fps' },
  tft: { ...tft, label: 'TFT', short: 'TFT', tagline: '전략적 팀 전투 패치 노트', genre: 'aos' },
  lostark: { ...lostark, label: '로스트아크', short: 'LA', tagline: '로스트아크 업데이트 내역', genre: 'rpg' },
  maplestory: { ...maplestory, label: '메이플스토리', short: 'MS', tagline: '메이플스토리 업데이트 안내', genre: 'rpg' },
  eternalreturn: { ...eternalreturn, label: '이터널 리턴', short: 'ER', tagline: '이터널 리턴 패치노트', genre: 'aos' },
  fconline: { ...fconline, label: 'FC 온라인', short: 'FC', tagline: 'FC 온라인 정기점검·업데이트 안내', genre: 'sports' },
  pubg: { ...pubg, label: '배틀그라운드', short: 'PUBG', tagline: 'PUBG: 배틀그라운드 패치 노트', genre: 'fps' },
  aion2: { ...aion2, label: '아이온2', short: 'A2', tagline: '아이온2 업데이트 노트', genre: 'rpg' },
};

// 게임 장르 (네비게이션 블록 순서)
const GENRES = [
  { id: 'fps', label: 'FPS', desc: '슈팅' },
  { id: 'rpg', label: 'RPG', desc: 'MMORPG · 액션 RPG' },
  { id: 'aos', label: 'AOS', desc: 'MOBA · 전략' },
  { id: 'sports', label: '스포츠', desc: '스포츠' },
];

module.exports = { AGENTS, GAME_IDS: Object.keys(AGENTS), GENRES };
