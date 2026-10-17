// 실시간 스트리머 방송 수집기 (SOOP + 네이버 치지직)
// 게임별 카테고리에서 시청자 수 순으로 상위 N개를 받아 짧게 캐시한다. (실시간 데이터라 스케줄러 대신 요청 시 갱신)
const { fetchText, log } = require('../base');

const LIMIT = 5;
const TTL_MS = 2 * 60 * 1000; // 2분 캐시

// 게임별 플랫폼 카테고리 식별자
const GAME_CATEGORIES = {
  lol: { label: 'League of Legends', soop: '00040019', chzzk: 'League_of_Legends' },
  overwatch: { label: 'Overwatch', soop: '00040058', chzzk: 'OVERWATCH' },
  valorant: { label: 'VALORANT', soop: '00040110', chzzk: 'Valorant' },
  lostark: { label: '로스트아크', soop: '00040067', chzzk: 'Lost_Ark' },
  tft: { label: 'TFT', soop: '00040075', chzzk: 'Teamfight_Tactics' },
  maplestory: { label: '메이플스토리', soop: '00040032', chzzk: 'MapleStory' },
  eternalreturn: { label: '이터널 리턴', soop: '00040120', chzzk: 'Black_Survival_Eternal_Return' },
  fconline: { label: 'FC 온라인', soop: '00040070', chzzk: 'FIFA_ONLINE4' },
  pubg: { label: '배틀그라운드', soop: '00040066', chzzk: 'Player_Unknowns_Battle_Grounds' },
  minecraft: { label: '마인크래프트', soop: '00040017', chzzk: 'Minecraft' },
};

const cache = new Map();

// SOOP 응답은 제목에 HTML 엔티티가 들어 있어 평문으로 되돌린다
function decodeEntities(s) {
  return String(s || '').replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (m, k) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", nbsp: ' ' }[k]));
}

async function fetchSoop(code) {
  const url = `https://live.sooplive.co.kr/api/main_broad_list_api.php?selectType=cate&selectValue=${code}&orderType=view_cnt&pageNo=1&lang=ko_KR`;
  const json = JSON.parse(await fetchText(url, { headers: { Referer: 'https://www.sooplive.co.kr/' }, timeout: 10000 }));
  return (json.broad || [])
    .map((b) => ({
      platform: 'soop',
      name: decodeEntities(b.user_nick),
      title: decodeEntities(b.broad_title),
      viewers: Number(b.total_view_cnt) || 0,
      thumb: b.broad_thumb ? (b.broad_thumb.startsWith('//') ? 'https:' + b.broad_thumb : b.broad_thumb) : null,
      avatar: b.user_id ? `https://stimg.sooplive.co.kr/LOGO/${b.user_id.slice(0, 2)}/${b.user_id}/${b.user_id}.jpg` : null,
      url: `https://play.sooplive.co.kr/${b.user_id}/${b.broad_no}`,
      category: b.category_name || '',
    }))
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, LIMIT);
}

async function fetchChzzk(categoryId) {
  const url = `https://api.chzzk.naver.com/service/v2/categories/GAME/${encodeURIComponent(categoryId)}/lives?size=${LIMIT}&sortType=POPULAR`;
  const json = JSON.parse(await fetchText(url, { headers: { Accept: 'application/json' }, timeout: 10000 }));
  const data = (json.content && json.content.data) || [];
  return data
    .map((l) => ({
      platform: 'chzzk',
      name: l.channel && l.channel.channelName,
      title: l.liveTitle,
      viewers: Number(l.concurrentUserCount) || 0,
      thumb: l.liveImageUrl ? l.liveImageUrl.replace('{type}', '480') : (l.defaultThumbnailImageUrl || null),
      avatar: l.channel && l.channel.channelImageUrl,
      url: l.channel ? `https://chzzk.naver.com/live/${l.channel.channelId}` : 'https://chzzk.naver.com/',
      category: l.liveCategoryValue || '',
      adult: !!l.adult,
    }))
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, LIMIT);
}

// ---------- "기타": 위 게임들을 뺀 나머지 게임 카테고리에서 시청자가 많은 방송 ----------
const ETC_ID = 'etc';
GAME_CATEGORIES[ETC_ID] = { label: '기타', short: 'ETC', soop: null, chzzk: null };
const SOOP_GAME_PREFIX = /^00(04|36)/; // SOOP 게임 카테고리 코드 대역 (0004xxxx, 0036xxxx)

async function fetchSoopOthers() {
  const exclude = new Set(Object.values(GAME_CATEGORIES).map((c) => c.soop).filter(Boolean));
  const url = 'https://live.sooplive.co.kr/api/main_broad_list_api.php?selectType=action&selectValue=all&orderType=view_cnt&pageNo=1&lang=ko_KR';
  const json = JSON.parse(await fetchText(url, { headers: { Referer: 'https://www.sooplive.co.kr/' }, timeout: 10000 }));
  return (json.broad || [])
    .filter((b) => SOOP_GAME_PREFIX.test(b.broad_cate_no || '') && !exclude.has(b.broad_cate_no))
    .map((b) => ({
      platform: 'soop',
      name: decodeEntities(b.user_nick),
      title: decodeEntities(b.broad_title),
      viewers: Number(b.total_view_cnt) || 0,
      thumb: b.broad_thumb ? (b.broad_thumb.startsWith('//') ? 'https:' + b.broad_thumb : b.broad_thumb) : null,
      avatar: b.user_id ? `https://stimg.sooplive.co.kr/LOGO/${b.user_id.slice(0, 2)}/${b.user_id}/${b.user_id}.jpg` : null,
      url: `https://play.sooplive.co.kr/${b.user_id}/${b.broad_no}`,
      category: b.category_name || '',
    }))
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, LIMIT);
}

async function fetchChzzkOthers() {
  const exclude = new Set(Object.values(GAME_CATEGORIES).map((c) => c.chzzk).filter(Boolean));
  const json = JSON.parse(await fetchText('https://api.chzzk.naver.com/service/v1/lives?size=50&sortType=POPULAR', { headers: { Accept: 'application/json' }, timeout: 10000 }));
  const data = (json.content && json.content.data) || [];
  return data
    .filter((l) => l.categoryType === 'GAME' && l.liveCategory && !exclude.has(l.liveCategory))
    .map((l) => ({
      platform: 'chzzk',
      name: l.channel && l.channel.channelName,
      title: l.liveTitle,
      viewers: Number(l.concurrentUserCount) || 0,
      thumb: l.liveImageUrl ? l.liveImageUrl.replace('{type}', '480') : (l.defaultThumbnailImageUrl || null),
      avatar: l.channel && l.channel.channelImageUrl,
      url: l.channel ? `https://chzzk.naver.com/live/${l.channel.channelId}` : 'https://chzzk.naver.com/',
      category: l.liveCategoryValue || '',
      adult: !!l.adult,
    }))
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, LIMIT);
}

async function getStreams(game) {
  const cfg = GAME_CATEGORIES[game];
  if (!cfg) return null;
  const hit = cache.get(game);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const isEtc = game === ETC_ID;
  const [soop, chzzk] = await Promise.all([
    (isEtc ? fetchSoopOthers() : cfg.soop ? fetchSoop(cfg.soop) : Promise.resolve([])).catch((e) => { log('streams', `SOOP ${game} 실패: ${e.message}`); return { error: e.message }; }),
    (isEtc ? fetchChzzkOthers() : fetchChzzk(cfg.chzzk)).catch((e) => { log('streams', `치지직 ${game} 실패: ${e.message}`); return { error: e.message }; }),
  ]);
  const data = {
    game,
    label: cfg.label,
    showCategory: isEtc, // 기타 탭은 어떤 게임 방송인지 함께 보여준다
    fetchedAt: new Date().toISOString(),
    soop: Array.isArray(soop) ? soop : [],
    chzzk: Array.isArray(chzzk) ? chzzk : [],
    errors: { soop: Array.isArray(soop) ? null : soop.error, chzzk: Array.isArray(chzzk) ? null : chzzk.error },
  };
  cache.set(game, { at: Date.now(), data });
  return data;
}

module.exports = { getStreams, GAME_CATEGORIES, STREAM_GAME_IDS: Object.keys(GAME_CATEGORIES) };
if (require.main === module) getStreams(process.argv[2] || 'lol').then((d) => { console.log(JSON.stringify(d, null, 1)); process.exit(0); });
