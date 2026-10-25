// Steam 할인 게임 수집기 (게임 패치 에이전트와 별도)
// 원본: Steam 상점 검색 - 장르 태그별로 할인 중(specials=1)인 인기 게임(topsellers 50개)을 받아,
// 동시 접속자 × 할인율 점수(scoreOf)가 높은 순으로 장르마다 상위 N개를 저장한다.
// 여기에 100% 할인으로 무료 배포 중인 항목(maxprice=free)을 "무료 배포" 탭으로 함께 저장한다.
const cheerio = require('cheerio');
const { fetchText, log, storage } = require('../base');

const COUNT = 5;
const COOKIE = 'birthtime=0; lastagecheckage=1-0-1990; wants_mature_content=1; Steam_Language=koreana';

// 사이트의 게임 장르와 같은 구분. tags 는 Steam 사용자 태그 ID (여러 개면 각각 조회해 합친다)
const GENRES = [
  { id: 'fps', label: 'FPS', desc: '슈팅', tags: [1663] },
  { id: 'rpg', label: 'RPG', desc: 'MMORPG · 액션 RPG', tags: [122] },
  { id: 'aos', label: 'AOS', desc: 'MOBA', tags: [1718] },
  { id: 'sports', label: '스포츠', desc: '스포츠', tags: [701] },
];

function searchUrl(tag) {
  return `https://store.steampowered.com/search/results/?query&start=0&count=50&specials=1&tags=${tag}&filter=topsellers&infinite=1&cc=kr&l=koreana`;
}

// 무료 배포(100% 할인): 할인 중(specials=1)이면서 최종 가격이 무료(maxprice=free)인 항목. 장르 구분 없이 전부 받는다.
const FREE_URL = 'https://store.steampowered.com/search/results/?query&start=0&count=50&specials=1&maxprice=free&infinite=1&cc=kr&l=koreana';
const FREE_COUNT = 8;
const TYPE_LABEL = { game: '게임', dlc: 'DLC', demo: '데모', music: '사운드트랙', video: '영상' };

// 저장 계층(JSON 파일 또는 MySQL app_state)에서 마지막 수집 결과를 읽는다
async function loadDeals() {
  try { return await storage.loadDeals(); } catch (e) { return { updatedAt: null, lastError: null, genres: [], items: [] }; }
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
      if (data && data.type) { it.type = data.type; it.typeLabel = TYPE_LABEL[data.type] || data.type; }
      if (data && data.fullgame && data.fullgame.name) { it.parentName = data.fullgame.name; it.parentAppid = String(data.fullgame.appid || ''); } // DLC 가 속한 본편
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
  const store = await loadDeals();
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
      // 인기(동시 접속자) × 할인율 점수로 순위를 매긴다. 할인율만 높은 한산한 게임보다 많이 하는 게임의 할인이 위로 온다.
      const candidates = await attachPlayers([...seen.values()]);
      for (const it of candidates) it.score = scoreOf(it.discount, it.players);
      const top = candidates.sort((a, b) => b.score - a.score || b.discount - a.discount).slice(0, COUNT);
      await enrich(top, expirations);
      genres.push({ id: g.id, label: g.label, desc: g.desc, items: top });
      log('steam', `${g.label}: ${top.map((i) => `${i.name}(-${i.discount}%, ${i.players == null ? '?' : i.players.toLocaleString('ko-KR')}명, ${i.score})`).join(', ') || '없음'}`);
    }
    if (!genres.some((g) => g.items.length)) throw new Error('할인 게임을 찾지 못함 (응답 구조 변경?)');

    // 무료 배포(100% 할인) 항목. 역시 접속자(DLC 는 본편 접속자) 많은 순으로 두고, 있을 때만 첫 탭으로 넣는다.
    try {
      const json = JSON.parse(await fetchText(FREE_URL, { headers: { Accept: 'application/json', Cookie: COOKIE } }));
      const free = parse(json).filter((it) => it.discount >= 100).map((it) => ({ ...it, free: true, finalPrice: '무료' }));
      await enrich(free, expirations); // type / parentAppid 를 먼저 채워야 본편 접속자를 셀 수 있다
      await attachPlayers(free);
      for (const it of free) it.score = scoreOf(it.discount, it.players);
      free.sort((a, b) => b.score - a.score || (a.type === 'game' ? 0 : 1) - (b.type === 'game' ? 0 : 1) || a.name.localeCompare(b.name, 'ko'));
      const top = free.slice(0, FREE_COUNT);
      if (top.length) genres.unshift({ id: 'free', label: '무료 배포', desc: '한정 기간 100% 할인 · 받으면 영구 소장', free: true, items: top });
      log('steam', `무료 배포: ${top.map((i) => `${i.name}${i.type && i.type !== 'game' ? `[${i.typeLabel}]` : ''}(${i.players == null ? '?' : i.players.toLocaleString('ko-KR')}명)`).join(', ') || '없음'}`);
    } catch (e) { log('steam', `무료 배포 조회 실패: ${e.message}`); }

    const next = { updatedAt: new Date().toISOString(), lastError: null, source: 'Steam 상점 · 장르별 인기(동시 접속자)×할인율 순 + 무료 배포', ranking: RANKING_DESC, genres, items: genres.flatMap((g) => g.items) };
    await storage.saveDeals(next);
    log('steam', `완료: ${genres.map((g) => `${g.label} ${g.items.length}개`).join(', ')}`);
    return { ok: true, count: next.items.length };
  } catch (e) {
    store.lastError = `${new Date().toISOString()} ${e.message}`;
    try { await storage.saveDeals(store); } catch (e2) { log('steam', `실패 기록도 실패: ${e2.message}`); }
    log('steam', `실패: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ---------- 순위 점수: 인기(동시 접속자) × 할인율 ----------
// score = 할인율(%) × log10(접속자 + 10). 접속자가 0명이면 할인율 그대로, 1만 명이면 약 4배, 10만 명이면 약 5배 가중된다.
// 할인율만 큰 한산한 게임(94% 할인, 접속 20명 → 약 140점)보다 많이 하는 게임의 적당한 할인(50% 할인, 접속 3만 명 → 약 225점)이 위로 온다.
const RANKING_DESC = '할인율 × log10(동시 접속자 + 10)';
function scoreOf(discount, players) {
  return Math.round((discount || 0) * Math.log10((players || 0) + 10));
}

// 접속자 수를 조회할 앱: DLC·사운드트랙처럼 자체 접속자가 없는 항목은 본편 appid 로 센다
function playersAppid(it) {
  return it.type && it.type !== 'game' && it.parentAppid ? it.parentAppid : it.appid;
}

// 여러 항목의 접속자 수를 10개씩 병렬로 채운다 (players, playersOf: 'self' | 'parent')
async function attachPlayers(items, batch = 10) {
  for (let i = 0; i < items.length; i += batch) {
    await Promise.all(items.slice(i, i + batch).map(async (it) => {
      const id = playersAppid(it);
      it.players = await currentPlayers(id);
      it.playersOf = id === it.appid ? 'self' : 'parent';
    }));
  }
  return items;
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
  const store = await loadDeals();
  const withPlayers = async (items) => Promise.all((items || []).map(async (it) => {
    const id = playersAppid(it);
    const live = await currentPlayers(id);
    return { ...it, players: live == null ? it.players ?? null : live, playersOf: id === it.appid ? 'self' : 'parent' };
  }));
  const genres = await Promise.all((store.genres || []).map(async (g) => ({ ...g, items: await withPlayers(g.items) })));
  return { ...store, genres, items: genres.flatMap((g) => g.items), playersAt: new Date().toISOString() };
}

module.exports = { run, loadDeals, loadDealsWithPlayers, currentPlayers, attachPlayers, scoreOf, GENRES, RANKING_DESC };
if (require.main === module) storage.init().then(run).then(async (r) => { await storage.close(); console.log(r); process.exit(r.ok ? 0 : 1); });
