# 광고 슬롯 (public/ad/)

사이트에 광고를 붙일 자리를 미리 준비해 둔 폴더입니다. 광고망 승인 전까지는 "광고 자리 (준비 중)" 자리표시만 보이고,
코드를 받으면 **`ads.js` 한 곳만** 고치면 모든 슬롯에 반영됩니다.

## 파일

| 파일 | 역할 |
| --- | --- |
| `ads.css` | 광고 슬롯·자리표시 스타일 |
| `ads.js` | 슬롯을 찾아 광고 코드(또는 자리표시)를 그려 넣음. **광고 코드는 여기 `AD_UNITS` 에 넣는다** |
| `sidebar-ad.html` | 사이드바에 넣는 광고 블록 템플릿 (복사용) |

## 슬롯을 페이지에 넣기

광고를 넣을 곳에 이 한 줄을 둡니다. `data-ad` 값이 `ads.js` 의 `AD_UNITS` 키와 연결됩니다.

```html
<div class="ad-slot" data-ad="sidebar"></div>
```

사이드바에는 `sidebar-ad.html` 블록을 그대로 복사해 넣으면 라벨까지 함께 들어갑니다.
페이지에는 `<head>` 어딘가에 `ads.css`, 본문 끝에 `ads.js` 가 연결돼 있어야 합니다.

```html
<link rel="stylesheet" href="/ad/ads.css">
<script src="/ad/ads.js" defer></script>
```

(게임 페이지 `public/game.html` 에는 이미 연결·배치돼 있습니다.)

## 실제 광고 코드 넣기

`ads.js` 의 `AD_UNITS` 에서 해당 슬롯을 켜고 코드를 문자열로 넣습니다.

### 구글 애드센스
1. `<head>` 에 애드센스 로더를 한 번 추가 (ca-pub 번호는 본인 것):
   ```html
   <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX" crossorigin="anonymous"></script>
   ```
2. `ads.js` 에서:
   ```js
   sidebar: {
     enabled: true,
     html: '<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-XXXX" data-ad-slot="1234567890" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle = window.adsbygoogle || []).push({});<\/script>'
   }
   ```
   (`ads.js` 가 문자열 안의 `<script>` 를 실행해 주므로 push 가 자동으로 호출됩니다. 문자열 안에서는 `</script>` 를 `<\/script>` 로 써야 합니다.)

### 카카오 애드핏
`ads.js` 에서 애드핏이 준 코드를 그대로 넣습니다.
```js
sidebar: {
  enabled: true,
  html: '<ins class="kakao_ad_area" style="display:none;" data-ad-unit="DAN-XXXXXXXX" data-ad-width="300" data-ad-height="250"></ins><script async src="//t1.daumcdn.net/kas/static/ba.min.js"><\/script>'
}
```

## 주의
- 광고를 켜기 전에 사이트가 **도메인**으로 열려야 하고(애드센스는 IP 불가), 개인정보처리방침 페이지가 있어야 합니다.
- 공식 패치 노트를 그대로 옮긴 페이지는 애드센스 심사에서 거절될 수 있으니, 요약·해설 등 자체 콘텐츠를 더하는 것이 안전합니다.
