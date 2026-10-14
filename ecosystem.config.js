// PM2 설정 (배포용). 실행: pm2 start ecosystem.config.js
// 반드시 단일 인스턴스(fork, instances:1) 로 둔다. 2개 이상이면 스케줄러가 중복 실행되어
// 같은 패치를 두 번 수집하고 Steam/수집 결과를 서로 덮어쓴다.
module.exports = {
  apps: [
    {
      name: 'dgt',
      script: 'server.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      // .env 파일을 읽으므로 여기서 환경변수를 또 넣을 필요는 없다.
      // 굳이 PM2 로 주고 싶으면 아래 주석을 풀고 .env 대신 쓴다.
      // env: { NODE_ENV: 'production', STORAGE: 'mysql', DATABASE_URL: 'mysql://dgt:...@127.0.0.1:3306/daily_gaming_tracker' },
      time: true, // 로그에 시각 표시
    },
  ],
};
