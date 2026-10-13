// Overwatch 패치노트 에이전트
// 원본: https://overwatch.blizzard.com/ko-kr/news/patch-notes/
// 서버 렌더 HTML 이라 .PatchNotes-patch 블록을 그대로 파싱한다.
// 최신 페이지는 현재 달 패치만 보여주므로, 저장된 패치가 적을 때는 이전 달 아카이브도 함께 확인한다.
const cheerio = require('cheerio');
const { runAgent, fetchText, loadStore, log } = require('../../base');

const BASE = 'https://overwatch.blizzard.com';
const LIST_URL = `${BASE}/ko-kr/news/patch-notes/`;
const MIN_SEED = 6; // 저장소에 이 수보다 적으면 이전 달 아카이브까지 가져온다

function monthUrl(year, month) {
  return `${BASE}/ko-kr/news/patch-notes/live/${year}/${String(month).padStart(2, '0')}`;
}

function parseKoreanDate(s) {
  // "2026년 10월 6일" 또는 "patch-2026-10-06" -> 2026-10-06T00:00:00+09:00
  const m = (s || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T00:00:00+09:00`;
}

function parsePage(html, pageUrl) {
  const $ = cheerio.load(html);
  const out = [];
  // 패치 목록 바로 앞의 히어로 이미지(시즌 대표 이미지)를 대표 이미지로 사용
  const $list = $('.PatchNotes-list').first();
  const heroImg = $list.prevAll('blz-image').first().attr('src')
    || $('blz-image.desktop_image').first().attr('src') || null;
  $('.PatchNotes-patch').each((_, el) => {
    const $p = $(el);
    const anchor = $p.find('.anchor').first().attr('id') || '';
    const dateText = $p.find('.PatchNotes-date').first().text().trim();
    const title = $p.find('.PatchNotes-patchTitle').first().text().trim();
    const publishedAt = parseKoreanDate(dateText) || parseKoreanDate(anchor);
    const id = anchor || (publishedAt ? 'patch-' + publishedAt.slice(0, 10) : null);
    if (!id || !title) return;
    const $body = $p.clone();
    $body.find('.anchor, .PatchNotes-labels, .PatchNotes-patchTitle').remove();
    const sections = [];
    $p.find('.PatchNotes-sectionTitle').each((_, h) => sections.push($(h).text().trim()));
    out.push({
      id,
      title,
      url: `${pageUrl.replace(/#.*$/, '')}#${anchor || ''}`,
      publishedAt,
      summary: sections.filter(Boolean).slice(0, 6).join(' · '),
      image: heroImg,
      html: $body.html(),
    });
  });
  return out;
}

async function listPatches() {
  const html = await fetchText(LIST_URL);
  const items = parsePage(html, LIST_URL);
  if (!items.length) throw new Error('.PatchNotes-patch 블록을 찾지 못함 (페이지 구조 변경?)');

  const store = loadStore('overwatch', {});
  if (store.items.length < MIN_SEED) {
    // 최신 패치의 달을 기준으로 이전 2개월 아카이브를 추가 수집 (최초 실행 시 이력 확보용)
    const latest = items[0].publishedAt ? new Date(items[0].publishedAt) : new Date();
    let y = latest.getFullYear(), m = latest.getMonth() + 1;
    for (let i = 0; i < 2; i++) {
      m -= 1; if (m === 0) { m = 12; y -= 1; }
      const url = monthUrl(y, m);
      try {
        const h = await fetchText(url);
        const prev = parsePage(h, url);
        log('overwatch', `아카이브 ${y}/${m}: ${prev.length}건`);
        items.push(...prev);
      } catch (e) {
        log('overwatch', `아카이브 ${url} 실패: ${e.message}`);
      }
    }
  }
  // 중복 제거
  const seen = new Set();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

// 목록 페이지에 본문이 이미 포함되어 있어 별도 상세 요청이 필요 없다.
async function fetchDetail(item) { return { html: item.html }; }

const spec = {
  game: 'overwatch',
  name: 'Overwatch',
  sourceUrl: LIST_URL,
  listPatches,
  fetchDetail,
};

module.exports = { spec, run: () => runAgent(spec) };
if (require.main === module) runAgent(spec).then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
