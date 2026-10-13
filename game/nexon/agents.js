// Nexon 에이전트 (메이플스토리, FC 온라인)
// 게임마다 게시판 구조가 달라 data/<game>.js 의 board 값으로 파서를 고른다.
//  - updateBoard : 메이플스토리 업데이트 게시판 (.update_board li → .qs_text .new_board_con)
//  - noticeBoard : FC 온라인 공지사항 중 정기점검·업데이트 안내 (.list_wrap .tr → .content_body)
const path = require('path');
const cheerio = require('cheerio');
const { defineAgent, loadGameData, runCli, fetchText } = require('../../base');

function parseDotDate(s) {
  const m = String(s || '').match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00` : null;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

function firstImage(body, base) {
  const $b = cheerio.load(`<div>${body}</div>`, null, false);
  const src = $b('img').first().attr('src') || null;
  return src ? new URL(src, base).toString() : null;
}

// ---- updateBoard (메이플스토리) ----
const updateBoard = {
  parseList(d, html) {
    const $ = cheerio.load(html);
    const out = [];
    $('.update_board li').each((_, li) => {
      const a = $(li).find('a[href*="/news/update/"], a[href*="/News/Update/"]').first();
      const m = (a.attr('href') || '').match(/\/news\/update\/(\d+)/i);
      if (!m) return;
      const $t = a.find('span').first().clone();
      $t.find('em').remove(); // "수정" 표시 제거
      const title = $t.text().replace(/\s+/g, ' ').trim();
      const date = $(li).find('.heart_date dd').first().text().trim(); // 2026.09.22
      out.push({ id: `update-${m[1]}`, title, url: `${d.base}/News/Update/${m[1]}`, publishedAt: parseDotDate(date), summary: '', image: null });
    });
    return out;
  },
  async listPatches(d) {
    const items = [];
    for (let p = 1; p <= d.pages; p++) {
      const got = updateBoard.parseList(d, await fetchText(d.listUrl(p)));
      if (!got.length) break;
      items.push(...got);
    }
    if (!items.length) throw new Error('.update_board 목록을 찾지 못함 (페이지 구조 변경?)');
    return dedupe(items);
  },
  async fetchDetail(d, item) {
    const $ = cheerio.load(await fetchText(item.url));
    const body = $('.qs_text .new_board_con').first().html() || $('.qs_text').first().html();
    if (!body) throw new Error('.qs_text 본문을 찾지 못함');
    return { html: body, image: firstImage(body, d.base) };
  },
};

// ---- noticeBoard (FC 온라인) ----
const noticeBoard = {
  parseList(d, html) {
    const $ = cheerio.load(html);
    const out = [];
    $('.list_wrap .tr').each((_, el) => {
      const a = $(el).find('a[href*="n4ArticleSN="]').first();
      const m = (a.attr('href') || '').match(/n4ArticleSN=(\d+)/);
      if (!m) return;
      const title = a.find('.subject').text().replace(/\s+/g, ' ').trim();
      const sort = a.find('.sort').text().trim();
      if (!title) return;
      if (!(d.include.test(title) || d.includeSort.test(sort))) return;
      if (d.exclude.test(title)) return;
      out.push({
        id: `notice-${m[1]}`,
        title,
        url: `${d.base}/news/notice/view?n4ArticleSN=${m[1]}`,
        publishedAt: null, // 목록은 "3일 전" 식 상대 시각이라 상세에서 읽는다
        summary: $(el).find('.hidden_desc .text_box').text().replace(/\s+/g, ' ').trim(),
        image: null,
        category: sort,
      });
    });
    return out;
  },
  async listPatches(d) {
    const items = [];
    for (let p = 1; p <= d.pages; p++) items.push(...noticeBoard.parseList(d, await fetchText(d.listUrl(p))));
    if (!items.length) throw new Error('정기점검/업데이트 공지를 찾지 못함 (페이지 구조 변경?)');
    return dedupe(items);
  },
  async fetchDetail(d, item) {
    const $ = cheerio.load(await fetchText(item.url));
    const body = $('.content_body').first().html() || $('.notice-content').first().html();
    if (!body) throw new Error('.content_body 본문을 찾지 못함');
    return {
      html: body,
      image: firstImage(body, d.base),
      publishedAt: parseDotDate($('.view_header .date').first().text()) || item.publishedAt,
      title: $('.view_header .subject').first().text().replace(/\s+/g, ' ').trim() || item.title,
    };
  },
};

const BOARDS = { updateBoard, noticeBoard };

const agents = loadGameData(path.join(__dirname, 'data')).map((d) => {
  const board = BOARDS[d.board];
  if (!board) throw new Error(`${d.game}: 알 수 없는 board "${d.board}" (가능: ${Object.keys(BOARDS).join(', ')})`);
  return defineAgent(d, {
    listPatches: () => board.listPatches(d),
    fetchDetail: (item) => board.fetchDetail(d, item),
  });
});

module.exports = { company: 'Nexon', agents };
if (require.main === module) runCli(agents);
