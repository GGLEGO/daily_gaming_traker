// 로스트아크 패치노트 에이전트
// 원본: https://lostark.game.onstove.com/News/Notice/List (공지사항 중 "업데이트 내역 안내" 글)
// 목록은 제목 검색(searchtype=2)으로 업데이트 내역 글만 받고, 상세는 .article__data .fr-view 본문을 그대로 가져온다.
const cheerio = require('cheerio');
const { runAgent, fetchText } = require('../../base');

const BASE = 'https://lostark.game.onstove.com';
const LIST_URL = `${BASE}/News/Notice/List`;
const SEARCH = '업데이트 내역';
const PAGES = 2; // 확인할 목록 페이지 수

function listUrl(page) {
  return `${LIST_URL}?page=${page}&searchtype=2&searchtext=${encodeURIComponent(SEARCH)}&noticetype=all`;
}

function parseList(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.list a[href*="/News/Notice/Views/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/\/News\/Notice\/Views\/(\d+)/);
    if (!m) return;
    const title = $(a).find('.list__title').first().text().trim();
    if (!/업데이트\s*내역/.test(title)) return;
    const utc = $(a).find('.tz-convert').attr('data-utc') || null;
    out.push({
      id: `notice-${m[1]}`,
      title,
      url: `${BASE}/News/Notice/Views/${m[1]}`,
      publishedAt: utc,
      summary: '',
      image: null,
    });
  });
  return out;
}

async function listPatches() {
  const items = [];
  for (let p = 1; p <= PAGES; p++) {
    const html = await fetchText(listUrl(p));
    const got = parseList(html);
    if (!got.length) break;
    items.push(...got);
  }
  if (!items.length) throw new Error('업데이트 내역 공지를 찾지 못함 (페이지 구조 변경?)');
  const seen = new Set();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

async function fetchDetail(item) {
  const html = await fetchText(item.url);
  const $ = cheerio.load(html);
  const body = $('.article__data .fr-view').first().html() || $('.article__data').first().html();
  if (!body) throw new Error('.article__data 본문을 찾지 못함');
  const $b = cheerio.load(`<div>${body}</div>`, null, false);
  const firstImg = $b('img').first().attr('src') || null;
  return {
    html: body,
    image: firstImg ? new URL(firstImg, BASE).toString() : null,
    publishedAt: $('.article__data').prevAll().find('.tz-convert').attr('data-utc') || $('.tz-convert').first().attr('data-utc') || item.publishedAt,
    title: $('.article__title').first().text().trim() || item.title,
  };
}

const spec = {
  game: 'lostark',
  name: '로스트아크',
  sourceUrl: LIST_URL,
  imageInBody: true, // 대표 이미지가 본문 첫 이미지이므로 기사 상단에는 다시 표시하지 않음
  listPatches,
  fetchDetail,
};

module.exports = { spec, run: () => runAgent(spec) };
if (require.main === module) runAgent(spec).then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
