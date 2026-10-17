// Mojang 에이전트 (Minecraft: Java Edition)
// 공식 런처 패치노트 JSON 을 쓴다. 목록(javaPatchNotes.json)에서 항목을 받고,
// 본문은 각 항목의 contentPath 파일(body: HTML)에서 가져온다.
const path = require('path');
const { defineAgent, loadGameData, runCli, fetchText } = require('../../base');

const HEADERS = { Accept: 'application/json', 'Accept-Language': 'en' };

// 본문 안의 상대 경로(/v2/images/...) 를 절대 URL 로 바꾼다 (sanitize 가 엉뚱한 호스트로 붙이지 않도록 미리 처리)
function absolutize(html, assetBase) {
  return String(html || '').replace(/(src|href)="(\/v2\/[^"]*)"/g, '$1="' + assetBase + '$2"');
}

const TYPE_LABEL = { release: '정식 출시', snapshot: '스냅샷', beta: '베타', pending: '예정' };

async function listPatches(d) {
  const json = JSON.parse(await fetchText(d.listUrl, { headers: HEADERS }));
  const entries = json.entries || [];
  if (!entries.length) throw new Error('patch notes 목록을 받지 못함 (구조 변경?)');
  return entries
    .filter((e) => e.id && e.title && e.contentPath)
    .map((e) => ({
      id: `java-${e.id}`,
      title: e.title,
      url: d.sourceUrl,
      publishedAt: e.date || null,
      summary: (e.shortText || '').replace(/\s+/g, ' ').trim(),
      image: e.image && e.image.url ? d.assetBase + e.image.url : null,
      category: TYPE_LABEL[e.type] || e.type || null,
      contentPath: e.contentPath,
    }));
}

async function fetchDetail(d, item) {
  const j = JSON.parse(await fetchText(d.detailBase + item.contentPath, { headers: HEADERS }));
  if (!j.body) throw new Error('본문(body) 을 찾지 못함');
  return { html: absolutize(j.body, d.assetBase) };
}

const agents = loadGameData(path.join(__dirname, 'data')).map((d) => defineAgent(d, {
  listPatches: () => listPatches(d),
  fetchDetail: (item) => fetchDetail(d, item),
}));

module.exports = { company: 'Mojang Studios', agents };
if (require.main === module) runCli(agents);
