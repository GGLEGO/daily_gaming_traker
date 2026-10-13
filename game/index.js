// 게임 에이전트 등록부.
// game/<회사>/agents.js 가 회사별 수집 로직을, game/<회사>/data/<game>.js 가 게임 데이터(이름·주소·장르 등)를 담는다.
// 새 게임을 추가하려면 해당 회사 폴더의 data/ 에 <game>.js 만 만들면 된다. 새 회사는 폴더와 agents.js 를 만든다.
const fs = require('fs');
const path = require('path');

// 회사 표시 순서 (네비게이션에서 같은 장르 안의 게임 순서를 결정). 여기 없는 회사 폴더는 뒤에 이름순으로 붙는다.
const COMPANY_ORDER = ['blizzard', 'riot', 'smilegate', 'nexon', 'nimbleneuron', 'krafton', 'ncsoft'];

function companyDirs() {
  const dirs = fs.readdirSync(__dirname, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(__dirname, d.name, 'agents.js')))
    .map((d) => d.name);
  const rank = (n) => { const i = COMPANY_ORDER.indexOf(n); return i < 0 ? COMPANY_ORDER.length : i; };
  return dirs.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

const COMPANIES = {}; // { riot: { id, name, agents: [...] }, ... }
const AGENTS = {};    // { lol: { id, label, short, tagline, genre, company, spec, run }, ... }
for (const dir of companyDirs()) {
  const mod = require(path.join(__dirname, dir, 'agents.js'));
  COMPANIES[dir] = { id: dir, name: mod.company || dir, agents: mod.agents };
  for (const a of mod.agents) {
    if (AGENTS[a.id]) throw new Error(`게임 아이디 중복: ${a.id} (${dir})`);
    AGENTS[a.id] = { ...a, company: dir };
  }
}

// 게임 장르 (네비게이션 블록 순서)
const GENRES = [
  { id: 'fps', label: 'FPS', desc: '슈팅' },
  { id: 'rpg', label: 'RPG', desc: 'MMORPG · 액션 RPG' },
  { id: 'aos', label: 'AOS', desc: 'MOBA · 전략' },
  { id: 'sports', label: '스포츠', desc: '스포츠' },
];

module.exports = { AGENTS, COMPANIES, GAME_IDS: Object.keys(AGENTS), GENRES };
