# Oracle Cloud Always Free 배포 가이드

이 문서는 Daily Gaming Tracker 를 Oracle Cloud "Always Free" VM 한 대에 올려
MySQL 저장으로 상시 운영하는 과정을 적은 것입니다. 도메인은 마지막 선택 단계이고, 없어도 서버 IP 로 바로 열립니다.

대상: 이 저장소를 직접 배포하는 사람(= 운영자 본인).
준비물: 신용/체크카드(무료라도 가입 때 본인 확인용으로 필요), SSH 를 쓸 줄 아는 수준.

---

## 1. Oracle 무료 VM 만들기 (Oracle 웹 콘솔에서)

1. https://www.oracle.com/kr/cloud/free/ 에서 가입합니다. 가입 때 고른 **홈 리전은 나중에 못 바꾸니** 한국이면 서울(Chuncheon/Seoul) 중 가까운 곳을 고릅니다.
2. 콘솔 → **Compute → Instances → Create instance**.
   - **Image:** Canonical Ubuntu 22.04 (또는 24.04)
   - **Shape:** `VM.Standard.A1.Flex` (ARM, Always Free). OCPU 1~2, 메모리 6~12GB 로 잡습니다. 이 사이트에는 **OCPU 1 / 6GB 면 충분**합니다.
     - A1 이 "용량 없음(out of capacity)" 으로 안 만들어지면, 다른 가용 도메인(AD-1/2/3)으로 바꾸거나 잠시 뒤 다시 시도합니다. 정 안 되면 AMD `VM.Standard.E2.1.Micro`(1 OCPU/1GB) 도 Always Free 지만 사양이 작습니다.
   - **SSH keys:** 로컬에서 만든 공개키를 올립니다. (Windows PowerShell: `ssh-keygen -t ed25519` → `~/.ssh/id_ed25519.pub` 내용을 붙여넣기)
3. 만들어지면 **Public IP** 를 적어 둡니다. 예: `140.238.x.x`

### 방화벽 두 군데를 열어야 합니다 (중요)

Oracle 은 기본으로 거의 다 막혀 있습니다. **80/443 포트**를 두 곳에서 열어야 바깥에서 접속됩니다.

1. **클라우드 쪽 (Security List / NSG):** 콘솔 → 해당 VCN → Security Lists → Ingress Rules 추가
   - Source `0.0.0.0/0`, TCP, Destination port `80` 과 `443` (도메인·HTTPS 전이면 임시로 `3000` 도)
2. **서버 안쪽 (OS 방화벽):** 아래 2단계에서 `iptables`/`ufw` 로 같은 포트를 엽니다.

---

## 2. 서버 기본 세팅 (SSH 접속 후)

```bash
ssh ubuntu@<서버_IP>

# 패키지 최신화
sudo apt update && sudo apt -y upgrade

# Node.js 20 LTS 설치 (이 프로젝트는 Node 18+ 필요)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt -y install nodejs git

# MySQL 8 설치
sudo apt -y install mysql-server
sudo systemctl enable --now mysql

# 서버 OS 방화벽 열기 (Ubuntu 기본 iptables 기준)
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save      # 재부팅 후에도 유지
```

### MySQL 계정·DB 준비

```bash
sudo mysql
```
```sql
CREATE DATABASE daily_gaming_tracker CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER 'dgt'@'localhost' IDENTIFIED BY '여기에_강한_비밀번호';
GRANT ALL ON daily_gaming_tracker.* TO 'dgt'@'localhost';
-- 한국어 전문검색(ngram)을 위해 토큰 크기 확인: 기본 2 면 OK
SHOW VARIABLES LIKE 'ngram_token_size';
EXIT;
```
`ngram_token_size` 가 2 가 아니면 `/etc/mysql/mysql.conf.d/mysqld.cnf` 의 `[mysqld]` 에
`ngram_token_size=2` 를 넣고 `sudo systemctl restart mysql` 합니다. (설치 직후 바꿔야 인덱스가 올바르게 만들어집니다.)

---

## 3. 앱 배포

```bash
cd ~
git clone https://github.com/GGLEGO/daily_gaming_traker.git
cd daily_gaming_traker
npm install --omit=dev

# 환경설정
cp .env.example .env
nano .env
```

`.env` 를 이렇게 채웁니다:

```
PORT=3000
STORAGE=mysql
DATABASE_URL=mysql://dgt:여기에_강한_비밀번호@127.0.0.1:3306/daily_gaming_tracker
ANTHROPIC_API_KEY=sk-ant-...      # 챗봇 쓸 때만. 없으면 검색 안내 모드
```

스키마 적용 후 첫 수집:

```bash
npm run db:init      # sql/update.sql 로 표 생성
npm start            # 로그에 "저장 방식: mysql" 이 뜨고, 데이터가 없으면 바로 수집 시작
```

`http://<서버_IP>:3000` 이 열리면 성공입니다. 확인 후 Ctrl+C 로 멈추고 아래 PM2 로 상시 실행합니다.

> 로컬 PC 에 모아 둔 기존 데이터를 그대로 옮기고 싶으면, 로컬에서 운영 DB 로 `DATABASE_URL` 을 맞추고
> `npm run db:migrate` 를 돌리면 됩니다. 새로 시작해도 무방하면 이 단계는 건너뜁니다.

---

## 4. 상시 실행 (PM2)

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js        # 단일 인스턴스 (스케줄러 중복 방지)
pm2 save
pm2 startup systemd                  # 출력되는 sudo 명령을 그대로 한 번 실행 → 재부팅 후 자동 시작
pm2 logs dgt                         # 로그 보기
```

이제 서버가 꺼졌다 켜져도 자동으로 다시 뜨고, 매일 09:00(KST) 패치 수집이 돕니다.

> **Always Free 유휴 회수 주의:** Oracle 은 7일간 CPU·네트워크 사용률이 20% 아래로 낮으면 무료 VM 을 회수할 수 있습니다.
> 접속이 거의 없어도 수집 스케줄러가 매일 도니 완전 유휴는 아니지만, 불안하면 외부 업타임 모니터(UptimeRobot 등)로 5분마다 핑을 보내 두면 안전합니다.

---

## 5. 포트 80 으로 서비스 + (선택) 도메인·HTTPS

지금은 `:3000` 으로 접속합니다. 80 포트와 도메인·HTTPS 는 Caddy 가 가장 간단합니다.

```bash
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
```

`/etc/caddy/Caddyfile` 을 아래처럼 두고 `sudo systemctl restart caddy`:

- **도메인이 아직 없으면 (IP 로만):**
  ```
  :80 {
      reverse_proxy 127.0.0.1:3000
  }
  ```
- **도메인을 샀고 DNS A 레코드를 서버 IP 로 연결했으면 (HTTPS 자동):**
  ```
  your-domain.com {
      reverse_proxy 127.0.0.1:3000
  }
  ```
  Caddy 가 Let's Encrypt 인증서를 자동 발급·갱신합니다. 이때 클라우드 Security List 에 443 이 열려 있어야 합니다.

도메인은 가장 마지막에, 원할 때 사면 됩니다. 산 뒤 등록기관(가비아·Cloudflare 등)에서 A 레코드를 서버 IP 로 가리키고 위 Caddyfile 의 도메인만 바꾸면 끝입니다.

---

## 업데이트 배포 (코드 바뀌었을 때)

```bash
cd ~/daily_gaming_traker
git pull
npm install --omit=dev
# 스키마가 바뀌었으면: npm run db:init  (CREATE ... IF NOT EXISTS 라 여러 번 돌려도 안전)
pm2 restart dgt
```

## 점검 명령

| 확인 | 명령 |
| --- | --- |
| 저장 방식·수집 상태 | `curl localhost:3000/api/status` (응답의 `storage` 가 `mysql`) |
| 앱 로그 | `pm2 logs dgt` |
| DB 내용 | `mysql -udgt -p daily_gaming_tracker -e "SELECT game_id, COUNT(*) FROM patches GROUP BY game_id;"` |
| MySQL 상태 | `sudo systemctl status mysql` |
