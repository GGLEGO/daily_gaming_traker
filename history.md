# Daily Gaming Tracker — 제작 기록

이 사이트를 어떻게 만들었고 왜 그렇게 했는지 적은 기록입니다. 나중에 고치거나 되짚을 때 참고하세요.
구조·명령 같은 "지금의 사용법"은 [README.md](README.md), 배포 절차는 [DEPLOY.md](DEPLOY.md)에 있습니다. 이 문서는 "왜 이렇게 됐나"에 가깝습니다.

GitHub: https://github.com/GGLEGO/daily_gaming_traker

---

## 1. 무엇을 만들었나

게임 공식 패치 노트를 매일 자동으로 모아 보여주는 뉴스 사이트입니다. 지금 다루는 게임은 10개입니다.

| 회사 | 게임 |
| --- | --- |
| Blizzard | Overwatch |
| Riot Games | League of Legends, VALORANT, TFT |
| Smilegate | 로스트아크 |
| Nexon | 메이플스토리, FC 온라인 |
| Nimble Neuron | 이터널 리턴 |
| Krafton | 배틀그라운드(PUBG) |
| NCSoft | 아이온2 |

패치 노트 외에 Steam 인기 할인, 실시간 스트리머 방송(SOOP·치지직), 게임 뉴스(구글 뉴스), 대회 일정, 사이트 챗봇(Claude)이 붙어 있습니다.

---

## 2. 핵심 설계 결정과 이유

### (1) 에이전트와 하네스를 나눴다
- **에이전트**(`game/<회사>/agents.js`)는 그 회사 사이트에서 패치 원문을 **그대로 가져오는 일만** 한다. 요약·재작성은 하지 않는다.
- **하네스**(`harness.js`)는 가져온 원문을 받아 "새 글인지, 기존 글이 수정됐는지"를 **판정**한다.
- **왜:** 독자가 원하는 건 공식 원문이다. AI로 재작성하면 수치 하나만 틀려도 신뢰가 깨지고 비용·지연·저작권 문제가 생긴다. 그래서 원문 보존을 본체로 두고, 판정 로직만 따로 뺐다.

### (2) 원문 "수정"을 감지한다
- 공지가 올라온 뒤 내용이 바뀌는 일(예: 아이온2 "10/7 업데이트 (수정 10/8)")이 잦다.
- 하네스가 본문을 평문으로 바꿔 **SHA-1 해시**를 만들고, 저장된 해시와 다르면 수정으로 보고 본문을 교체한다. 이전 버전은 이력(`revisions` / `patch_revisions`)에 남긴다.
- 매 실행마다 전부 다시 받지 않고, **최신 3건 + 목록에서 제목이 바뀐 글**만 다시 받아 비교한다(`pickRecheck`). 불필요한 요청을 줄이려는 것.

### (3) "과거분 채우기(backfill)"를 신규와 구분한다
- 저장소를 처음 채울 때 과거 패치 수십 건이 한꺼번에 들어온다. 이걸 "새 글"로 알리면 안 된다.
- 저장소의 가장 최근 게시일보다 오래된 글은 `backfill` 이벤트로 분류하고, "최근 변경" 피드에는 안 띄웠다. (이 피드는 이후 사용자 요청으로 제거됨.)

### (4) 저장 방식을 교체 가능하게 만들었다 (JSON ↔ MySQL)
- 처음엔 `store/<게임>.json` 파일에 저장했다(게임당 40건 롤링). 로컬 개발엔 충분하다.
- 배포를 생각하면 파일 저장은 깨진다: 디스크 휘발(PaaS 재시작 시 데이터 소실), 다중 프로세스 동시 쓰기 충돌, 검색 부하.
- 그래서 **저장 계층(`storage/`)을 분리**했다. 에이전트·하네스·API는 그대로 두고, `config.STORAGE`(json | mysql)로 백엔드만 바꾼다.
  - `storage/json.js` — 파일 방식(상한 40건)
  - `storage/mysql.js` — MySQL(상한 없음, ngram FULLTEXT 검색, 트랜잭션)
- **왜 MySQL:** 사용자가 직접 서버·도메인으로 배포할 계획이라 디스크가 유지되는 환경이다. MySQL Workbench 모델을 이미 만들어 둬서 MySQL로 정했다. 스키마는 `sql/update.sql`.

### (5) Steam 할인 순위 기준
- 처음엔 할인율만으로 줄 세웠더니 접속자 거의 없는 게임이 상위에 왔다.
- **점수 = 할인율 × log10(동시 접속자 + 10)** 로 바꿔, 많이 하는 게임의 할인이 위로 오게 했다.
- 여기에 "무료 배포(100% 할인)" 탭을 따로 두고, DLC는 본편 접속자로 집계한다.

---

## 3. 폴더 구조와 역할

```
server.js            Express 서버 (정적 파일 + API + 스케줄러 시작). 데이터는 모두 storage/ 를 거침
config.js            .env 로딩, STORAGE=json|mysql 선택, MySQL 접속 설정
base.js              수집 공통 루틴(runAgent), 에이전트 정의 도우미(defineAgent/loadGameData/runCli)
harness.js           원문 수정 감지·이력·변경 이벤트 생성 (저장은 안 함, 판정만)
storage/             저장 계층. index.js 가 백엔드 선택 → json.js | mysql.js, common.js(검색 점수 등)
game/
  index.js           회사 폴더를 자동으로 모아 AGENTS/GAME_IDS/GENRES 생성
  <회사>/agents.js   그 회사 사이트 파싱 로직
  <회사>/data/<게임>.js  게임 메타(이름·약칭·장르·주소·필터)
scheduler/           node-cron 매일 09:00(KST) 수집 + esports.js(대회 일정)
steam/               Steam 할인(6시간) + 실시간 접속자
stream/              SOOP·치지직 실시간 방송
news/                구글 뉴스 RSS
chatbot/             Claude 챗봇 (사이트 데이터를 도구로 조회)
public/              프론트엔드 (index.html, game.html, app.js, style.css)
sql/update.sql       MySQL 스키마 (companies, games, agent_runs, patches, patch_revisions, change_events, app_state + 뷰)
scripts/             db-init.js(스키마 적용), migrate-json-to-mysql.js(JSON→MySQL 이전)
ecosystem.config.js  PM2 설정 (배포용, 단일 인스턴스)
store/               [json 모드 전용] 수집 결과 파일. git 추적 안 함(로컬 백업)
```

### 새 게임 추가하는 법 (요약)
- 같은 회사면 `game/<회사>/data/<게임>.js` 파일 하나만 추가하면 등록부가 자동 인식.
- 새 회사면 `game/<회사>/agents.js`(파싱) + `data/<게임>.js`(메타)를 만든다.
- 자세한 건 README "새 게임 추가하기" 참고.

---

## 4. 저장 방식 전환 (JSON → MySQL)

로컬은 설정 없이 JSON. 배포는 MySQL. 전환 명령:

```bash
cp .env.example .env     # STORAGE=mysql, DATABASE_URL 입력
npm run db:init          # sql/update.sql 스키마 적용
npm run db:migrate       # 기존 store/*.json 데이터를 MySQL 로 이전 (선택)
npm start                # 로그에 "저장 방식: mysql" 확인
```

- 저장 방식은 코드가 아니라 **환경변수**로 정해진다. `DATABASE_URL`이나 `MYSQL_HOST`가 있으면 자동으로 mysql.
- `/api/status` 응답의 `storage` 필드로 현재 모드를 확인한다.

### 로컬 MySQL 환경 (이 PC)
- 관리자 권한이 없어 Windows 서비스 대신 **ZIP으로 `C:\Users\dongr\mysql`에 설치**(MySQL 8.4.9).
- 시작/종료/접속: `start-mysql.cmd` / `stop-mysql.cmd` / `mysql-client.cmd`. 로그온 시 자동 시작 등록됨.
- root는 비밀번호 없음(127.0.0.1 전용), 앱 계정 `dgt`, DB `daily_gaming_tracker`.
- 한국어 검색 위해 `ngram_token_size=2` (표 만들기 전에 설정해야 인덱스가 맞게 생긴다).

---

## 5. 배포 (Oracle Cloud Always Free)

서버 한 대에 MySQL 저장으로 상시 운영. 도메인은 마지막 선택 단계. 전체 절차는 [DEPLOY.md](DEPLOY.md).

- **서버:** Oracle Always Free ARM VM(`VM.Standard.A1.Flex`), OCPU 1 / 6GB면 충분. OS는 Oracle Linux(기본) 또는 Ubuntu.
- **공인 IP:** VM 만들 때 Networking에서 "Assign a public IPv4 address"를 반드시 켜야 함. 안 켜면 private IP만 생김.
- **방화벽 두 곳:** 클라우드(Security List 인그레스)와 서버 OS(Oracle Linux는 firewalld, Ubuntu는 iptables) **양쪽** 다 열어야 함.
- **접속 사용자:** Oracle Linux는 `opc`, Ubuntu는 `ubuntu`.
- **상시 실행:** PM2 **단일 인스턴스**로. 2개 이상이면 스케줄러가 중복 수집함.
- **포트/도메인:** Caddy를 앞에 두고 80으로 받음(`reverse_proxy 127.0.0.1:3000`). 도메인 연결 시 Caddy가 HTTPS 자동 발급.

### 겪은 함정 (배포 중 실제로 막혔던 것)
- 공인 IP 미할당 → VM 재생성하며 "Assign public IPv4" 체크.
- Oracle Linux인데 `ubuntu`로 접속 시도 → `opc`로 접속해야 함.
- 설치 명령은 OS별로 다름: Ubuntu `apt`, Oracle Linux `dnf` + firewalld.
- `mysql>` 프롬프트와 `$` 셸 혼동 — SQL은 `mysql>`에서, 셸 명령은 `$`에서. MySQL 작업은 `sudo mysql -e "..."` 한 줄로 하면 프롬프트 혼동이 없다.
- private 저장소라 `git clone`이 로그인 요구 → 공개로 바꾸거나 PAT 사용.

---

## 6. 변경 이력 (커밋 순서)

1. `9ca058a` 패치노트 수집 사이트 + 원문 수정 감지 하네스
2. `62aa08e` 폴더 구조 변경: agents/ → game/<회사>/agents.js + data/<게임>.js
3. `49c6666` README 복구, 과거분(backfill) 이벤트 분리
4. `cf38d34` 저장 폴더 이름 data/ → store/
5. `0bd4797` Steam 무료 배포(100% 할인) 탭 추가
6. `004d6f4` Steam 순위 기준: 할인율 → 동시 접속자 × 할인율
7. `669e89d` MySQL 스키마(sql/update.sql) 추가
8. `c01ceb4` 저장 계층 분리: storage/ (JSON | MySQL) + 전환 도구
9. `bb4cfc3` README MySQL 모드 주의사항
10. `ecfd412` 홈 "최근 변경" 섹션 제거
11. `4cb5e3c` store/ git 추적 제외 (로컬 파일 유지)
12. `9f1a692` Oracle Always Free 배포 준비: DEPLOY.md, PM2 설정

---

## 7. 자주 할 작업

| 하고 싶은 것 | 방법 |
| --- | --- |
| 지금 저장 방식 확인 | `/api/status` 의 `storage` 필드 |
| 수동 수집 1회 | `node run.js` (전체) 또는 `node run.js lol` (한 게임) |
| Steam 할인만 갱신 | `npm run steam` |
| 새 게임 추가 | `game/<회사>/data/<게임>.js` 추가 (README 참고) |
| 배포 서버 코드 업데이트 | 서버에서 `git pull && npm install --omit=dev && pm2 restart dgt` |
| 스키마 재적용 | `npm run db:init` (IF NOT EXISTS 라 여러 번 안전) |
