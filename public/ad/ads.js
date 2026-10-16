/* 광고 슬롯 관리 (준비용).
 *
 * 쓰는 법
 *  1) 페이지 어딘가에 슬롯을 둔다:  <div class="ad-slot" data-ad="sidebar"></div>
 *  2) 광고망에서 코드를 받으면 아래 AD_UNITS 의 해당 슬롯을 채운다.
 *  3) 코드가 없으면 "광고 자리 (준비 중)" 자리표시만 보인다.
 *
 * 자세한 코드 넣는 법은 public/ad/README.md 참고.
 */
(function () {
  'use strict';

  // ── 광고 설정: 광고망 코드가 생기면 여기만 고치면 모든 슬롯에 반영된다 ──
  var AD_UNITS = {
    sidebar: {
      enabled: false,     // 실제 광고를 켤 때 true 로 바꾼다
      html: ''            // 애드센스/애드핏에서 받은 <ins>.../<script>... 코드를 그대로 문자열로 (README 참고)
    }
    // 새 자리(예: 'in-article')가 필요하면 같은 형식으로 추가하고, 페이지에 data-ad="in-article" 슬롯을 둔다
  };

  function placeholder() {
    return '<div class="ad-placeholder"><strong>광고 자리</strong><span>준비 중</span></div>';
  }

  // 문자열 HTML 안의 <script> 는 innerHTML 로 넣으면 실행되지 않으므로 다시 만들어 실행시킨다
  function runScripts(container) {
    var scripts = container.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) {
      var old = scripts[i];
      var s = document.createElement('script');
      for (var a = 0; a < old.attributes.length; a++) {
        s.setAttribute(old.attributes[a].name, old.attributes[a].value);
      }
      s.text = old.textContent;
      old.parentNode.replaceChild(s, old);
    }
  }

  function fill(el) {
    var name = el.getAttribute('data-ad');
    var unit = AD_UNITS[name];
    if (unit && unit.enabled && unit.html) {
      el.innerHTML = unit.html;
      runScripts(el);
    } else {
      el.innerHTML = placeholder();
    }
  }

  function init() {
    var slots = document.querySelectorAll('.ad-slot[data-ad]');
    for (var i = 0; i < slots.length; i++) fill(slots[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
