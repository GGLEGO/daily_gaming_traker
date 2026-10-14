# Daily Gaming Tracker

게임 패치 노트를 모아 보여주는 뉴스 사이트입니다. 로고 색감에 맞춘 초록색 뉴스 홈페이지 스타일이며, 현재
**League of Legends**, **Overwatch**, **VALORANT**, **TFT(전략적 팀 전투)**, **로스트아크**, **메이플스토리**, **이터널 리턴**, **FC 온라인**, **배틀그라운드**, **아이온2** 열 게임을 다룹니다. 게임별 수집 에이전트가 24시간 주기로
공식 패치 노트 페이지를 확인하고, 새 패치가 있으면 내용을 그대로 가져와 사이트에 반영합니다.

구조는 두 층으로 나뉩니다.

- **에이전트(game/<회사>/agents.js)** 는 그 회사 공식 사이트에서 패치 노트 원문을 그대로 가져오는 일만 합니다. 요약이나 재작성은 하지 않습니다.
  게임별 이름·주소·필터 같은 데이터는 **game/<회사>/data/<게임>.js** 에 따로 둡니다.
- **하네스(harness.js)** 는 가져온 원문을 받아 "무엇이 새로 왔고 무엇이 바뀌었는지" 판정합니다. 저장된 최신 3건과 목록상 제목이 바뀐 글은
  매 실행마다 본문을 다시 받아 평문 해시를 비교하고, 원본이 수정됐으면 본문을 교체한 뒤 이전 버전을 `revisions` 에 남깁니다.
  신규·수정·오류 이벤트는 `store/changes.json` 에 쌓여 홈의 "최근 변경" 피드와 `/api/changes` 로 제공됩니다.

## 실행

```bash
npm install
npm start          # http://localhost:3000
```

서버를 켜면 1초 뒤 모든 에이전트가 한 번 실행되고, 이후 매일 09:00(Asia/Seoul)에 다시 실행됩니다.

```bash
npm run agents             # 모든 에이전트를 지금 바로 1회 실행 (node run.js)
node run.js lol            # 한 게임만 (lol | overwatch | valorant | tft | lostark | maplestory | eternalreturn | fconline | pubg | aion2)
```

환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3000` | 서버 포트 |
| `STORAGE` | `json` | 저장 방식. `json`(store/*.json 파일, 로컬) 또는 `mysql`(배포). `DATABASE_URL`/`MYSQL_HOST` 가 있으면 자동으로 mysql |
| `DATABASE_URL` | - | `mysql://user:pass@host:3306/daily_gaming_tracker`. 대신 `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` 를 써도 됨 |
| `PATCH_CHECK_CRON` | `0 9 * * *` | 수집 주기 (cron 표현식, 24시간 주기) |
| `PATCH_CHECK_TZ` | `Asia/Seoul` | cron 시간대 |
| `STEAM_CHECK_CRON` | `0 */6 * * *` | Steam 할인 갱신 주기 (6시간) |
| `ANTHROPIC_API_KEY` | - | 챗봇용 Claude API 키 (.env 파일에 넣어도 됨). 없으면 챗봇이 검색 안내 모드로 동작 |
| `DISABLE_SCHEDULER` | - | `1` 이면 서버만 띄우고 스케줄러를 끔 |

## 저장 방식 (JSON 파일 → MySQL)

로컬에서는 설정 없이 `store/*.json` 파일에 저장합니다(게임당 최신 40건). 배포할 때는 MySQL 로 바꿉니다. 에이전트·하네스·API 코드는 그대로이고 `storage/` 백엔드만 바뀝니다.

```bash
cp .env.example .env           # STORAGE=mysql 과 MySQL 접속 정보를 적는다
npm run db:init                # sql/update.sql 스키마 적용 (데이터베이스가 없으면 만든다)
npm run db:migrate             # 지금까지 store/*.json 에 모은 패치·수정 이력·이벤트·Steam 결과를 MySQL 로 이전
npm start                      # 시작 로그에 "저장 방식: mysql" 이 찍히면 전환 완료
```

MySQL 모드에서는 보관 상한이 없어 모든 패치가 영구 보관되고, 검색은 ngram FULLTEXT 인덱스를 씁니다. 원문 수정 이력은 `patch_revisions`, 변경 이벤트는 `change_events` 표에 쌓입니다.
MySQL 서버가 없는 PC 에서는 `STORAGE=json` 그대로 두면 됩니다. `STORAGE=mysql` 인데 MySQL 이 꺼져 있으면 서버가 "시작 실패" 를 찍고 바로 종료되니 MySQL 을 먼저 켜야 합니다.
`/api/status` 응답의 `storage` 필드로 지금 어느 저장 방식으로 돌고 있는지 확인할 수 있습니다.

## 구조

```
server.js              Express 서버 (정적 파일 + API + 스케줄러 시작). 데이터 접근은 모두 storage/ 를 거친다
config.js              .env 로딩, 저장 방식(STORAGE=json | mysql)과 MySQL 접속 설정
base.js                공통 수집 루틴 (HTTP 요청, HTML 정리, 저장소, 로그) - 모든 에이전트와 수집기가 사용
harness.js             하네스 층: 본문 해시 비교로 원문 수정 감지, 이전 버전 이력(revisions), 변경 이벤트 생성
storage/               저장 계층. index.js 가 백엔드를 고른다: json.js(store/*.json 파일, 게임당 40건) | mysql.js(sql/update.sql 스키마, 상한 없음, FULLTEXT 검색)
scripts/               db-init.js(스키마 적용), migrate-json-to-mysql.js(store/*.json → MySQL 이전)
run.js                 에이전트 수동 실행 CLI (node run.js [게임])
game/
  index.js             게임 에이전트 등록부 + 장르 목록 (회사 폴더를 자동으로 모은다)
  <회사>/agents.js     회사별 수집 로직 (사이트 구조 파싱). node game/<회사>/agents.js [게임] 으로 단독 실행 가능
  <회사>/data/<게임>.js 게임 데이터 (game, name, label, short, tagline, genre, sourceUrl, imageInBody, 회사별 주소·필터)
  riot/                Riot Games   - __NEXT_DATA__ 파서, data/lol.js, valorant.js, tft.js
  blizzard/            Blizzard     - .PatchNotes-patch 파서, data/overwatch.js
  smilegate/           Smilegate    - 공지사항 "업데이트 내역 안내" 파서, data/lostark.js
  nexon/               Nexon        - updateBoard·noticeBoard 파서, data/maplestory.js, fconline.js
  nimbleneuron/        Nimble Neuron - 패치노트 API + 게시글 본문 파서, data/eternalreturn.js
  krafton/             Krafton      - Nuxt 상태 데이터 파서, data/pubg.js
  ncsoft/              NCSoft       - plaync 커뮤니티 API 파서, data/aion2.js
store/<game>.json      [STORAGE=json] 수집된 패치 노트 (본문 HTML, contentHash, 수정 시 updatedAt·revisions 포함)
store/changes.json     [STORAGE=json] 변경 이벤트 (new / backfill / updated / error, 최근 300건)
logs/agents.log        수집 로그
public/                프론트엔드 (index.html 홈, game.html 게임 페이지, style.css, app.js)
chatbot/               사이트 챗봇 (index.js 서버 라우터, public/widget.js·widget.css 위젯)
news/                  게임 뉴스 수집기 (index.js, 구글 뉴스 RSS 검색, 분류별 30분 캐시)
steam/                 Steam 할인 수집기 (index.js, 6시간마다): 장르별로 동시 접속자 × 할인율 점수 상위 5개 + 무료 배포(100% 할인), 실시간 접속자 포함
stream/                실시간 스트리머 방송 수집기 (index.js, SOOP + 치지직, 요청 시 2분 캐시)
scheduler/             node-cron 24시간 스케줄러 (index.js) + 대회·리그·경기 일정 수집기 (esports.js: lolesports, vlr.gg, Liquipedia TFT, pubgesports, OWCS, 각 게임 공지)
sql/                   MySQL 스키마 (update.sql: companies·games·agent_runs·patches·patch_revisions·change_events + 뷰, update.mwb: Workbench 모델)
```

## API

| 경로 | 설명 |
| --- | --- |
| `GET /api/games` | 게임 목록과 각 게임의 최신 패치 (장르 포함) |
| `GET /api/genres` | 장르 목록(FPS / RPG / AOS / 스포츠)과 소속 게임 |
| `GET /api/status` | 스케줄러 및 게임별 수집 상태 (신규 수 `newCount`, 수정 반영 수 `updatedCount`) |
| `GET /api/changes?limit=30&type=updated&since=ISO` | 최근 변경 이벤트 (type: new 신규 패치 / updated 원문 수정 반영 / backfill 과거분 채우기 / error 수집 오류) |
| `GET /api/:game/patches` | 패치 목록 (본문 제외) |
| `GET /api/:game/patches/latest` | 최신 패치 전문 |
| `GET /api/:game/patches/:id` | 특정 패치 전문 |
| `GET /api/deals` | Steam 무료 배포(100% 할인) 항목과 장르별 인기 할인 5개 (순위 = 할인율 × log10(동시 접속자 + 10), 홈 배너 슬라이드) |
| `GET /api/streams` | 실시간 방송을 제공하는 게임 목록 |
| `GET /api/news?cat=all` | 구글 뉴스 기반 게임 기사 (분류: all, update, company, users, esports / 30분 캐시) |
| `GET /api/esports/:game` | 게임별 대회·리그·경기 일정 또는 대회 소식 (30~60분 캐시) |
| `GET /api/streams/:game` | SOOP·치지직에서 해당 게임을 방송 중인 스트리머 시청자순 5명씩 (2분 캐시) |
| `GET /api/search?q=단어` | 제목·요약·본문 검색 (공백으로 여러 단어 AND 검색) |
| `POST /api/refresh` | 즉시 수집 (localhost 에서만 허용) |
| `POST /api/chat` | 챗봇 (Claude + 사이트 데이터 도구). 설정은 `chatbot/README.md` 참고 |

페이지: `/` 홈, `/lol`, `/overwatch` 게임별 최신 패치, `/lol/<id>` 특정 패치, `/search?q=단어` 검색 결과.

## 새 게임 추가하기

**이미 다루는 회사의 게임이면** 그 회사 폴더의 `data/` 에 `<게임>.js` 하나만 추가합니다. 등록부가 자동으로 읽습니다.

```js
// game/riot/data/lor.js (예시)
const base = 'https://playruneterra.com';
module.exports = {
  game: 'lor', name: 'Legends of Runeterra', label: 'LoR', short: 'LoR',
  tagline: '레전드 오브 룬테라 패치 노트', genre: 'aos',
  base, sourceUrl: `${base}/ko-kr/news/tags/patch-notes/`, titleFilter: /패치|patch/i,
};
```

**새 회사면** `game/<회사>/agents.js` 와 `game/<회사>/data/<게임>.js` 를 만듭니다.

1. `agents.js` 는 `require('../../base')` 의 `loadGameData` 로 `data/` 를 읽고, 게임 데이터마다 `defineAgent(data, { listPatches, fetchDetail })` 를 호출해
   `module.exports = { company: '회사 이름', agents }` 를 내보냅니다. 끝에 `if (require.main === module) runCli(agents);` 를 두면 단독 실행이 됩니다.
   - `listPatches()` 는 `[{ id, title, url, publishedAt, summary, image, html? }]` 목록을 돌려줍니다. `id` 는 바뀌지 않는 값이어야 합니다.
   - `fetchDetail(item)` 은 `{ html, image?, publishedAt?, summary?, title? }` 를 돌려줍니다.
2. 게임 데이터에는 `game, name, short, tagline, genre, sourceUrl` 이 반드시 있어야 하고(fps / rpg / aos / sports), 나머지는 회사 파서가 쓰는 값입니다.
   새 장르는 `game/index.js` 의 `GENRES` 에, 회사 표시 순서는 같은 파일의 `COMPANY_ORDER` 에 추가합니다.
3. 네비게이션 버튼과 홈 카드는 `/api/games` 를 읽어 자동으로 생깁니다. 배지 색만 `public/style.css` 의 `.badge-<game>` 에 추가하면 됩니다.

## 참고

- 본문은 서버에서 script/style/iframe/이벤트 속성을 제거한 뒤 저장합니다.
- 패치 노트 본문 저작권은 Riot Games, Blizzard Entertainment 에 있습니다.
