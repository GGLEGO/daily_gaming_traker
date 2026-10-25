-- =====================================================================
--  Daily Gaming Tracker - 게임별 업데이트(패치 노트) 관리 스키마  (MySQL 8.0+)
-- ---------------------------------------------------------------------
--  지금 store/<game>.json 에 들어 있는 구조를 그대로 표로 옮긴 것이다.
--    store.<game>.json           →  games + agent_runs
--    items[]                     →  patches            (게임마다 UNIQUE(game_id, source_id))
--    items[].revisions[]         →  patch_revisions    (원문이 수정될 때마다 1행)
--    store/changes.json events[] →  change_events      (new / backfill / updated / error)
--
--  JSON 과 달리 게임당 40건 상한 없이 전부 보관하고, 검색은 FULLTEXT(ngram) 인덱스로 한다.
--
--  MySQL Workbench 모델(update.mwb)에 넣으려면:
--    File → Import → Reverse Engineer MySQL Create Script... → 이 파일 선택
-- =====================================================================

CREATE DATABASE IF NOT EXISTS daily_gaming_tracker
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE daily_gaming_tracker;

-- ---------------------------------------------------------------------
-- 1. 회사 / 게임  (game/<회사>/data/<게임>.js 의 메타와 1:1)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id          VARCHAR(32)  NOT NULL COMMENT '폴더 이름 (riot, blizzard, nexon ...)',
  name        VARCHAR(100) NOT NULL COMMENT '표시 이름 (Riot Games ...)',
  sort_order  TINYINT UNSIGNED NOT NULL DEFAULT 99 COMMENT '네비게이션 순서 (game/index.js COMPANY_ORDER)',
  PRIMARY KEY (id)
) ENGINE=InnoDB COMMENT='게임 회사';

CREATE TABLE IF NOT EXISTS games (
  id             VARCHAR(32)  NOT NULL COMMENT '게임 아이디 (lol, overwatch ...). URL 과 store 파일명에 쓰인다',
  company_id     VARCHAR(32)  NOT NULL,
  name           VARCHAR(100) NOT NULL COMMENT '공식 이름 (League of Legends)',
  label          VARCHAR(100) NOT NULL COMMENT '사이트 표시 이름',
  short          VARCHAR(10)  NOT NULL COMMENT '배지 약칭 (LoL, OW ...)',
  tagline        VARCHAR(200) NOT NULL COMMENT '게임 페이지 부제',
  genre          ENUM('fps','rpg','aos','sports','etc') NOT NULL DEFAULT 'etc',
  source_url     VARCHAR(500) NOT NULL COMMENT '원문 패치 노트 목록 주소',
  image_in_body  TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 이면 대표 이미지가 본문 첫 이미지라 상단에 다시 표시하지 않음',
  sort_order     TINYINT UNSIGNED NOT NULL DEFAULT 99 COMMENT '같은 회사 안의 순서 (data/<게임>.js order)',
  is_active      TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '0 이면 수집·표시 중단',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_games_company (company_id, sort_order),
  KEY ix_games_genre (genre),
  CONSTRAINT fk_games_company FOREIGN KEY (company_id) REFERENCES companies (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='수집 대상 게임';

-- ---------------------------------------------------------------------
-- 2. 에이전트 실행 기록  (store.lastRun / lastSuccess / lastError / newCount / updatedCount)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id        VARCHAR(32)  NOT NULL,
  started_at     DATETIME(3)  NOT NULL,
  finished_at    DATETIME(3)  NULL,
  ok             TINYINT(1)   NOT NULL DEFAULT 0,
  listed_count   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '원본 목록에서 확인한 건수',
  new_count      INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '새로 추가한 건수 (backfill 포함)',
  updated_count  INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '원문 수정을 반영한 건수',
  reason         VARCHAR(20)  NOT NULL DEFAULT 'scheduled' COMMENT 'startup | cron | manual | cli',
  error          TEXT         NULL,
  PRIMARY KEY (id),
  KEY ix_runs_game_time (game_id, started_at DESC),
  CONSTRAINT fk_runs_game FOREIGN KEY (game_id) REFERENCES games (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='게임별 수집 실행 이력';

-- ---------------------------------------------------------------------
-- 3. 패치 노트 (현재 버전)  (items[])
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patches (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id         VARCHAR(32)   NOT NULL,
  source_id       VARCHAR(191)  NOT NULL COMMENT '에이전트가 만든 원문 식별자 (items[].id). 게임 안에서 유일',
  title           VARCHAR(500)  NOT NULL,
  url             VARCHAR(1000) NOT NULL COMMENT '원문 주소',
  published_at    DATETIME      NULL COMMENT '원문 게시 시각 (UTC 로 저장)',
  summary         TEXT          NULL,
  image           VARCHAR(1000) NULL COMMENT '대표 이미지',
  category        VARCHAR(100)  NULL COMMENT '원문 분류 (게임 업데이트, 점검 ...)',
  html            MEDIUMTEXT    NOT NULL COMMENT 'sanitize 를 거친 본문 HTML (최대 16MB)',
  plain_text      MEDIUMTEXT    NOT NULL COMMENT '본문 평문 (검색용, textOf(html))',
  content_hash    CHAR(40)      NOT NULL COMMENT 'sha1(plain_text 정규화). 수정 감지 기준',
  fetched_at      DATETIME(3)   NOT NULL COMMENT '처음 수집한 시각',
  updated_at      DATETIME(3)   NULL     COMMENT '원문 수정을 마지막으로 반영한 시각 (없으면 NULL)',
  revision_count  INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '수정 반영 횟수 (= patch_revisions 행 수)',
  is_backfill     TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '1 이면 저장소를 채우기 위해 가져온 과거 글',
  PRIMARY KEY (id),
  UNIQUE KEY uq_patches_game_source (game_id, source_id),
  KEY ix_patches_game_published (game_id, published_at DESC),
  KEY ix_patches_published (published_at DESC),
  KEY ix_patches_updated (updated_at DESC),
  FULLTEXT KEY ft_patches_text (title, summary, plain_text) WITH PARSER ngram,
  CONSTRAINT fk_patches_game FOREIGN KEY (game_id) REFERENCES games (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='게임별 패치 노트 (현재 본문)';

-- ---------------------------------------------------------------------
-- 4. 패치 노트 이전 버전  (items[].revisions[])
--    하네스가 원문 수정을 감지해 본문을 교체할 때, 교체 직전 버전을 1행으로 남긴다.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patch_revisions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  patch_id       BIGINT UNSIGNED NOT NULL,
  revision_no    INT UNSIGNED    NOT NULL COMMENT '1부터 증가. patches.revision_count 와 맞춘다',
  title          VARCHAR(500)    NOT NULL COMMENT '교체 전 제목',
  content_hash   CHAR(40)        NOT NULL COMMENT '교체 전 본문 해시',
  html           MEDIUMTEXT      NULL     COMMENT '교체 전 본문. 오래된 버전은 NULL 로 비워 용량을 아낄 수 있다',
  changed        SET('html','title') NOT NULL COMMENT '무엇이 바뀌었는지',
  fetched_at     DATETIME(3)     NOT NULL COMMENT '이 버전을 받아온 시각',
  replaced_at    DATETIME(3)     NOT NULL COMMENT '이 버전이 새 버전으로 교체된 시각',
  PRIMARY KEY (id),
  UNIQUE KEY uq_revisions_patch_no (patch_id, revision_no),
  KEY ix_revisions_replaced (replaced_at DESC),
  CONSTRAINT fk_revisions_patch FOREIGN KEY (patch_id) REFERENCES patches (id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='패치 노트 수정 이력';

-- ---------------------------------------------------------------------
-- 5. 변경 이벤트  (store/changes.json)
--    홈 "최근 변경" 피드와 /api/changes 가 읽는 표. 패치가 지워져도 이벤트는 남도록 patch_id 는 NULL 허용.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_events (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  game_id       VARCHAR(32)     NOT NULL,
  patch_id      BIGINT UNSIGNED NULL,
  type          ENUM('new','backfill','updated','error') NOT NULL,
  title         VARCHAR(500)    NULL COMMENT '이벤트 당시 제목 (error 는 NULL)',
  url           VARCHAR(1000)   NULL,
  published_at  DATETIME        NULL,
  changed       SET('html','title') NULL COMMENT 'updated 일 때 바뀐 항목',
  message       TEXT            NULL COMMENT 'error 일 때 오류 내용',
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_events_time (created_at DESC),
  KEY ix_events_game_time (game_id, created_at DESC),
  KEY ix_events_type_time (type, created_at DESC),
  CONSTRAINT fk_events_game FOREIGN KEY (game_id) REFERENCES games (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_events_patch FOREIGN KEY (patch_id) REFERENCES patches (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='신규·수정·오류 이벤트 (최근 변경 피드)';

-- ---------------------------------------------------------------------
-- 5-1. 기타 상태 (Steam 할인 수집 결과 등 패치가 아닌 JSON 덩어리)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_state (
  name        VARCHAR(64) NOT NULL COMMENT 'steam_deals 등',
  value       JSON        NOT NULL,
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (name)
) ENGINE=InnoDB COMMENT='패치 외 수집 결과 (JSON)';

-- Steam 무료 게임 목록 (장르별 인기순 상위 10개). steam/free/ 가 채운다. (정의 원본: steam/free/schema.sql)
CREATE TABLE IF NOT EXISTS steam_free_games (
  genre        VARCHAR(16)  NOT NULL COMMENT '장르 id (coop, rpg, puzzle, racing, aos, card, fps)',
  rank_no      TINYINT UNSIGNED NOT NULL COMMENT '장르 내 인기 순위 (1부터)',
  appid        VARCHAR(16)  NOT NULL,
  name         VARCHAR(300) NOT NULL,
  url          VARCHAR(500) NOT NULL,
  image        VARCHAR(600) NULL,
  capsule      VARCHAR(600) NULL,
  review       VARCHAR(16)  NULL COMMENT 'positive | mixed | negative',
  review_text  VARCHAR(100) NULL,
  released     VARCHAR(60)  NULL,
  players      INT UNSIGNED NULL COMMENT '동시 접속자 수 (수집 시점)',
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (genre, rank_no)
) ENGINE=InnoDB COMMENT='Steam 무료 게임 장르별 목록';

-- ---------------------------------------------------------------------
-- 6. 뷰: API 가 바로 쓰는 모양
-- ---------------------------------------------------------------------

-- 게임별 최신 패치 1건 (/api/games 의 latest)
CREATE OR REPLACE VIEW v_latest_patch AS
SELECT p.*
FROM patches p
JOIN (
  SELECT game_id, MAX(published_at) AS published_at
  FROM patches
  GROUP BY game_id
) m ON m.game_id = p.game_id AND m.published_at = p.published_at;

-- 게임별 수집 상태 (/api/status): 마지막 실행, 마지막 성공, 마지막 오류, 보관 건수
CREATE OR REPLACE VIEW v_game_status AS
SELECT
  g.id                                   AS game_id,
  g.label,
  (SELECT COUNT(*) FROM patches p WHERE p.game_id = g.id)                                   AS patch_count,
  (SELECT MAX(started_at)  FROM agent_runs r WHERE r.game_id = g.id)                          AS last_run,
  (SELECT MAX(finished_at) FROM agent_runs r WHERE r.game_id = g.id AND r.ok = 1)             AS last_success,
  (SELECT r.error FROM agent_runs r WHERE r.game_id = g.id ORDER BY r.started_at DESC LIMIT 1) AS last_error,
  (SELECT r.new_count     FROM agent_runs r WHERE r.game_id = g.id ORDER BY r.started_at DESC LIMIT 1) AS new_count,
  (SELECT r.updated_count FROM agent_runs r WHERE r.game_id = g.id ORDER BY r.started_at DESC LIMIT 1) AS updated_count
FROM games g;

-- 최근 변경 피드 (/api/changes): backfill 과 error 는 빼고 게임 라벨을 붙인다
CREATE OR REPLACE VIEW v_recent_changes AS
SELECT e.id, e.created_at, e.type, e.game_id, g.label AS game_label, g.short AS game_short,
       e.patch_id, p.source_id, e.title, e.url, e.published_at, e.changed
FROM change_events e
JOIN games g ON g.id = e.game_id
LEFT JOIN patches p ON p.id = e.patch_id
WHERE e.type IN ('new','updated')
ORDER BY e.created_at DESC;

-- ---------------------------------------------------------------------
-- 7. 초기 데이터: 현재 game/<회사>/data/*.js 와 같은 10개 게임
-- ---------------------------------------------------------------------
INSERT INTO companies (id, name, sort_order) VALUES
  ('blizzard',     'Blizzard Entertainment', 1),
  ('riot',         'Riot Games',             2),
  ('smilegate',    'Smilegate RPG',          3),
  ('nexon',        'Nexon',                  4),
  ('nimbleneuron', 'Nimble Neuron',          5),
  ('krafton',      'Krafton',                6),
  ('mojang',       'Mojang Studios',         7)
ON DUPLICATE KEY UPDATE name = VALUES(name), sort_order = VALUES(sort_order);

INSERT INTO games (id, company_id, name, label, short, tagline, genre, source_url, image_in_body, sort_order) VALUES
  ('overwatch',     'blizzard',     'Overwatch',           'Overwatch',        'OW',   '오버워치 패치 노트',              'fps',    'https://overwatch.blizzard.com/ko-kr/news/patch-notes/',                 0, 1),
  ('lol',           'riot',         'League of Legends',   'League of Legends','LoL',  '리그 오브 레전드 패치 노트',       'aos',    'https://www.leagueoflegends.com/ko-kr/news/tags/patch-notes/',           0, 1),
  ('valorant',      'riot',         'VALORANT',            'VALORANT',         'VAL',  '발로란트 패치 노트',              'fps',    'https://playvalorant.com/ko-kr/news/tags/patch-notes/',                   0, 2),
  ('tft',           'riot',         '전략적 팀 전투',       'TFT',              'TFT',  '전략적 팀 전투 패치 노트',         'aos',    'https://teamfighttactics.leagueoflegends.com/ko-kr/news/tags/patch-notes/', 0, 3),
  ('lostark',       'smilegate',    '로스트아크',           '로스트아크',        'LA',   '로스트아크 업데이트 내역',         'rpg',    'https://lostark.game.onstove.com/News/Notice/List',                       1, 1),
  ('maplestory',    'nexon',        '메이플스토리',         '메이플스토리',      'MS',   '메이플스토리 업데이트 안내',       'rpg',    'https://maplestory.nexon.com/News/Update',                                1, 1),
  ('fconline',      'nexon',        'FC 온라인',            'FC 온라인',         'FC',   'FC 온라인 정기점검·업데이트 안내',  'sports', 'https://fconline.nexon.com/news/notice/list',                             1, 2),
  ('eternalreturn', 'nimbleneuron', '이터널 리턴',          '이터널 리턴',       'ER',   '이터널 리턴 패치노트',            'aos',    'https://playeternalreturn.com/posts/news?categoryPath=patchnote',         0, 1),
  ('pubg',          'krafton',      'PUBG: 배틀그라운드',   '배틀그라운드',      'PUBG', 'PUBG: 배틀그라운드 패치 노트',     'fps',    'https://pubg.com/ko/news?category=patch_notes',                           0, 1),
  ('minecraft',     'mojang',       'Minecraft',           '마인크래프트',      'MC',   '마인크래프트 자바 에디션 패치 노트', 'etc',    'https://www.minecraft.net/en-us/updates',                                 0, 1)
ON DUPLICATE KEY UPDATE
  company_id = VALUES(company_id), name = VALUES(name), label = VALUES(label), short = VALUES(short),
  tagline = VALUES(tagline), genre = VALUES(genre), source_url = VALUES(source_url),
  image_in_body = VALUES(image_in_body), sort_order = VALUES(sort_order);

-- ---------------------------------------------------------------------
-- 8. 하네스가 쓰는 문장 (참고용). base.js / harness.js 를 DB 로 옮길 때 그대로 쓴다.
-- ---------------------------------------------------------------------
-- (a) 신규 패치 추가. 이미 있으면 메타(제목·날짜·링크·이미지)만 갱신하고 본문은 건드리지 않는다.
--     INSERT INTO patches (game_id, source_id, title, url, published_at, summary, image, category,
--                          html, plain_text, content_hash, fetched_at, is_backfill)
--     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(3), ?)
--     ON DUPLICATE KEY UPDATE title = VALUES(title), published_at = VALUES(published_at),
--                             url = VALUES(url), image = COALESCE(image, VALUES(image));
--
-- (b) 원문 수정 반영 (하네스 applyRevision). 한 트랜잭션으로 묶는다.
--     START TRANSACTION;
--     INSERT INTO patch_revisions (patch_id, revision_no, title, content_hash, html, changed, fetched_at, replaced_at)
--       SELECT id, revision_count + 1, title, content_hash, html, ?, COALESCE(updated_at, fetched_at), NOW(3)
--       FROM patches WHERE id = ?;
--     UPDATE patches SET title = ?, html = ?, plain_text = ?, content_hash = ?, summary = COALESCE(?, summary),
--                        updated_at = NOW(3), revision_count = revision_count + 1
--       WHERE id = ?;
--     INSERT INTO change_events (game_id, patch_id, type, title, url, published_at, changed)
--       SELECT game_id, id, 'updated', title, url, published_at, ? FROM patches WHERE id = ?;
--     COMMIT;
--
-- (c) 오래된 수정 이력의 본문만 비우기 (용량 관리, 메타는 남긴다)
--     UPDATE patch_revisions r
--       JOIN patches p ON p.id = r.patch_id
--        SET r.html = NULL
--      WHERE r.revision_no < p.revision_count;        -- 직전 버전(= revision_count) 만 본문 유지
--
-- (d) 검색 (/api/search). 한국어는 ngram 파서라 2글자 이상 단어로 검색한다.
--     SELECT p.game_id, p.source_id, p.title, p.published_at, p.summary,
--            MATCH (p.title, p.summary, p.plain_text) AGAINST (? IN BOOLEAN MODE) AS score
--       FROM patches p
--      WHERE MATCH (p.title, p.summary, p.plain_text) AGAINST (? IN BOOLEAN MODE)
--      ORDER BY score DESC, p.published_at DESC
--      LIMIT 50;
--
-- (e) 게임 페이지 목록 (/api/:game/patches), 본문 제외
--     SELECT source_id, title, url, published_at, summary, image, category, fetched_at, updated_at, revision_count
--       FROM patches WHERE game_id = ? ORDER BY published_at DESC;
