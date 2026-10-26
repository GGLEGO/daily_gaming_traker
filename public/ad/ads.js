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
  // 애드센스 게시자 ID (로더는 각 페이지 <head> 에 이미 들어가 있음)
  var ADSENSE_CLIENT = 'ca-pub-7678879723413419';

  var AD_UNITS = {
    sidebar: {
      // 켜는 법: 애드센스 대시보드에서 "사이드바" 디스플레이 광고 단위를 만들어 data-ad-slot 번호를 받은 뒤,
      //          아래 data-ad-slot 의 "0000000000" 을 그 번호로 바꾸고 enabled 를 true 로.
      enabled: false,
      html: '<ins class="adsbygoogle" style="display:block" data-ad-client="' + ADSENSE_CLIENT + '" data-ad-slot="0000000000" data-ad-format="auto" data-full-width-responsive="true"></ins>' +
            '<script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script>'
    },
    'home-left': {
      // 홈 왼쪽 세로 광고 자리. 현재 쿠팡 파트너스 배너 사용.
      enabled: true,
      html: '<iframe src="https://coupa.ng/cqrhf4" width="120" height="240" frameborder="0" scrolling="no" referrerpolicy="unsafe-url"></iframe>'
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
