# 온프레미스 서버에 올리기

누비투어를 사내 서버 한 대에 Docker Compose로 올리는 순서예요. PostgreSQL과 앱이 함께 뜨고, 앱은 서버 안(`127.0.0.1`)에서만 열려요. 바깥에서는 nginx를 거쳐 들어와요.

> 이 문서에는 실제 서버 주소를 쓰지 않아요. `<서버 주소>`, `<도메인>` 자리는 각자 환경에 맞게 바꿔 주세요. CI의 `docker` 잡이 아래 2~6단계를 그대로 돌려 확인해요.

## 1. 준비

```bash
docker --version          # 24 이상
docker compose version    # v2 이상
```

- Docker가 없으면 공식 안내대로 Docker Engine과 compose 플러그인을 설치해요.
- 서버 계정이 `docker` 그룹에 들어 있거나 `sudo`를 쓸 수 있어야 해요.
- 포트: 앱은 기본 `127.0.0.1:3100`. 이미 쓰는 포트(예: 8010·8020·8080)와 겹치면 `.env`의 `APP_PORT`를 바꿔요.

Docker를 쓸 수 없으면 Node 22와 PostgreSQL 16을 직접 설치해서 `npm ci → npx prisma migrate deploy → npm run build → npm start`로 띄워도 돼요(맨 아래 "Docker 없이").

## 2. 코드 받기

```bash
sudo mkdir -p /srv/nubi-tour && sudo chown "$USER" /srv/nubi-tour
git clone https://github.com/Catbooks-demo/nubi-tour.git /srv/nubi-tour
cd /srv/nubi-tour
git checkout main
```

## 3. 설정 파일 (.env)

```bash
cp .env.example .env
chmod 600 .env
```

| 값 | 넣을 것 |
|---|---|
| `POSTGRES_PASSWORD` | DB 비밀번호. `openssl rand -base64 24` |
| `SESSION_SECRET` | 세션·비회원 쿠키 서명 비밀값, **32자 이상** (짧으면 앱이 켜지지 않아요). `openssl rand -base64 32` |
| `APP_BASE_URL` | 손님이 들어올 주소 (`https://<도메인>`). https면 쿠키에 Secure가 붙어요 |
| `APP_PORT` | 앱이 열 포트 (기본 3100) |
| `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY` | 토스페이먼츠 **테스트** 키(`test_`로 시작). 비우면 모의 결제. `live_` 키를 넣으면 앱이 켜지지 않아요 |
| `SEED_STAFF_EMAIL`, `SEED_STAFF_PASSWORD` | 시드가 만들 첫 관리자 계정. 시드 뒤에는 지워도 돼요 |
| `JOBS_ENABLED` | 예약금 기한 만료 같은 주기 작업. 앱을 하나만 띄우면 `true` 그대로 |

`DATABASE_URL`은 compose가 알아서 `db`로 바꿔 넣어요. `.env`는 레포에 올리지 않아요.

## 4. 띄우기

```bash
docker compose up -d --build --wait
docker compose ps        # db, app 모두 healthy
```

앱은 켜질 때마다 DB 마이그레이션을 먼저 적용해요(이미 적용된 것은 건너뜀).

## 5. 시드 (처음 한 번)

```bash
docker compose exec app npm run db:seed
```

상품 41개, 오늘부터 90일 동안의 출발일, 공지·FAQ, 첫 관리자 계정을 넣어요. 다시 돌려도 이미 있는 것은 그대로예요(출발일 좌석·예약은 건드리지 않음). 출발일은 오늘 기준이라, 몇 주 뒤 다시 돌리면 그 뒤 날짜가 더해져요.

## 6. 확인

```bash
curl -fsS http://127.0.0.1:3100/healthz   # {"status":"ok"}
curl -fsS http://127.0.0.1:3100/readyz    # {"status":"ready"} (DB 연결까지)
```

브라우저에서 상품을 하나 골라 예약하고 결제(모의 또는 토스 테스트)까지 해 봐요. 직원 화면은 `/admin`이에요.

## 7. nginx 연결

새 설정 파일을 하나 만들어요. 기존 사이트 설정은 건드리지 않아요.

```nginx
# /etc/nginx/conf.d/nubi-tour.conf
server {
    listen 80;                      # 또는 쓰지 않는 다른 포트, https면 443 + 인증서
    server_name <도메인 또는 서버 주소>;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;   # 손님이 보낸 값을 이어 붙이지 않고 실제 접속 주소로 덮어쓴다
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`X-Forwarded-For`는 로그인·조회 시도 제한이 손님 IP를 구분하는 데 써요. 손님이 보낸 값을 그대로 이어 붙이면(`$proxy_add_x_forwarded_for`) 제한을 피할 수 있으니 꼭 `$remote_addr`로 덮어써 주세요. 같은 서버의 다른 서비스와 nginx를 같이 쓰면 바꾸기 전에 담당자에게 알려 주세요.

## 8. 매일 백업

```bash
mkdir -p /srv/nubi-tour/backups
crontab -e
# 매일 04:10에 백업, 30일 지난 것은 지움
10 4 * * * cd /srv/nubi-tour && docker compose exec -T db pg_dump -U nubi -Fc nubi > backups/nubi-$(date +\%F).dump && find backups -name 'nubi-*.dump' -mtime +30 -delete
```

되살리기:

```bash
docker compose stop app
docker compose exec -T db pg_restore -U nubi -d nubi --clean --if-exists < backups/nubi-YYYY-MM-DD.dump
docker compose start app
```

## 9. 업데이트

```bash
cd /srv/nubi-tour
git pull --ff-only
docker compose up -d --build --wait
```

## 10. 되돌리기

```bash
git log --oneline -5             # 돌아갈 커밋 고르기
git checkout <커밋>
docker compose up -d --build --wait
```

마이그레이션은 앞으로만 가요. 표를 바꾼 업데이트를 되돌릴 때는 업데이트 직전 백업으로 되살린 뒤 위 순서를 따라요.

## 11. 외부 시스템 연결 (나중에)

- **API 키**: 직원 화면 `/admin/api-keys`에서 발급해요. 설명은 `/api/v1/openapi.json`.
- **읽기 전용 DB 계정**: 외부 시스템이 DB를 직접 읽어야 할 때만 만들어요.

```bash
docker compose exec -T db psql -U nubi -d nubi <<'SQL'
CREATE ROLE reader LOGIN PASSWORD '<읽기 계정 비밀번호>';
GRANT CONNECT ON DATABASE nubi TO reader;
GRANT USAGE ON SCHEMA public TO reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO reader;
ALTER DEFAULT PRIVILEGES FOR ROLE nubi IN SCHEMA public GRANT SELECT ON TABLES TO reader;
REVOKE SELECT ON sessions, staff_sessions, api_keys FROM reader;
SQL
```

DB 포트는 기본으로 바깥에 열려 있지 않아요. 같은 서버에서 붙을 때만 `compose.override.yml`로 서버 안에만 열어요.

```yaml
# compose.override.yml
services:
  db:
    ports:
      - "127.0.0.1:5433:5432"
```

## Docker 없이

```bash
# PostgreSQL 16에 nubi 사용자·DB를 만든 뒤
cp .env.example .env   # DATABASE_URL을 실제 DB로
npm ci
npx prisma migrate deploy
npm run db:seed
npm run build
PORT=3100 npm start    # systemd 서비스로 등록해 두면 다시 켜져요
```
