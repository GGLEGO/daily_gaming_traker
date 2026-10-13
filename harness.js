// 하네스 층: 에이전트가 가져온 원문을 "무엇이 새로 왔고 무엇이 바뀌었는지" 판정하고 변경 이벤트로 기록한다.
// 에이전트(game/<회사>/agents.js)는 원문을 그대로 가져오는 일만 하고, 판정·이력·이벤트는 모두 여기서 처리한다.
//  - contentHash : 본문을 평문으로 정규화해 해시 (이미지 URL 토큰 변경 등 노이즈는 무시)
//  - applyRevision: 저장된 항목과 새로 받은 본문을 비교해 바뀌었으면 교체하고 이전 버전을 revisions 에 남긴다
//  - recordEvents : store/changes.json 에 new / updated / error 이벤트를 쌓는다 (홈 "최근 변경" 피드, /api/changes)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'store');
const CHANGES_PATH = path.join(DATA_DIR, 'changes.json');
const MAX_EVENTS = 300;        // 보관할 변경 이벤트 수
const MAX_REVISIONS = 5;       // 항목당 보관할 이전 버전 메타 수
const RECHECK_LATEST = 3;      // 매 실행마다 본문을 다시 확인할 최신 항목 수
const MAX_RECHECK_PER_RUN = 6; // 한 번 실행에서 다시 받아볼 최대 항목 수 (최신 N건 + 제목 바뀐 항목)

function hashText(text) {
  return crypto.createHash('sha1').update(String(text || '').replace(/\s+/g, ' ').trim()).digest('hex');
}

// 저장된 항목 중 이번 실행에서 본문을 다시 확인할 대상을 고른다.
//  - 저장소의 최신 RECHECK_LATEST 건 (공지 수정이 대부분 최근 글에서 일어남)
//  - 목록상 제목이 바뀐 항목 (예: "... (수정 10/8 11:14)")
function pickRecheck(storeItems, listed, known) {
  const latestIds = new Set(storeItems.slice(0, RECHECK_LATEST).map((it) => it.id));
  const picked = [];
  for (const it of listed) {
    const k = known.get(it.id);
    if (!k) continue;
    const titleChanged = !!(it.title && k.title && it.title.trim() !== k.title.trim());
    if (titleChanged || latestIds.has(it.id)) picked.push({ item: it, known: k, titleChanged });
  }
  return picked.slice(0, MAX_RECHECK_PER_RUN);
}

// 새 본문(sanitize 완료)과 저장 항목을 비교. 바뀌었으면 교체하고 true 를 반환한다.
function applyRevision(known, fresh, textOf) {
  const now = new Date().toISOString();
  if (!known.contentHash) known.contentHash = hashText(textOf(known.html || ''));
  const newHash = hashText(textOf(fresh.html || ''));
  const titleChanged = !!(fresh.title && fresh.title.trim() !== (known.title || '').trim());
  if (newHash === known.contentHash && !titleChanged) return null;

  const changed = [];
  if (newHash !== known.contentHash) changed.push('html');
  if (titleChanged) changed.push('title');

  // 이전 버전 메타를 남긴다. 직전 버전만 본문(html)을 함께 보관하고 그보다 오래된 것은 메타만 남긴다.
  const prev = { title: known.title, fetchedAt: known.updatedAt || known.fetchedAt, contentHash: known.contentHash, replacedAt: now, changed, html: known.html };
  known.revisions = [prev, ...(known.revisions || []).map(({ html, ...meta }) => meta)].slice(0, MAX_REVISIONS);

  if (changed.includes('html')) {
    known.html = fresh.html;
    known.contentHash = newHash;
    if (fresh.summary) known.summary = fresh.summary;
  }
  if (titleChanged) known.title = fresh.title;
  if (fresh.image) known.image = fresh.image;
  known.updatedAt = now;
  known.revisionCount = (known.revisionCount || 0) + 1;
  return changed;
}

function loadChanges() {
  try {
    if (fs.existsSync(CHANGES_PATH)) return JSON.parse(fs.readFileSync(CHANGES_PATH, 'utf8'));
  } catch (e) { /* 손상 시 새로 시작 */ }
  return { updatedAt: null, events: [] };
}

function recordEvents(events) {
  if (!events || !events.length) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const store = loadChanges();
  store.events = [...events, ...store.events].slice(0, MAX_EVENTS);
  store.updatedAt = new Date().toISOString();
  const tmp = CHANGES_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, CHANGES_PATH);
}

// 이벤트 생성 도우미: type = new | backfill | updated | error
//  new      새로 올라온 글 (저장소의 최신 게시 시각보다 새 글)
//  backfill 저장소를 채우기 위해 가져온 과거 글 (피드에는 표시하지 않음)
//  updated  원문이 수정되어 본문/제목을 교체한 글
//  error    에이전트 실행 실패
function event(type, game, extra = {}) {
  return { at: new Date().toISOString(), type, game, ...extra };
}

// API 응답용: revisions 에 들어 있는 이전 본문(html)은 빼고 메타만 내려준다.
function publicRevisions(item) {
  return (item.revisions || []).map(({ html, ...meta }) => meta);
}

module.exports = { hashText, pickRecheck, applyRevision, loadChanges, recordEvents, event, publicRevisions, RECHECK_LATEST, MAX_REVISIONS };
