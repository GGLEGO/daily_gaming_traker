// FC 온라인 패치노트 에이전트
// 원본: https://fconline.nexon.com/news/notice/list
// "업데이트" 게시판은 이미지 위주의 이벤트 페이지로만 연결되어 본문을 가져올 수 없다.
// 대신 공지사항 중 정기점검·업데이트 안내 글(업데이트 내용이 항목별로 정리되어 있음)을 패치 내역으로 가져온다.
const cheerio = require('cheerio');
const { runAgent, fetchText } = require('../../base');

const BASE = 'https://fconline.nexon.com';
const LIST_URL = `${BASE}/news/notice/list`;
const INCLUDE = /정기점검|업데이트|패치/;
const EXCLUDE = /사전\s*안내|예정\s*안내|미진행|연장|당첨자|설문/;

function parseDate(s) {
  const m = String(s || '').match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00` : null;
}

const PAGES = 4; // 공지 목록 페이지 수 (페이지당 20건)

function parseList(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.list_wrap .tr').each((_, el) => {
    const a = $(el).find('a[href*="n4ArticleSN="]').first();
    const href = a.attr('href') || '';
    const m = href.match(/n4ArticleSN=(\d+)/);
    if (!m) return;
    const title = a.find('.subject').text().replace(/\s+/g, ' ').trim();
    const sort = a.find('.sort').text().trim();
    if (!title) return;
    if (!(INCLUDE.test(title) || /점검|업데이트/.test(sort))) return;
    if (EXCLUDE.test(title)) return;
    out.push({
      id: `notice-${m[1]}`,
      title,
      url: `${BASE}/news/notice/view?n4ArticleSN=${m[1]}`,
      publishedAt: null, // 목록은 "3일 전" 식 상대 시각이라 상세에서 읽는다
      summary: $(el).find('.hidden_desc .text_box').text().replace(/\s+/g, ' ').trim(),
      image: null,
      category: sort,
    });
  });
  return out;
}

async function listPatches() {
  const items = [];
  for (let p = 1; p <= PAGES; p++) {
    const html = await fetchText(p === 1 ? LIST_URL : `${LIST_URL}?n4PageNo=${p}`);
    items.push(...parseList(html));
  }
  if (!items.length) throw new Error('정기점검/업데이트 공지를 찾지 못함 (페이지 구조 변경?)');
  const seen = new Set();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

async function fetchDetail(item) {
  const html = await fetchText(item.url);
  const $ = cheerio.load(html);
  const body = $('.content_body').first().html() || $('.notice-content').first().html();
  if (!body) throw new Error('.content_body 본문을 찾지 못함');
  const $b = cheerio.load(`<div>${body}</div>`, null, false);
  const firstImg = $b('img').first().attr('src') || null;
  return {
    html: body,
    image: firstImg ? new URL(firstImg, BASE).toString() : null,
    publishedAt: parseDate($('.view_header .date').first().text()) || item.publishedAt,
    title: $('.view_header .subject').first().text().replace(/\s+/g, ' ').trim() || item.title,
  };
}

const spec = {
  game: 'fconline',
  name: 'FC 온라인',
  sourceUrl: LIST_URL,
  imageInBody: true,
  listPatches,
  fetchDetail,
};

module.exports = { spec, run: () => runAgent(spec) };
if (require.main === module) runAgent(spec).then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
