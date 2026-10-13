// Smilegate 에이전트 (로스트아크)
// 공지사항 목록을 제목 검색(searchtype=2)으로 "업데이트 내역" 글만 받고, 상세는 .article__data .fr-view 본문을 그대로 가져온다.
const path = require('path');
const cheerio = require('cheerio');
const { defineAgent, loadGameData, runCli, fetchText } = require('../../base');

function parseList(d, html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.list a[href*="/News/Notice/Views/"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    const m = href.match(/\/News\/Notice\/Views\/(\d+)/);
    if (!m) return;
    const title = $(a).find('.list__title').first().text().trim();
    if (!d.titleFilter.test(title)) return;
    const utc = $(a).find('.tz-convert').attr('data-utc') || null;
    out.push({
      id: `notice-${m[1]}`,
      title,
      url: `${d.base}/News/Notice/Views/${m[1]}`,
      publishedAt: utc,
      summary: '',
      image: null,
    });
  });
  return out;
}

async function listPatches(d) {
  const items = [];
  for (let p = 1; p <= d.pages; p++) {
    const html = await fetchText(d.listUrl(p));
    const got = parseList(d, html);
    if (!got.length) break;
    items.push(...got);
  }
  if (!items.length) throw new Error('업데이트 내역 공지를 찾지 못함 (페이지 구조 변경?)');
  const seen = new Set();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

async function fetchDetail(d, item) {
  const html = await fetchText(item.url);
  const $ = cheerio.load(html);
  const body = $('.article__data .fr-view').first().html() || $('.article__data').first().html();
  if (!body) throw new Error('.article__data 본문을 찾지 못함');
  const $b = cheerio.load(`<div>${body}</div>`, null, false);
  const firstImg = $b('img').first().attr('src') || null;
  return {
    html: body,
    image: firstImg ? new URL(firstImg, d.base).toString() : null,
    publishedAt: $('.article__data').prevAll().find('.tz-convert').attr('data-utc') || $('.tz-convert').first().attr('data-utc') || item.publishedAt,
    title: $('.article__title').first().text().trim() || item.title,
  };
}

const agents = loadGameData(path.join(__dirname, 'data')).map((d) => defineAgent(d, {
  listPatches: () => listPatches(d),
  fetchDetail: (item) => fetchDetail(d, item),
}));

module.exports = { company: 'Smilegate RPG', agents };
if (require.main === module) runCli(agents);
