// PUBG: 배틀그라운드 패치노트 에이전트
// 원본: https://pubg.com/ko/news?category=patch_notes
// 페이지가 Nuxt 로 렌더되어 window.__NUXT__ 상태 안에 목록(posts)과 본문(content HTML)이 들어 있다.
const { runAgent, fetchText } = require('../../base');

const BASE = 'https://pubg.com';
const LIST_URL = `${BASE}/ko/news?category=patch_notes`;
const HEADERS = { 'Accept-Language': 'ko-KR,ko;q=0.9' };

// window.__NUXT__=(function(a,b,...){return {...}}(...)) 형태를 평가해 객체로 돌려준다
function nuxtState(html) {
  const i = html.indexOf('window.__NUXT__=');
  if (i < 0) throw new Error('__NUXT__ 상태를 찾지 못함 (페이지 구조 변경?)');
  const j = html.indexOf('</script>', i);
  const code = html.slice(i + 'window.__NUXT__='.length, j).replace(/;\s*$/, '');
  // eslint-disable-next-line no-new-func
  return new Function(`return ${code}`)();
}

// 상태 트리에서 조건에 맞는 값을 깊이 우선으로 찾는다
function find(obj, pred, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  if (pred(obj)) return obj;
  for (const k of Object.keys(obj)) {
    const r = find(obj[k], pred, depth + 1);
    if (r) return r;
  }
  return null;
}

function kst(s) {
  // "2026-09-09 06:00:00" (KST) -> ISO
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00` : null;
}

async function listPatches() {
  const html = await fetchText(LIST_URL, { headers: HEADERS });
  const state = nuxtState(html);
  const posts = find(state, (o) => Array.isArray(o) && o.length > 0 && o[0] && typeof o[0] === 'object' && o[0].postId && o[0].title);
  if (!posts) throw new Error('뉴스 목록(posts)을 찾지 못함');
  return posts
    .filter((p) => !p.category || p.category === 'patch_notes')
    .map((p) => {
      const img = (p.images || []).find((x) => x.imageUrl) || {};
      return {
        id: `post-${p.postId}`,
        title: p.title,
        url: `${BASE}/ko/news/${p.postId}`,
        publishedAt: kst(p.displayStartTime) || kst(p.createdAt) || null,
        summary: p.summary || '',
        image: img.imageUrl || img.thumbUrl || null,
      };
    });
}

async function fetchDetail(item) {
  const html = await fetchText(item.url, { headers: HEADERS });
  const state = nuxtState(html);
  // 가장 긴 HTML 문자열이 본문이다 (postDetailContent.content)
  let best = '';
  (function walk(o, d) {
    if (d > 10 || !o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (typeof v === 'string' && v.length > best.length && /<(h\d|p|ul|div|img)[\s>]/i.test(v)) best = v;
      else walk(v, d + 1);
    }
  })(state, 0);
  if (!best) throw new Error('본문 content 를 찾지 못함');
  return { html: best };
}

const spec = {
  game: 'pubg',
  name: 'PUBG: 배틀그라운드',
  sourceUrl: LIST_URL,
  listPatches,
  fetchDetail,
};

module.exports = { spec, run: () => runAgent(spec) };
if (require.main === module) runAgent(spec).then((r) => { console.log(r); process.exit(r.ok ? 0 : 1); });
