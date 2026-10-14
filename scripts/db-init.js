// MySQL 스키마 적용: sql/update.sql 을 그대로 실행한다 (데이터베이스가 없으면 만든다).
//   npm run db:init
// 접속 정보는 .env 의 DATABASE_URL 또는 MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE 를 쓴다.
const fs = require('fs');
const path = require('path');
const config = require('../config');

async function main() {
  let mysql;
  try { mysql = require('mysql2/promise'); } catch (e) { throw new Error('mysql2 패키지가 없습니다. npm install 을 먼저 실행하세요.'); }
  let sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'update.sql'), 'utf8');
  // 스크립트 안의 데이터베이스 이름을 설정값으로 맞춘다
  sql = sql.replace(/daily_gaming_tracker/g, config.mysql.database);
  const { database, ...conn } = config.mysql;
  const c = await mysql.createConnection({ ...conn, multipleStatements: true, charset: 'utf8mb4_0900_ai_ci' });
  console.log(`MySQL ${conn.host}:${conn.port} 에 스키마 적용 (database: ${database})`);
  await c.query(sql);
  const [tables] = await c.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ? ORDER BY table_name', [database]);
  console.log('표/뷰:', tables.map((r) => r.t).join(', '));
  await c.end();
}

main().catch((e) => { console.error(`실패: ${e.message}`); process.exit(1); });
