// Steam 할인 게임 수집기 (게임 패치 에이전트와 별도)
// 원본: Steam 상점 검색 - 장르 태그별로 할인 중(specials=1)인 인기 게임을 받아, 장르마다 할인율이 높은 순으로 상위 N개를 저장한다.
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { fetchText, log, DATA_DIR } = require('../base');

const COUNT = 5;
const STORE_PATH = path.join(DATA_DIR, 'steam_deals.json');
const COOKIE = 'birthtime=0; lastagecheckage=1-0-1990; wants_mature_content=1; Steam_Language=koreana';

// 사이트의 게임 장르와 같은 구분. tags 는 Steam 사용자 태그 ID (여러 개면 각각 조회해 합친다)
const GENRES = [
  { id: 'fps', label: 'FPS', desc: '슈팅', tags: [1663] },
  { id: 'rpg', label: 'RPG', desc: 'MMORPG · 액션 RPG', tags: [122] },
  { id: 'aos', label: 'AOS', desc: 'MOBA · 전략', tags: [1718, 9] },
  { id: 'sports', label: '스포츠', desc: '스포츠', tags: [701] },
];

function searchUrl(tag) {
  return `https://store.steampowered.com/search/results/?query&start=0&count=50&specials=1&tags=${tag}&filter=topsellers&infinite=1&cc=kr&l=koreana`;
}

function loadDeals() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); } catch (e) { return { updatedAt: null, lastError: null, genres: [], items: [] }; }
}

function parse(json) {
  const $ = cheerio.load(json.results_html || '');
  const out = [];
  $('a.search_result_row').each((_, a) => {
    const $a = $(a);
    const appid = $a.attr('data-ds-appid');
    const pct = $a.find('.discount_pct').first().text().trim(); // "-60%"
    const discount = Math.abs(parseInt(pct, 10)) || 0;
    if (!appid || !discount || /,/.test(appid)) return; // 번들(appid 여러 개)은 제외
    const review = $a.find('.search_review_summary').first();
    out.push({
      appid,
      name: $a.find('.title').first().text().trim(),
      discount,
      originalPrice: $a.find('.discount_original_price').first().text().trim(),
      finalPrice: $a.find('.discount_final_price').first().text().trim(),
      url: `https://store.steampowered.com/app/${appid}/`,
      image: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`, // appdetails 로 다시 확인함
      capsule: $a.find('.search_capsule img').first().attr('src') || null,
      review: review.hasClass('positive') ? 'positive' : review.hasClass('mixed') ? 'mixed' : review.hasClass('negative') ? 'negative' : null,
      reviewText: (review.attr('data-tooltip-html') || '').split('<br>')[0] || '',
      released: $a.find('.search_released').first().text().trim(),
    });
  });
  return out;
}

// 헤더 이미지·정식 이름(appdetails)과 할인 종료 시각을 채운다
async function enrich(items, expirations) {
  for (const it of items) {
    try {
      const d = JSON.parse(await fetchText(`https://store.steampowered.com/api/appdetails?appids=${it.appid}&cc=kr&l=koreana&filters=basic`));
      const data = d[it.appid] && d[it.appid].data;
      if (data && data.header_image) it.image = data.header_image;
      if (data && data.name) it.name = data.name;
    } catch (e) { log('steam', `appdetails 실패 (${it.appid}): ${e.message}`); }

    it.discountEndsAt = expirations.get(String(it.appid)) || null;
    it.discountEndsText = null;
    if (it.discountEndsAt) continue;
    try {
      const html = await fetchText(`https://store.steampowered.com/app/${it.appid}/?cc=kr&l=koreana`, { headers: { Cookie: COOKIE } });
      const m = html.match(/game_purchase_discount_countdown[^>]*>([^<]*)</);
      const text = m ? m[1].replace(/\s+/g, ' ').trim() : '';
      const d = text.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
      if (d) it.discountEndsAt = `${d[1]}-${String(d[2]).padStart(2, '0')}-${String(d[3]).padStart(2, '0')}T23:59:00+09:00`;
      else {
        const ts = html.match(/discount_countdown[\s\S]{0,400}?(\d{10})\b/) || html.match(/InitDailyDealTimer\([^)]*?(\d{10})/);
        if (ts) it.discountEndsAt = new Date(Number(ts[1]) * 1000).toISOString();
        else if (text) it.discountEndsText = text.replace(/종료일:\s*$/, '').trim();
      }
    } catch (e) { log('steam', `상점 페이지 실패 (${it.appid}): ${e.message}`); }
  }
  return items;
}

async function run() {
  const store = loadDeals();
  log('steam', '장르별 할인 게임 수집 시작');
  try {
    // 할인 종료 시각: 추천 카테고리 API(specials 등)에 정확한 시각이 있는 경우를 먼저 모아 둔다
    const expirations = new Map();
    try {
      const fc = JSON.parse(await fetchText('https://store.steampowered.com/api/featuredcategories?cc=kr&l=koreana'));
      for (const cat of Object.values(fc)) {
        for (const x of (cat && cat.items) || []) if (x && x.id && x.discount_expiration) expirations.set(String(x.id), new Date(x.discount_expiration * 1000).toISOString());
      }
    } catch (e) { log('steam', `featuredcategories 실패: ${e.message}`); }

    const genres = [];
    for (const g of GENRES) {
      const seen = new Map();
      for (const tag of g.tags) {
        const json = JSON.parse(await fetchText(searchUrl(tag), { headers: { Accept: 'application/json', Cookie: COOKIE } }));
        for (const it of parse(json)) if (!seen.has(it.appid)) seen.set(it.appid, it);
      }
      const top = [...seen.values()].sort((a, b) => b.discount - a.discount).slice(0, COUNT);
      await enrich(top, expirations);
      genres.push({ id: g.id, label: g.label, desc: g.desc, items: top });
      log('steam', `${g.label}: ${top.map((i) => `${i.name}(-${i.discount}%)`).join(', ') || '없음'}`);
    }
    if (!genres.some((g) => g.items.length)) throw new Error('할인 게임을 찾지 못함 (응답 구조 변경?)');
    const next = { updatedAt: new Date().toISOString(), lastError: null, source: 'Steam 상점 · 장르별 할인율 순', genres, items: genres.flatMap((g) => g.items) };
    fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2));
    log('steam', `완료: ${genres.map((g) => `${g.label} ${g.items.length}개`).join(', ')}`);
    return { ok: true, count: next.items.length };
  } catch (e) {
    store.lastError = `${new Date().toISOString()} ${e.message}`;
    fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
    log('steam', `실패: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ---------- 실시간 접속자 수 (공식 API, 키 불필요, 3분 캐시) ----------
const PLAYERS_TTL_MS = 3 * 60 * 1000;
const playersCache = new Map(); // appid -> { at, count }
async function currentPlayers(appid) {
  const hit = playersCache.get(appid);
  if (hit && Date.now() - hit.at < PLAYERS_TTL_MS) return hit.count;
  try {
    const json = JSON.parse(await fetchText(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`, { timeout: 8000 }));
    const count = json.response && json.response.result === 1 ? Number(json.response.player_count) : null;
    playersCache.set(appid, { at: Date.now(), count });
    return count;
  } catch (e) {
    log('steam', `접속자 조회 실패 (${appid}): ${e.message}`);
    return hit ? hit.count : null;
  }
}

// 저장된 장르별 할인 목록에 현재 접속자 수를 합쳐 돌려준다
async function loadDealsWithPlayers() {
  const store = loadDeals();
  const withPlayers = async (items) => Promise.all((items || []).map(async (it) => ({ ...it, players: await currentPlayers(it.appid) })));
  const genres = await Promise.all((store.genres || []).map(async (g) => ({ ...g, items: await withPlayers(g.items) })));
  return { ...store, genres, items: genres.flatMap((g) => g.items), playersAt: new Date().toISOString() };
}

module.exports = { run, loadDeals, loadDealsWithPlayers, currentPlayers, GENRES };
if (require.main === module) run().then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
