// 공통 설정: .env 를 읽고 저장 방식(JSON 파일 / MySQL)과 접속 정보를 정한다.
//  STORAGE=json  (기본)  store/*.json 파일에 저장. 로컬 개발용.
//  STORAGE=mysql          MySQL 에 저장 (sql/update.sql 스키마). 배포용.
//                         DATABASE_URL=mysql://user:pass@host:3306/daily_gaming_tracker 또는 MYSQL_* 변수로 접속한다.
//  DATABASE_URL 이나 MYSQL_HOST 가 있으면 STORAGE 를 생략해도 mysql 로 본다.
const fs = require('fs');
const path = require('path');

// .env 파일(프로젝트 루트)을 읽는다. 이미 있는 환경변수는 덮어쓰지 않는다.
(function loadDotEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
})();

function mysqlConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, '') || 'daily_gaming_tracker',
    };
  }
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'daily_gaming_tracker',
  };
}

const STORAGE = (process.env.STORAGE || (process.env.DATABASE_URL || process.env.MYSQL_HOST ? 'mysql' : 'json')).toLowerCase();
if (!['json', 'mysql'].includes(STORAGE)) throw new Error(`STORAGE 는 json 또는 mysql 이어야 합니다: ${STORAGE}`);

module.exports = {
  STORAGE,
  mysql: mysqlConfig(),
  PORT: Number(process.env.PORT) || 3000,
  ROOT: __dirname,
};
