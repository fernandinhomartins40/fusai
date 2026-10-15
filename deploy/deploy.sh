#!/usr/bin/env bash
# Deploy da FuseAI na VPS. Executado SÓ pelo GitHub Actions (.github/workflows/deploy.yml),
# depois do rsync desta pasta para /root/fuseai/deploy. Nunca rode à mão em produção.
#
# Entrada (variáveis de ambiente):
#   FUSEAI_API_IMAGE  imagem da API/worker por digest (ghcr.io/...@sha256:...)
#   FUSEAI_WEB_IMAGE  imagem da web por digest
#
# Passos:
#   1. .env com segredos: gerado UMA vez aqui mesmo (openssl), nunca sobrescrito;
#   2. baixa as imagens novas;
#   3. Postgres e Redis no ar; backup do banco (pg_dump) antes de migrar;
#   4. prisma migrate deploy + seed idempotente com a imagem NOVA (se falhar, nada mudou);
#   5. sobe api, worker, web e nginx com as imagens novas;
#   6. saúde pela porta 3500 (Host api e www); se falhar, volta às imagens anteriores.
#
# As migrações não são desfeitas na volta automática (são aditivas). O backup do passo 3
# fica em /root/fuseai/backups para restauração manual.
set -euo pipefail

APP_DIR="${APP_DIR:-/root/fuseai/deploy}"
BACKUP_DIR="${BACKUP_DIR:-/root/fuseai/backups}"
KEEP_BACKUPS="${KEEP_BACKUPS:-14}"
PORT="${FUSEAI_PORT:-3500}"
: "${FUSEAI_API_IMAGE:?FUSEAI_API_IMAGE ausente}"
: "${FUSEAI_WEB_IMAGE:?FUSEAI_WEB_IMAGE ausente}"

cd "$APP_DIR"
export COMPOSE_PROJECT_NAME=fuseai
log() { printf '\n==> %s\n' "$*"; }

# ---------------------------------------------------------------------------- 1. segredos
if [ ! -f .env ]; then
  log "Primeiro deploy: gerando .env com segredos aleatórios (fica só nesta VPS)"
  umask 077
  admin_password="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  cat > .env <<EOF
# Gerado por deploy.sh em $(date -u +%Y-%m-%dT%H:%M:%SZ). NÃO troque ENCRYPTION_KEY nem
# KEY_PEPPER: invalida as chaves de provedor cifradas e todas as chaves de API dos clientes.
NODE_ENV=production
APP_URL=https://www.fusai.com.br
API_URL=https://api.fusai.com.br
BETTER_AUTH_URL=https://api.fusai.com.br
COOKIE_DOMAIN=fusai.com.br
LOG_LEVEL=info
POSTGRES_PASSWORD=$(openssl rand -hex 24)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)
KEY_PEPPER=$(openssl rand -hex 32)
SESSION_TOKEN_SECRET=$(openssl rand -hex 32)
ASAAS_ENV=sandbox
ASAAS_API_KEY=
ASAAS_WEBHOOK_TOKEN=$(openssl rand -hex 32)
EMAIL_FROM=FuseAI <nao-responda@fusai.com.br>
RESEND_API_KEY=
SMTP_URL=smtp://localhost:1025
SEED_ADMIN_EMAIL=admin@fusai.com.br
SEED_ADMIN_PASSWORD=${admin_password}
EOF
  chmod 600 .env
  echo "Segredos gerados em $APP_DIR/.env (permissão 600). A senha do admin está lá;"
  echo "leia por SSH, não pelo log. Preencha ASAAS_API_KEY e RESEND_API_KEY quando tiver."
fi
chmod 600 .env

# Endereços públicos não são segredo: seguem o código a cada deploy (um .env antigo com outro
# domínio é corrigido aqui). Segredos e SEED_ADMIN_EMAIL (já gravado no banco) não são tocados.
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" .env > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}
set_env APP_URL https://www.fusai.com.br
set_env API_URL https://api.fusai.com.br
set_env BETTER_AUTH_URL https://api.fusai.com.br
set_env COOKIE_DOMAIN fusai.com.br
set_env EMAIL_FROM 'FuseAI <nao-responda@fusai.com.br>'

compose() { docker compose -f docker-compose.vps.yml --env-file .env --env-file "$1" "${@:2}"; }

printf 'FUSEAI_API_IMAGE=%s\nFUSEAI_WEB_IMAGE=%s\n' "$FUSEAI_API_IMAGE" "$FUSEAI_WEB_IMAGE" > images.env.new
PREVIOUS=""
if [ -f images.env ]; then
  cp images.env images.env.previous
  PREVIOUS=images.env.previous
fi

# ---------------------------------------------------------------------------- 2. imagens
log "Baixando imagens"
docker pull -q "$FUSEAI_API_IMAGE"
docker pull -q "$FUSEAI_WEB_IMAGE"

# ---------------------------------------------------------------------------- 3. banco + backup
log "Postgres e Redis"
compose images.env.new up -d --wait postgres redis

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
tables="$(compose images.env.new exec -T postgres psql -U fuseai -d fuseai -tAc \
  "select count(*) from information_schema.tables where table_schema='public'" | tr -d '[:space:]')"
if [ "${tables:-0}" -gt 0 ]; then
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/fuseai-pre-deploy-$stamp.dump"
  log "Backup do banco -> $file"
  compose images.env.new exec -T postgres pg_dump -U fuseai -d fuseai -Fc > "$file.partial"
  mv "$file.partial" "$file"
  chmod 600 "$file"
  ls -1t "$BACKUP_DIR"/fuseai-pre-deploy-*.dump | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f
else
  log "Banco vazio (primeiro deploy): sem backup"
fi

# ---------------------------------------------------------------------------- 4. migrações + seed
log "Migrações (prisma migrate deploy)"
compose images.env.new run --rm --no-deps -T -w /app/packages/db api \
  node_modules/.bin/prisma migrate deploy

log "Seed idempotente (admin, settings, provedores, pacotes)"
compose images.env.new run --rm --no-deps -T -w /app/packages/db api \
  node_modules/.bin/tsx prisma/seed.ts

# ---------------------------------------------------------------------------- 5. aplicação
log "Subindo api, worker, web e nginx"
# Com depends_on (service_healthy), uma API que não sobe faz o `up` falhar. Não aborta aqui:
# quem decide é a verificação de saúde abaixo, que faz a volta automática.
compose images.env.new up -d --remove-orphans api worker web nginx || echo "AVISO: up retornou erro; verificando saúde" >&2
# O nginx interno lê o arquivo montado; um rsync novo não recria o contêiner.
compose images.env.new exec -T nginx nginx -s reload >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------- 6. saúde
healthy() {
  curl -fsS -m 5 -H 'Host: api.fusai.com.br' "http://127.0.0.1:$PORT/health" | grep -q '"fuseai-api"' &&
    curl -fsS -m 10 -o /dev/null -H 'Host: www.fusai.com.br' "http://127.0.0.1:$PORT/docs"
}

log "Verificando saúde em 127.0.0.1:$PORT"
for attempt in $(seq 1 30); do
  if healthy; then
    mv images.env.new images.env
    log "Deploy OK (tentativa $attempt)"
    compose images.env ps --format 'table {{.Name}}\t{{.Status}}'
    exit 0
  fi
  sleep 4
done

echo "ERRO: a aplicação não ficou saudável em 120 s." >&2
compose images.env.new logs --tail 60 api worker web nginx >&2 || true

if [ -n "$PREVIOUS" ]; then
  log "Voltando às imagens anteriores"
  compose "$PREVIOUS" up -d --remove-orphans api worker web nginx || true
  for attempt in $(seq 1 30); do
    if healthy; then
      cp "$PREVIOUS" images.env
      echo "Versão anterior restaurada e saudável. O deploy falhou." >&2
      exit 1
    fi
    sleep 4
  done
  echo "ERRO GRAVE: a versão anterior também não respondeu." >&2
else
  echo "Primeiro deploy: não há versão anterior para restaurar." >&2
fi
exit 1
