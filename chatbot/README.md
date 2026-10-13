# 사이트 챗봇

오른쪽 아래 "챗봇" 버튼을 누르면 열리는 대화창입니다. 사이트가 수집한 패치 노트, 실시간 방송, 대회 일정을 근거로 답합니다.

## 구성

```
chatbot/
  index.js            Express 라우터: POST /api/chat, GET /api/chat/status, /chatbot/* 정적 파일
  public/widget.js    버튼 + 대화창 위젯 (모든 페이지에 포함)
  public/widget.css   위젯 스타일 (사이트 초록 테마 변수 사용)
```

## 동작 방식

- 서버는 Claude(`claude-opus-5-5`)에게 질문을 보내고, Claude 가 필요한 데이터를 **도구**로 조회한 뒤 답합니다.
  - `list_games` 게임 목록과 최신 패치 제목
  - `search_patch_notes` 패치 노트 제목·본문 검색
  - `get_latest_patch` 특정 게임 최신 패치 본문과 이력
  - `get_live_streams` SOOP·치지직 방송 중 스트리머
  - `get_esports_schedule` 대회·리그·경기 일정
- 안전 분류기가 요청을 거절하면 서버 측 대체 모델(`fallbacks: "default"`)로 같은 요청을 이어갑니다.
- 대화는 브라우저 세션에만 저장되며(최근 30개), 서버에는 남지 않습니다.
- 같은 IP 에서 1분에 20회를 넘으면 잠시 제한됩니다.

## 설정

프로젝트 루트에 `.env` 파일을 만들고 키를 넣습니다 (또는 환경변수로 지정).

```
ANTHROPIC_API_KEY=sk-ant-...
CHATBOT_MODEL=claude-opus-5-5   # 선택
```

`ant auth login` 으로 로그인한 프로필이 있으면 키 없이도 동작합니다.

키가 없으면 **안내 모드**로 동작합니다. AI 답변 대신 질문과 일치하는 패치 노트 검색 결과를 보여주고, 키를 설정하라는 안내를 붙입니다.

## 확인

```
curl -X POST localhost:3000/api/chat -H "Content-Type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"롤 최신 패치 알려줘\"}]}"
```
