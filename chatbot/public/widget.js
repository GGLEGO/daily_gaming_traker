/* 사이트 챗봇 위젯: 오른쪽 아래 버튼을 누르면 대화창이 열린다. 대화는 /api/chat 로 보낸다. */
(function () {
  'use strict';
  if (document.getElementById('dgt-chat-btn')) return;

  const STORE_KEY = 'dgt-chat-history';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // 아주 단순한 마크다운: **굵게**, [링크](url), 줄바꿈, "- " 목록
  function md(text) {
    let t = esc(text);
    t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\[([^\]\n]+)\]\(((?:https?:\/\/|\/)[^)\s]+)\)/g, (m, label, url) => `<a href="${url}" ${url.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`);
    t = t.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    const lines = t.split('\n');
    let html = '', inList = false;
    for (const line of lines) {
      const h = line.match(/^\s*#{1,6}\s+(.*)$/);
      if (h) { if (inList) { html += '</ul>'; inList = false; } html += `<p><strong>${h[1]}</strong></p>`; continue; }
      if (/^\s*\|?\s*-{3,}/.test(line) && line.includes('|')) continue; // 표 구분선은 숨김
      const li = line.match(/^\s*[-•]\s+(.*)$/);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${li[1]}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim() === '') { html += '<div class="dgt-gap"></div>'; continue; }
      html += `<p>${line}</p>`;
    }
    if (inList) html += '</ul>';
    return html;
  }

  let history = [];
  try { history = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]'); } catch (e) { history = []; }
  const save = () => { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(history.slice(-30))); } catch (e) { /* ignore */ } };

  // ---- DOM ----
  const btn = document.createElement('button');
  btn.id = 'dgt-chat-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', '챗봇 열기');
  btn.innerHTML = '<span class="dgt-chat-btn-icon">💬</span><span class="dgt-chat-btn-text">챗봇</span>';

  const panel = document.createElement('div');
  panel.id = 'dgt-chat';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="dgt-chat-head">
      <div class="dgt-chat-title"><span class="dgt-chat-dot"></span>DGT 패치 챗봇</div>
      <div class="dgt-chat-actions">
        <button type="button" class="dgt-chat-clear" title="대화 지우기">지우기</button>
        <button type="button" class="dgt-chat-close" aria-label="닫기">✕</button>
      </div>
    </div>
    <div class="dgt-chat-body" id="dgt-chat-body"></div>
    <form class="dgt-chat-form" id="dgt-chat-form">
      <textarea id="dgt-chat-input" rows="1" placeholder="패치, 방송, 대회 일정을 물어보세요" maxlength="2000"></textarea>
      <button type="submit" class="dgt-chat-send" aria-label="보내기">➤</button>
    </form>
    <div class="dgt-chat-foot">패치 노트 원문을 근거로 답하며, 답변이 틀릴 수 있습니다.</div>`;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  const body = panel.querySelector('#dgt-chat-body');
  const form = panel.querySelector('#dgt-chat-form');
  const input = panel.querySelector('#dgt-chat-input');
  const sendBtn = panel.querySelector('.dgt-chat-send');

  function addBubble(role, text, extra) {
    const el = document.createElement('div');
    el.className = `dgt-msg dgt-msg-${role}${extra ? ' ' + extra : ''}`;
    el.innerHTML = role === 'user' ? `<p>${esc(text)}</p>` : md(text);
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }
  function renderHistory() {
    body.innerHTML = '';
    if (!history.length) addBubble('assistant', '안녕하세요! 게임 패치 노트, 실시간 방송, 대회 일정을 물어보시면 사이트 데이터를 찾아 답해 드립니다.', 'dgt-msg-hello');
    for (const m of history) addBubble(m.role, m.content);
  }

  let busy = false;
  async function send(text) {
    text = (text || '').trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    autosize();
    history.push({ role: 'user', content: text });
    save();
    addBubble('user', text);
    const typing = addBubble('assistant', '…', 'dgt-msg-typing');
    typing.innerHTML = '<span class="dgt-typing"><i></i><i></i><i></i></span>';
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history.slice(-12) }) });
      const data = await res.json().catch(() => ({}));
      typing.remove();
      if (!res.ok) { addBubble('assistant', data.error || `오류가 났습니다 (${res.status}).`, 'dgt-msg-error'); }
      else {
        history.push({ role: 'assistant', content: data.reply });
        save();
        const el = addBubble('assistant', data.reply);
        if (data.mode === 'fallback') el.classList.add('dgt-msg-note');
      }
    } catch (e) {
      typing.remove();
      addBubble('assistant', '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'dgt-msg-error');
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
  function open() { panel.hidden = false; btn.classList.add('open'); renderHistory(); setTimeout(() => input.focus(), 50); }
  function close() { panel.hidden = true; btn.classList.remove('open'); }

  btn.addEventListener('click', () => (panel.hidden ? open() : close()));
  panel.querySelector('.dgt-chat-close').addEventListener('click', close);
  panel.querySelector('.dgt-chat-clear').addEventListener('click', () => { history = []; save(); renderHistory(); });
  form.addEventListener('submit', (ev) => { ev.preventDefault(); send(input.value); });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(input.value); } });
  input.addEventListener('input', autosize);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !panel.hidden) close(); });
})();
