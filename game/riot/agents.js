// Riot Games 에이전트 (League of Legends, VALORANT, TFT)
// 뉴스 사이트가 Next.js 로 렌더되어 __NEXT_DATA__ JSON 안에 목록과 본문이 들어 있다.
// 게임별 주소·필터는 data/<game>.js 에 있고, 여기서는 그 데이터로 수집 함수를 만든다.
const path = require('path');
const { defineAgent, loadGameData, runCli, fetchText } = require('../../base');

function nextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ 를 찾지 못함 (페이지 구조 변경?)');
  return JSON.parse(m[1]);
}

function findBlades(json) {
  const page = json && json.props && json.props.pageProps && json.props.pageProps.page;
  return (page && page.blades) || [];
}

// 뉴스 태그 페이지에서 패치 목록을 읽는다
async function listPatches(d) {
  const html = await fetchText(d.sourceUrl);
  const blades = findBlades(nextData(html));
  let items = [];
  for (const b of blades) if (Array.isArray(b.items) && b.items.length > items.length) items = b.items;
  if (!items.length) throw new Error('패치 목록 blade 를 찾지 못함');
  return items
    .filter((it) => it.action && it.action.payload && it.action.payload.url)
    .filter((it) => d.titleFilter.test(it.title || ''))
    .map((it) => {
      const rel = it.action.payload.url;
      const url = new URL(rel, d.base).toString();
      const id = rel.replace(/\/+$/, '').split('/').pop();
      const img = (it.imageMedia && it.imageMedia.url) || (it.media && it.media.url) || null;
      return {
        id,
        title: it.title,
        url,
        publishedAt: it.publishedAt || (it.analytics && it.analytics.publishDate) || null,
        summary: it.description && it.description.body ? it.description.body.replace(/<[^>]+>/g, '').trim() : '',
        image: img,
        category: it.category && it.category.title,
      };
    });
}

// 기사 상세 페이지에서 본문(richText blade 전부)을 읽는다
async function fetchDetail(item) {
  const html = await fetchText(item.url);
  const blades = findBlades(nextData(html));
  const masthead = blades.find((b) => b.type === 'articleMasthead');
  const parts = blades.filter((b) => b.richText && b.richText.body).map((b) => b.richText.body);
  if (!parts.length) throw new Error('richText 본문을 찾지 못함');
  let body = parts.join('<hr class="divider">');
  body = body.replace(/<h2 id="patch-top">\s*(&nbsp;)?\s*<\/h2>/, '');
  return {
    html: body,
    image: (masthead && masthead.banner && masthead.banner.url) || item.image,
    publishedAt: (masthead && masthead.publishDate) || item.publishedAt,
    summary: item.summary || (masthead && masthead.description && masthead.description.body) || '',
  };
}

const agents = loadGameData(path.join(__dirname, 'data')).map((d) => defineAgent(d, {
  listPatches: () => listPatches(d),
  fetchDetail,
}));

module.exports = { company: 'Riot Games', agents };
if (require.main === module) runCli(agents);
