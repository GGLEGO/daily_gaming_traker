// 저장 백엔드(json / mysql)가 함께 쓰는 도우미: 평문 변환, 검색 점수, 시각 변환
const cheerio = require('cheerio');

function textOf(html) {
  return cheerio.load(`<div>${html || ''}</div>`)('div').text().replace(/\s+/g, ' ').trim();
}

// 검색어(소문자 단어 배열)가 제목·요약·본문에 모두 들어 있는지 보고, 점수·일치 수·발췌문을 만든다. 없으면 null.
function scoreMatch(words, { title, summary, plain }) {
  const t = (title || '').toLowerCase();
  const s = (summary || '').toLowerCase();
  const body = plain || '';
  const b = body.toLowerCase();
  if (!words.every((w) => t.includes(w) || s.includes(w) || b.includes(w))) return null;
  let hits = 0, score = 0;
  for (const w of words) {
    const tHit = t.split(w).length - 1, sHit = s.split(w).length - 1, bHit = b.split(w).length - 1;
    hits += tHit + sHit + bHit;
    score += tHit * 50 + sHit * 10 + bHit;
  }
  const pos = b.indexOf(words[0]);
  const snippet = pos >= 0 ? (pos > 60 ? '…' : '') + body.slice(Math.max(0, pos - 60), pos + 120) + '…' : (summary || '');
  return { hits, score, snippet };
}

function iso(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

function toDate(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : d;
}

module.exports = { textOf, scoreMatch, iso, toDate };
