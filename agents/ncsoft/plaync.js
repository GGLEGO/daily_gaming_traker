// NC(plaync) 커뮤니티 게시판 공통 파서 (아이온2 등)
// 게시판 페이지는 스크립트로 채워지므로, 페이지가 쓰는 API(api-community.plaync.com)를 직접 호출한다.
//   목록: {api}/{service}/board/{alias}/article?pageNo=N&pageSize=20
//   상세: {api}/{service}/board/{alias}/article/{id}
const { fetchText } = require('../../base');

const API = 'https://api-community.plaync.com';
const PAGES = 2;

function longestHtml(obj) {
  let best = '';
  (function walk(o, d) {
    if (d > 8 || !o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string' && v.length > best.length && /<(p|div|img|ul|h\d|table|br)[\s>/]/i.test(v)) best = v;
      else walk(v, d + 1);
    }
  })(obj, 0);
  return best;
}

/**
 * @param {object} o
 * @param {string} o.service  API 서비스 경로 (aion2 등)
 * @param {string} o.alias    게시판 별칭 (update, update_ko)
 * @param {string} o.site     사이트 루트 (https://aion2.plaync.com)
 * @param {string} o.viewPath 게시글 보기 경로 (/board/update/view?articleId=)
 * @param {RegExp} [o.titleFilter]
 */
function makePlayncHandlers(o) {
  const headers = { Accept: 'application/json', Origin: o.site, Referer: `${o.site}/` };

  async function listPatches() {
    const items = [];
    for (let p = 1; p <= PAGES; p++) {
      const json = JSON.parse(await fetchText(`${API}/${o.service}/board/${o.alias}/article?pageNo=${p}&pageSize=20`, { headers }));
      const list = json.contentList || [];
      if (!list.length) break;
      for (const a of list) {
        const title = (a.title || '').trim();
        if (!title || (o.titleFilter && !o.titleFilter.test(title))) continue;
        const ts = a.timestamps || {};
        items.push({
          id: `article-${a.id}`,
          title,
          url: `${o.site}${o.viewPath}${a.id}`,
          publishedAt: ts.postedAt || ts.publishedAt || null,
          summary: (a.summary || '').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim(),
          image: (a.thumbnailUrlList && a.thumbnailUrlList[0]) || a.thumbnailUrl || null,
        });
      }
      if (json.hasMore === false) break;
    }
    if (!items.length) throw new Error('게시글 목록을 받지 못함 (API 구조 변경?)');
    const seen = new Set();
    return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
  }

  async function fetchDetail(item) {
    const id = item.id.replace(/^article-/, '');
    const json = JSON.parse(await fetchText(`${API}/${o.service}/board/${o.alias}/article/${id}`, { headers }));
    const content = json.content;
    const html = typeof content === 'string' ? content : longestHtml(json);
    if (!html) throw new Error('본문 content 를 찾지 못함');
    return { html };
  }

  return { listPatches, fetchDetail };
}

module.exports = { makePlayncHandlers };
