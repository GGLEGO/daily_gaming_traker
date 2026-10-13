// Nimble Neuron 에이전트 (이터널 리턴)
// 목록은 사이트가 쓰는 JSON API(/api/v1/posts/news?category=patchnote)로 받고,
// 상세는 게시글 페이지의 .er-article-detail__content 본문을 그대로 가져온다.
const path = require('path');
const cheerio = require('cheerio');
const { defineAgent, loadGameData, runCli, fetchText } = require('../../base');

const HEADERS = { Accept: 'application/json', 'Accept-Language': 'ko-KR,ko;q=0.9' };

function pickKo(article) {
  const i18n = article.i18ns || {};
  return i18n.ko_KR || i18n.ko || Object.values(i18n)[0] || {};
}

async function listPatches(d) {
  const items = [];
  for (let p = 1; p <= d.pages; p++) {
    const json = JSON.parse(await fetchText(d.apiUrl(p), { headers: HEADERS }));
    const articles = json.articles || [];
    if (!articles.length) break;
    for (const a of articles) {
      const ko = pickKo(a);
      const title = (ko.title || '').trim();
      if (!title || a.is_hidden || ko.is_hidden) continue;
      items.push({
        id: `post-${a.id}`,
        title,
        url: ko.content_link || a.url || `${d.base}/posts/news/${a.id}`,
        publishedAt: a.created_at || null,
        summary: (ko.summary || '').trim(),
        image: a.thumbnail_url || null,
      });
    }
  }
  if (!items.length) throw new Error('패치노트 목록을 받지 못함 (API 구조 변경?)');
  const seen = new Set();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

async function fetchDetail(item) {
  const html = await fetchText(item.url, { headers: { 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  const $ = cheerio.load(html);
  const body = $('.er-article-detail__content').first().html();
  if (!body) throw new Error('.er-article-detail__content 본문을 찾지 못함');
  return {
    html: body,
    image: $('.er-article-detail__thumbnail').first().attr('src') || item.image,
    title: $('.er-article-detail__title').first().text().trim() || item.title,
  };
}

const agents = loadGameData(path.join(__dirname, 'data')).map((d) => defineAgent(d, {
  listPatches: () => listPatches(d),
  fetchDetail,
}));

module.exports = { company: 'Nimble Neuron', agents };
if (require.main === module) runCli(agents);
