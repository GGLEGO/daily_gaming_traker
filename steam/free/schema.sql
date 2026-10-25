-- Steam 무료 게임 (장르 교차 필터용) 저장 테이블
-- steam/free/index.js 가 채운다. 게임 1행에 속한 장르들을 genres(CSV)로 담아, 여러 장르 AND 필터를 지원한다.
-- (MySQL 모드. JSON 모드는 store/steam_free.json 사용) db:init(sql/update.sql)에도 동일 정의가 있다.
CREATE TABLE IF NOT EXISTS steam_free_games (
  appid        VARCHAR(16)  NOT NULL,
  name         VARCHAR(300) NOT NULL,
  url          VARCHAR(500) NOT NULL,
  image        VARCHAR(600) NULL COMMENT '헤더 이미지',
  capsule      VARCHAR(600) NULL COMMENT '캡슐(목록) 이미지',
  review       VARCHAR(16)  NULL COMMENT 'positive | mixed | negative',
  review_text  VARCHAR(100) NULL,
  released     VARCHAR(60)  NULL,
  players      INT UNSIGNED NULL COMMENT '동시 접속자 수 (수집 시점)',
  genres       VARCHAR(120) NOT NULL COMMENT '속한 장르 id 들 (CSV: coop,fps ...)',
  pop_rank     SMALLINT UNSIGNED NOT NULL COMMENT '전체 인기 순위 (1부터)',
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (appid)
) ENGINE=InnoDB COMMENT='Steam 무료 게임 (장르 교차 필터)';
