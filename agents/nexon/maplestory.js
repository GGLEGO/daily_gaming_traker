// 메이플스토리 패치노트 에이전트
// 원본: https://maplestory.nexon.com/News/Update (업데이트 게시판)
// 목록은 .update_board li 에서, 상세는 .qs_text .new_board_con 본문을 그대로 가져온다.
const cheerio = require('cheerio');
const { runAgent, fetchText } = require('../../base');

const BASE = 'https://maplestory.nexon.com';
const LIST_URL = `${BASE}/News/Update`;
const PAGES = 2;

function parseList(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.update_board li').each((_, li) => {
    const a = $(li).find('a[href*="/news/update/"], a[href*="/News/Update/"]').first();
    const href = a.attr('href') || '';
    const m = href.match(/\/news\/update\/(\d+)/i);
    if (!m) return;
    const $t = a.find('span').first().clone();
    $t.find('em').remove(); // "수정" 표시 제거
    const title = $t.text().replace(/\s+/g, ' ').trim();
    const date = $(li).find('.heart_date dd').first().text().trim(); // 2026.09.22
    const dm = date.match(/(\d{4})\.(\d{2})\.(\d{2})/);
    out.push({
      id: `update-${m[1]}`,
      title,
      url: `${BASE}/News/Update/${m[1]}`,
      publishedAt: dm ? `${dm[1]}-${dm[2]}-${dm[3]}T00:00:00+09:00` : null,
      summary: '',
      image: null,
    });
  });
  return out;
}

async function listPatches() {
  const items = [];
  for (let p = 1; p <= PAGES; p++) {
    const html = await fetchText(p === 1 ? LIST_URL : `${LIST_URL}?page=${p}`);
    const got = parseList(html);
    if (!got.length) break;
    items.push(...got);
  }
  if (!items.length) throw new Error('.update_board 목록을 찾지 못함 (페이지 구조 변경?)');
  const seen = new Set();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

async function fetchDetail(item) {
  const html = await fetchText(item.url);
  const $ = cheerio.load(html);
  const body = $('.qs_text .new_board_con').first().html() || $('.qs_text').first().html();
  if (!body) throw new Error('.qs_text 본문을 찾지 못함');
  const $b = cheerio.load(`<div>${body}</div>`, null, false);
  const firstImg = $b('img').first().attr('src') || null;
  return {
    html: body,
    image: firstImg ? new URL(firstImg, BASE).toString() : null,
  };
}

const spec = {
  game: 'maplestory',
  name: '메이플스토리',
  sourceUrl: LIST_URL,
  imageInBody: true, // 대표 이미지가 본문 첫 이미지이므로 기사 상단에는 다시 표시하지 않음
  listPatches,
  fetchDetail,
};

module.exports = { spec, run: () => runAgent(spec) };
if (require.main === module) runAgent(spec).then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
