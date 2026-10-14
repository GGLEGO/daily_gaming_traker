/* Daily Gaming Tracker 프론트 스크립트: 홈 / 게임 페이지 렌더링 */
(function () {
  'use strict';

  const GAME_MARK = { lol: 'LoL', overwatch: 'OW', valorant: 'VAL', lostark: 'LA', maplestory: 'MS' };
  let GAMES = null; // /api/games 캐시

  async function loadGames() {
    if (!GAMES) GAMES = await getJSON('/api/games');
    for (const g of GAMES) GAME_MARK[g.id] = g.short;
    return GAMES;
  }

  // 네비게이션: 장르 블록(FPS / RPG / AOS / 스포츠)을 누르면 그 장르의 게임 버튼이 부드럽게 펼쳐진다
  async function renderNav() {
    const box = $('#game-buttons');
    if (!box) return;
    const current = location.pathname.split('/').filter(Boolean)[0];
    try {
      const [games, genres] = await Promise.all([loadGames(), getJSON('/api/genres')]);
      const byId = Object.fromEntries(games.map((g) => [g.id, g]));
      const blocks = genres.map((ge) => ({ ...ge, games: ge.games.map((id) => byId[id]).filter(Boolean) })).filter((ge) => ge.games.length);
      const currentGenre = (blocks.find((ge) => ge.games.some((g) => g.id === current)) || {}).id || null;
      box.innerHTML = `
        <div class="genre-tabs" role="tablist">
          ${blocks.map((ge) => `<button class="genre-tab${ge.id === currentGenre ? ' active' : ''}" type="button" data-genre="${esc(ge.id)}" aria-expanded="${ge.id === currentGenre}">
            <span class="genre-name">${esc(ge.label)}</span><span class="genre-desc">${esc(ge.desc || '')}</span><span class="genre-count">${ge.games.length}</span>
          </button>`).join('')}
        </div>
        <div class="genre-panels">
          ${blocks.map((ge) => `<div class="genre-panel${ge.id === currentGenre ? ' open' : ''}" data-genre="${esc(ge.id)}"><div class="genre-panel-inner"><div class="genre-games">
            ${ge.games.map((g) => `<a class="game-btn game-btn-${g.id}${g.id === current ? ' active' : ''}" data-game="${g.id}" href="/${g.id}"><span class="game-btn-mark">${esc(g.short)}</span> ${esc(g.label)}</a>`).join('')}
          </div></div></div>`).join('')}
        </div>`;
      box.querySelector('.genre-tabs').addEventListener('click', (ev) => {
        const tab = ev.target.closest('.genre-tab');
        if (!tab) return;
        const id = tab.dataset.genre;
        const willOpen = !tab.classList.contains('active');
        box.querySelectorAll('.genre-tab').forEach((t) => { const on = willOpen && t.dataset.genre === id; t.classList.toggle('active', on); t.setAttribute('aria-expanded', String(on)); });
        box.querySelectorAll('.genre-panel').forEach((p) => p.classList.toggle('open', willOpen && p.dataset.genre === id));
      });
    } catch (e) { /* 네비게이션 실패는 조용히 무시 */ }
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function getJSON(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    return res.json();
  }

  function fmtDate(iso, withTime) {
    if (!iso) return '날짜 미상';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    const opt = { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' };
    if (withTime) Object.assign(opt, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('ko-KR', opt);
  }

  function relTime(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return '방금 전';
    if (m < 60) return `${m}분 전`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}시간 전`;
    return `${Math.round(h / 24)}일 전`;
  }

  function setTodayLine() {
    const el = $('#today-line');
    if (el) el.textContent = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }) + ' · 오늘의 게임 뉴스';
  }

  function thumb(game, image, big) {
    if (image) return `<img src="${esc(image)}" alt="" loading="lazy">`;
    return big ? `<div class="hero-fallback">${esc(GAME_MARK[game] || game)}</div>` : esc(GAME_MARK[game] || game);
  }

  // ---------- Steam 할인 배너 (슬라이드) ----------
  // 할인 종료 표시: "할인 종료 10월 15일 (목) 까지 · 3일 남음"
  function dealEnds(d) {
    const what = d.free ? '무료 배포 종료' : '할인 종료';
    if (d.discountEndsAt) {
      const end = new Date(d.discountEndsAt);
      if (!isNaN(end)) {
        const left = end.getTime() - Date.now();
        const days = Math.floor(left / 86400e3), hours = Math.floor((left % 86400e3) / 3600e3);
        const remain = left <= 0 ? '곧 종료' : days >= 1 ? `${days}일 ${hours}시간 남음` : `${Math.max(hours, 1)}시간 남음`;
        const when = end.toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
        return `⏳ ${what} <strong>${esc(when)}</strong> 까지 · ${esc(remain)}`;
      }
    }
    if (d.discountEndsText) return `⏳ ${esc(d.discountEndsText)}`;
    return `⏳ ${what}일 미정 (상점 페이지에서 확인)`;
  }

  async function renderDeals() {
    const box = $('#deals');
    if (!box) return;
    let data;
    try { data = await getJSON('/api/deals'); } catch (e) { return; }
    // 장르별(FPS / RPG / AOS / 스포츠) 할인율 상위 5개. 옛 형식(items 만 있음)도 한 탭으로 보여준다
    const genres = (data.genres && data.genres.length ? data.genres : [{ id: 'all', label: '전체', items: data.items || [] }])
      .map((g) => ({ ...g, items: (g.items || []).slice(0, g.free ? 8 : 5) }))
      .filter((g) => g.items.length);
    if (!genres.length) return;
    const track = $('#deals-track');
    const dots = $('#deals-dots');
    const tabs = $('#deals-genres');
    $('#deals-updated').textContent = (data.updatedAt ? `갱신 ${relTime(data.updatedAt)}` : '') + (data.ranking ? ` · 순위 = ${data.ranking}` : '');
    box.hidden = false;

    // 무료 배포(100% 할인) 항목은 배지·가격·문구를 "무료"로 보여주고, DLC 면 본편 이름을 함께 표시한다
    const isFree = (d) => d.free || d.discount >= 100;
    const typeTag = (d) => (d.type && d.type !== 'game' ? `<span class="deal-type">${esc(d.typeLabel || d.type)}${d.parentName ? ` · ${esc(d.parentName)}` : ''}</span>` : '');
    const slide = (d, i, g) => `
      <a class="deal${isFree(d) ? ' deal-free' : ''}" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">
        <div class="deal-media"><img src="${esc(d.image)}" alt="" loading="${i === 0 ? 'eager' : 'lazy'}"${d.capsule ? ` onerror="this.onerror=null;this.src='${esc(d.capsule)}'"` : ''}><span class="deal-pct">${isFree(d) ? '무료' : `-${d.discount}%`}</span></div>
        <div class="deal-body">
          <span class="deal-rank">${g.free ? `무료 배포 ${i + 1} · STEAM 한정 기간 100% 할인` : `${esc(g.label)} 인기 할인 ${i + 1}위 · 접속자 × 할인율`}</span>
          <span class="deal-name">${esc(d.name)}</span>
          <span class="deal-prices"><span class="deal-original">${esc(d.originalPrice)}</span><span class="deal-final">${isFree(d) ? '무료' : esc(d.finalPrice)}</span>${isFree(d) ? '<span class="deal-keep">지금 받으면 영구 소장</span>' : ''}</span>
          <span class="deal-meta">${typeTag(d)}${d.reviewText ? `<span class="deal-review-${esc(d.review || 'mixed')}">${esc(d.reviewText)}</span>` : ''}${d.released ? `<span>출시 ${esc(d.released)}</span>` : ''}</span>
          <span class="deal-ends">${dealEnds(d)}</span>
          <span class="deal-players">${typeof d.players === 'number' ? `👥 ${d.playersOf === 'parent' ? '본편 ' : ''}지금 접속 중 <strong>${d.players.toLocaleString('ko-KR')}</strong>명` : '👥 접속자 수 집계 불가'}${typeof d.score === 'number' && !g.free ? ` · 인기 할인 점수 ${d.score}` : ''}</span>
          <span class="deal-cta">Steam 상점에서 보기 ↗</span>
        </div>
      </a>`;

    let current = genres[0], idx = 0, timer = null;
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    // 마지막 슬라이드에서 다음으로 가면 다음 장르의 첫 슬라이드로, 첫 슬라이드에서 이전으로 가면 이전 장르의 마지막 슬라이드로 이어진다
    const go = (n) => {
      const gi = genres.indexOf(current);
      if (n >= current.items.length) { showGenre(genres[(gi + 1) % genres.length].id, 0); return; }
      if (n < 0) { const prev = genres[(gi - 1 + genres.length) % genres.length]; showGenre(prev.id, prev.items.length - 1); return; }
      idx = n;
      track.style.transform = `translateX(-${idx * 100}%)`;
      dots.querySelectorAll('.deals-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
    };
    const play = () => { stop(); timer = setInterval(() => go(idx + 1), 5000); };
    const showGenre = (id, startIdx = 0) => {
      current = genres.find((g) => g.id === id) || genres[0];
      if (tabs) tabs.querySelectorAll('.deals-genre').forEach((t) => t.classList.toggle('active', t.dataset.genre === current.id));
      track.style.transition = 'none';
      track.innerHTML = current.items.map((d, i) => slide(d, i, current)).join('');
      idx = Math.min(Math.max(startIdx, 0), current.items.length - 1);
      dots.innerHTML = current.items.map((_, i) => `<button class="deals-dot${i === idx ? ' active' : ''}" type="button" aria-label="${i + 1}번째 게임"></button>`).join('');
      track.style.transform = `translateX(-${idx * 100}%)`;
      requestAnimationFrame(() => { track.style.transition = ''; });
      play();
    };
    if (tabs) {
      tabs.innerHTML = genres.map((g) => `<button class="deals-genre${g.free ? ' deals-genre-free' : ''}" type="button" data-genre="${esc(g.id)}">${esc(g.label)}<span class="deals-genre-count">${g.items.length}</span></button>`).join('');
      tabs.addEventListener('click', (ev) => { const t = ev.target.closest('.deals-genre'); if (t) showGenre(t.dataset.genre); });
    }
    box.querySelector('.deals-prev').addEventListener('click', () => { go(idx - 1); play(); });
    box.querySelector('.deals-next').addEventListener('click', () => { go(idx + 1); play(); });
    dots.addEventListener('click', (ev) => { const i = [...dots.children].indexOf(ev.target); if (i >= 0) { go(i); play(); } });
    box.addEventListener('mouseenter', stop);
    box.addEventListener('mouseleave', play);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : play()));
    showGenre(genres[0].id);
  }

  // ---------- 실시간 스트리머 방송 (SOOP + 치지직) ----------
  const PLATFORMS = [
    { key: 'soop', label: 'SOOP', mark: 'SOOP', home: 'https://www.sooplive.co.kr/' },
    { key: 'chzzk', label: '치지직', mark: 'CHZZK', home: 'https://chzzk.naver.com/' },
  ];
  const fmtNum = (n) => Number(n || 0).toLocaleString('ko-KR');

  function streamRow(s, i, showCategory) {
    return `
      <li><a class="stream" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">
        <span class="stream-rank">${i + 1}</span>
        <span class="stream-thumb">${s.thumb ? `<img src="${esc(s.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span class="stream-live">LIVE</span></span>
        <span class="stream-body">
          <span class="stream-name">${s.avatar ? `<img src="${esc(s.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${esc(s.name || '')}</span>
          ${showCategory && s.category ? `<span class="stream-category">${esc(s.category)}</span>` : ''}
          <span class="stream-title" title="${esc(s.title || '')}">${esc(s.title || '')}</span>
          <span class="stream-viewers">시청자 <strong>${fmtNum(s.viewers)}</strong>명</span>
        </span>
      </a></li>`;
  }

  // 대회·리그·경기 일정 열
  const fmtKst = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
  };
  function esportsColumn(es) {
    const items = (es && es.items) || [];
    const rows = items.map((it) => {
      if (it.kind === 'match') {
        const teams = (it.teams || []).map((t) => esc(t.name)).join(' <span class="es-vs">vs</span> ');
        const badge = it.status === 'live' ? '<span class="es-live">LIVE</span>' : '';
        return `<li><a class="es-item" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">
          <span class="es-time">${esc(fmtKst(it.startAt))}${badge}</span>
          <span class="es-body"><span class="es-league">${esc(it.league || '')}${it.stage ? ` · ${esc(it.stage)}` : ''}${it.region ? ` · ${esc(it.region)}` : ''}</span>
          <span class="es-teams">${teams || esc(it.stage || '경기 일정')}</span>${it.format ? `<span class="es-format">${esc(it.format)}</span>` : ''}</span>
        </a></li>`;
      }
      return `<li><a class="es-item" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">
        <span class="es-time">${esc(fmtDate(it.startAt))}</span>
        <span class="es-body"><span class="es-league">${esc(it.league || '')}</span><span class="es-teams">${esc(it.title)}</span></span>
      </a></li>`;
    }).join('');
    return `
      <div class="streams-col es-col">
        <div class="streams-col-head">
          <span class="streams-col-title"><span class="platform-mark platform-es">일정</span>대회 · 리그 · 경기</span>
          <span class="streams-col-meta">${esc((es && es.label) || '')}</span>
        </div>
        ${items.length ? `<ul class="stream-list es-list">${rows}</ul>`
          : `<div class="streams-empty">${es && es.error ? '일정 정보를 가져오지 못했습니다.' : '예정된 대회·리그 정보가 없습니다.'}</div>`}
      </div>`;
  }

  async function renderStreamsPanel(panel, game) {
    panel.innerHTML = [...PLATFORMS, 'es'].map(() => '<div class="card skeleton" style="min-height:260px"></div>').join('');
    let data, es = null;
    try {
      [data, es] = await Promise.all([getJSON(`/api/streams/${game}`), getJSON(`/api/esports/${game}`).catch(() => null)]);
    } catch (e) { panel.innerHTML = `<div class="empty" style="grid-column:1/-1">${esc(e.message)}</div>`; return; }
    panel.classList.toggle('no-es', !es);
    panel.innerHTML = PLATFORMS.map((p) => {
      const list = data[p.key] || [];
      const err = data.errors && data.errors[p.key];
      return `
        <div class="streams-col">
          <div class="streams-col-head">
            <span class="streams-col-title"><span class="platform-mark platform-${p.key}">${p.mark}</span>${p.label} · ${esc(data.label)}</span>
            <span class="streams-col-meta">시청자순 TOP ${list.length || 5}</span>
          </div>
          ${list.length ? `<ul class="stream-list">${list.map((s, i) => streamRow(s, i, !!data.showCategory)).join('')}</ul>`
            : `<div class="streams-empty">${err ? '방송 정보를 가져오지 못했습니다.' : '지금 방송 중인 스트리머가 없습니다.'}</div>`}
        </div>`;
    }).join('') + (es ? esportsColumn(es) : '') + `<div class="streams-foot"><span>갱신 ${relTime(data.fetchedAt)} · 2분마다 새로 고칩니다</span><span>${PLATFORMS.map((p) => `<a href="${p.home}" target="_blank" rel="noopener noreferrer">${p.label} ↗</a>`).join(' · ')}</span></div>`;
  }

  // 홈: 게임 탭을 눌러 게임별 방송을 본다
  async function renderStreamsHome() {
    const box = $('#streams');
    if (!box) return;
    let games;
    try { await loadGames(); games = (await getJSON('/api/streams')).games; } catch (e) { return; }
    if (!games.length) return;
    const tabs = $('#streams-tabs');
    const panel = $('#streams-panel');
    tabs.innerHTML = games.map((g, i) => `<button class="streams-tab${i === 0 ? ' active' : ''}" type="button" data-game="${esc(g.id)}"><span class="game-btn-mark">${esc(g.short || GAME_MARK[g.id] || g.id)}</span>${esc(g.label)}</button>`).join('');
    box.hidden = false;
    let current = games[0].id;
    const show = (id) => {
      current = id;
      tabs.querySelectorAll('.streams-tab').forEach((t) => t.classList.toggle('active', t.dataset.game === id));
      renderStreamsPanel(panel, id);
    };
    tabs.addEventListener('click', (ev) => { const t = ev.target.closest('.streams-tab'); if (t) show(t.dataset.game); });
    show(current);
    setInterval(() => { if (!document.hidden) renderStreamsPanel(panel, current); }, 2 * 60 * 1000);
  }

  // ---------- 게임 페이지 ----------
  async function renderGame() {
    const parts = location.pathname.split('/').filter(Boolean);
    const game = parts[0];
    const wantId = parts[1] ? decodeURIComponent(parts[1]) : null;

    let data;
    try {
      data = await getJSON(`/api/${game}/patches`);
    } catch (e) {
      $('#patch-article').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    const g = data.game;
    document.title = `${g.label} 패치 노트 - Daily Gaming Tracker`;
    $('#crumb-game').textContent = g.label;
    $('#game-title').textContent = `${g.label} 패치 노트`;
    $('#game-tagline').textContent = `${g.tagline} · 마지막 확인 ${data.lastSuccess ? fmtDate(data.lastSuccess, true) : '없음'}`;
    $('#source-box').innerHTML = `원문: <a href="${esc(g.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(g.sourceUrl)}</a>`;

    const items = data.items;
    if (!items.length) {
      $('#patch-article').innerHTML = '<div class="empty">아직 수집된 패치 노트가 없습니다. 에이전트가 첫 수집을 마치면 표시됩니다.</div>';
      $('#patch-list').innerHTML = '';
      return;
    }

    const list = $('#patch-list');
    list.innerHTML = items.map((it) => `<li><a href="/${game}/${encodeURIComponent(it.id)}" data-id="${esc(it.id)}"><span>${esc(it.title)}</span><span class="meta">${fmtDate(it.publishedAt)}${it.updatedAt ? ' <span class="rev-badge" title="원문 수정 반영 ' + esc(fmtDate(it.updatedAt, true)) + '">수정</span>' : ''}</span></a></li>`).join('');

    async function show(id, push) {
      const target = items.find((x) => x.id === id) || items[0];
      list.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.id === target.id));
      const art = $('#patch-article');
      art.innerHTML = '<div class="card skeleton tall"></div>';
      try {
        const { item } = await getJSON(`/api/${game}/patches/${encodeURIComponent(target.id)}`);
        art.innerHTML = `
          ${item.image && !g.imageInBody ? `<div class="patch-hero"><img src="${esc(item.image)}" alt=""></div>` : ''}
          <div class="patch-head">
            <div class="meta"><span class="badge badge-${game}">${esc(g.short)}</span><span>${esc(g.label)}</span>${item.id === items[0].id ? '<span class="badge" style="background:var(--accent);color:var(--ink)">최신</span>' : ''}</div>
            <h2 class="patch-title">${esc(item.title)}</h2>
            <div class="patch-meta">
              <span>게시 ${fmtDate(item.publishedAt)}</span>
              <span>수집 ${fmtDate(item.fetchedAt, true)}</span>
              ${item.updatedAt ? `<span class="rev-note">원문 수정 반영 ${fmtDate(item.updatedAt, true)}${item.revisionCount > 1 ? ` (${item.revisionCount}회)` : ''}</span>` : ''}
              <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">원문 보기 ↗</a>
            </div>
            ${item.revisions && item.revisions.length ? `<details class="rev-history"><summary>수정 이력 ${item.revisions.length}건</summary><ul>${item.revisions.map((r) => `<li>${fmtDate(r.replacedAt, true)} · ${(r.changed || []).map((c) => c === 'html' ? '본문' : '제목').join('·')} 변경${r.title && r.title !== item.title ? ` · 이전 제목 "${esc(r.title)}"` : ''}</li>`).join('')}</ul></details>` : ''}
          </div>
          <div class="patch-body patch-body-${game}">${item.html}</div>`;
        if (push) history.pushState({ id: target.id }, '', `/${game}/${encodeURIComponent(target.id)}`);
        document.title = `${item.title} - Daily Gaming Tracker`;
        if (push) window.scrollTo({ top: $('#patch-article').offsetTop - 80, behavior: 'smooth' });
      } catch (e) {
        art.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      }
    }

    list.addEventListener('click', (ev) => {
      const a = ev.target.closest('a[data-id]');
      if (!a) return;
      ev.preventDefault();
      show(a.dataset.id, true);
    });
    window.addEventListener('popstate', () => {
      const p = location.pathname.split('/').filter(Boolean);
      show(p[1] ? decodeURIComponent(p[1]) : items[0].id, false);
    });

    show(wantId || items[0].id, false);
  }

  // ---------- 게임 뉴스 (구글 뉴스) ----------
  async function renderNews() {
    const box = $('#news');
    if (!box) return;
    const tabs = $('#news-tabs');
    const list = $('#news-list');
    const foot = $('#news-foot');
    let current = 'all';
    async function load(cat) {
      list.innerHTML = '<div class="card skeleton" style="min-height:220px"></div>';
      let data;
      try { data = await getJSON(`/api/news?cat=${encodeURIComponent(cat)}`); }
      catch (e) { list.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      if (!tabs.children.length) {
        tabs.innerHTML = data.categories.map((c) => `<button class="gnews-tab${c.id === current ? ' active' : ''}" type="button" data-cat="${esc(c.id)}">${esc(c.label)}</button>`).join('');
      }
      tabs.querySelectorAll('.gnews-tab').forEach((t) => t.classList.toggle('active', t.dataset.cat === cat));
      list.innerHTML = data.items.length ? data.items.map((n) => `
        <a class="gnews-item" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">
          <span class="gnews-source">${esc(n.source || '뉴스')}</span>
          <span class="gnews-title">${esc(n.title)}</span>
          <span class="gnews-time">${n.publishedAt ? esc(relTime(n.publishedAt)) : ''}</span>
        </a>`).join('') : '<div class="empty">해당 분류의 기사를 찾지 못했습니다.</div>';
      foot.innerHTML = `<span>갱신 ${relTime(data.fetchedAt)} · 30분마다 새로 고칩니다</span><span>출처 <a href="https://news.google.com/?hl=ko&gl=KR&ceid=KR:ko" target="_blank" rel="noopener noreferrer">Google 뉴스 ↗</a></span>`;
      box.hidden = false;
    }
    tabs.addEventListener('click', (ev) => { const t = ev.target.closest('.gnews-tab'); if (t) { current = t.dataset.cat; load(current); } });
    await load(current);
    setInterval(() => { if (!document.hidden) load(current); }, 30 * 60 * 1000);
  }

  // ---------- 검색 페이지 ----------
  async function renderSearch() {
    const q = new URLSearchParams(location.search).get('q') || '';
    const input = document.querySelector('.search-input');
    if (input) input.value = q;
    document.title = `"${q}" 검색 - Daily Gaming Tracker`;
    $('#search-title').textContent = q ? `"${q}" 검색 결과` : '검색';
    const box = $('#search-results');
    if (!q.trim()) { box.innerHTML = '<div class="empty">검색어를 입력해 주세요.</div>'; $('#search-tagline').textContent = ''; return; }
    let data;
    try { data = await getJSON(`/api/search?q=${encodeURIComponent(q)}`); }
    catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    $('#search-tagline').textContent = `총 ${data.total}건 · 제목, 요약, 본문에서 찾았습니다.`;
    const words = q.trim().split(/\s+/).filter(Boolean);
    const mark = (text) => {
      let out = esc(text);
      for (const w of words) {
        const re = new RegExp(esc(w).replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&'), 'gi');
        out = out.replace(re, (m) => `<mark class="search-hit">${m}</mark>`);
      }
      return out;
    };
    box.innerHTML = data.items.length ? data.items.map((it) => `
      <a class="news-item" href="/${it.game}/${encodeURIComponent(it.id)}">
        <div class="news-thumb">${thumb(it.game, it.image, false)}</div>
        <div class="news-body">
          <div class="meta"><span class="badge badge-${it.game}">${esc(it.gameShort)}</span><span>${fmtDate(it.publishedAt)}</span><span>· 일치 ${it.hits}곳</span></div>
          <h3 class="news-title">${mark(it.title)}</h3>
          <p class="news-summary">${mark(it.snippet || it.summary || '')}</p>
        </div>
      </a>`).join('') : '<div class="empty">일치하는 패치 노트가 없습니다.</div>';
    $('#search-games').innerHTML = Object.entries(data.byGame).map(([id, g]) => `<li><a href="/${id}"><span>${esc(g.label)}</span><span class="meta">${g.count}건</span></a></li>`).join('');
  }

  setTodayLine();
  renderNav();
  const page = document.body.dataset.page;
  if (page === 'home') {
    renderDeals();
    renderStreamsHome();
    renderNews();
  }
  if (page === 'game') renderGame();
  if (page === 'search') renderSearch();
})();
