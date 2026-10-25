-- Steam 무료 게임 목록 (장르별 인기순 상위 10개) 저장 테이블
-- steam/free/index.js 가 이 테이블에 쓰고 읽는다. (MySQL 모드. JSON 모드는 store/steam_free.json 사용)
-- db:init(sql/update.sql)에도 같은 정의가 들어 있어 스키마 적용 시 함께 생성된다.
CREATE TABLE IF NOT EXISTS steam_free_games (
  genre        VARCHAR(16)  NOT NULL COMMENT '장르 id (coop, rpg, puzzle, racing, aos, card, fps)',
  rank_no      TINYINT UNSIGNED NOT NULL COMMENT '장르 내 인기 순위 (1부터)',
  appid        VARCHAR(16)  NOT NULL,
  name         VARCHAR(300) NOT NULL,
  url          VARCHAR(500) NOT NULL,
  image        VARCHAR(600) NULL COMMENT '헤더 이미지',
  capsule      VARCHAR(600) NULL COMMENT '캡슐(목록) 이미지',
  review       VARCHAR(16)  NULL COMMENT 'positive | mixed | negative',
  review_text  VARCHAR(100) NULL,
  released     VARCHAR(60)  NULL,
  players      INT UNSIGNED NULL COMMENT '동시 접속자 수 (수집 시점)',
  updated_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (genre, rank_no)
) ENGINE=InnoDB COMMENT='Steam 무료 게임 장르별 목록';
