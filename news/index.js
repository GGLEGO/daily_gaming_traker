// 게임 뉴스 수집기 (구글 뉴스 RSS 검색, 한국어)
// 홈 "실시간 스트리머 방송" 아래 뉴스 블록용. 분류별 검색어로 RSS 를 받아 제목·언론사·시각·링크를 추려 30분 캐시한다.
const cheerio = require('cheerio');
const { fetchText, log } = require('../base');

const TTL_MS = 30 * 60 * 1000;
const LIMIT = 10;
const EXCLUDE = '-포커 -카지노 -토토 -슬롯 -바카라 -경마';

// 뉴스 분류와 구글 뉴스 검색어 (OR 로 묶은 키워드)
const CATEGORIES = [
  { id: 'all', label: '전체', desc: '아래 분류를 모두 합친 최신 기사' },
  { id: 'update', label: '업데이트·패치', query: '(게임 업데이트 OR 패치노트 OR "패치 노트" OR 신규 시즌 OR 대규모 업데이트)' },
  { id: 'company', label: '게임사', query: '(넥슨 OR 엔씨소프트 OR 크래프톤 OR 라이엇게임즈 OR 블리자드 OR 스마일게이트 OR 넷마블 OR 카카오게임즈 OR 펄어비스 OR 시프트업 OR 님블뉴런)' },
  { id: 'users', label: '유저 반응', query: '(게이머 반응 OR 유저 반응 OR 유저 불만 OR 게임 커뮤니티 OR 게임 논란 OR 게이머 반발)' },
  { id: 'esports', label: 'e스포츠', query: '(e스포츠 OR 이스포츠 OR 롤드컵 OR LCK OR "발로란트 챔피언스" OR OWCS OR PNC)' },
];

const cache = new Map(); // category id -> { at, items }

function feedUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} ${EXCLUDE}`)}&hl=ko&gl=KR&ceid=KR:ko`;
}

function parseRss(xml, category) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const out = [];
  $('item').each((_, el) => {
    const $e = $(el);
    const rawTitle = $e.find('title').first().text().trim();
    const source = $e.find('source').first().text().trim();
    // 구글 뉴스 제목은 "기사 제목 - 언론사" 꼴이라 언론사 꼬리를 뗀다
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)).trim() : rawTitle.replace(/\s-\s[^-]{1,30}$/, '').trim();
    const pub = new Date($e.find('pubDate').first().text().trim());
    out.push({
      title,
      source,
      url: $e.find('link').first().text().trim() || $e.find('guid').first().text().trim(),
      publishedAt: isNaN(pub) ? null : pub.toISOString(),
      category,
    });
  });
  return out;
}

async function fetchCategory(cat) {
  const hit = cache.get(cat.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.items;
  try {
    const xml = await fetchText(feedUrl(cat.query), { headers: { Accept: 'application/rss+xml, application/xml' }, timeout: 15000 });
    const items = parseRss(xml, cat.id);
    cache.set(cat.id, { at: Date.now(), items });
    return items;
  } catch (e) {
    log('news', `${cat.id} 실패: ${e.message}`);
    return hit ? hit.items : [];
  }
}

// 같은 사건을 다룬 여러 매체 기사는 하나만 남긴다: 제목을 단어 집합으로 바꿔 겹치는 비율(자카드)이 높으면 중복으로 본다
const STOP = new Set(['그리고', '위해', '대한', '통해', '관련', '오늘', '내일', '이상', '이하', '역대', '최대', '최초', '공개', '진행', '실시', '예고', '발표', '안내', '출시', '게임', '게임즈']);
function tokens(title) {
  const t = String(title || '').toLowerCase().replace(/[\[\]()'"“”‘’…·,.!?:;~\-–—/|]/g, ' ');
  const set = new Set();
  for (const w of t.split(/\s+/)) {
    const core = w.replace(/(은|는|이|가|을|를|의|에|에서|으로|로|과|와|도|만|까지|부터|에게|께)$/, '');
    if (core.length >= 2 && !STOP.has(core)) set.add(core);
  }
  return set;
}
function similar(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter += 1;
  return inter / Math.min(a.size, b.size); // 짧은 제목 기준 겹침 비율
}
function dedupe(items) {
  const kept = [];
  for (const it of items) {
    if (!it.title) continue;
    const tk = tokens(it.title);
    if (kept.some((k) => similar(k.tk, tk) >= 0.5)) continue;
    kept.push({ ...it, tk });
  }
  return kept.map(({ tk, ...rest }) => rest);
}

async function getNews(categoryId = 'all') {
  const cats = CATEGORIES.filter((c) => c.query);
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat) return null;
  let items;
  if (cat.id === 'all') {
    const lists = await Promise.all(cats.map(fetchCategory));
    items = lists.flat();
  } else {
    items = await fetchCategory(cat);
  }
  items = dedupe(items).sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)).slice(0, LIMIT);
  return { category: cat.id, label: cat.label, fetchedAt: new Date().toISOString(), items };
}

module.exports = { getNews, CATEGORIES };
if (require.main === module) getNews(process.argv[2] || 'all').then((d) => { console.log(JSON.stringify(d, null, 1)); process.exit(0); });
