#!/usr/bin/env bash
# Deploy da fusai na VPS. Executado SÓ pelo GitHub Actions (.github/workflows/deploy.yml),
# depois do rsync desta pasta para /root/fuseai/deploy. Nunca rode à mão em produção.
#
# Entrada (variáveis de ambiente):
#   FUSEAI_API_IMAGE  imagem da API/worker por digest (ghcr.io/...@sha256:...)
#   FUSEAI_WEB_IMAGE  imagem da web por digest
#   SKIP_MIGRATIONS=1 só no rollback (workflow "Rollback"): reimplanta imagens antigas sem
#                     rodar migração nem seed (o banco continua no schema mais novo)
#
# Passos:
#   1. .env com segredos: gerado UMA vez aqui mesmo (openssl), nunca sobrescrito;
#   2. baixa as imagens novas;
#   3. Postgres e Redis no ar; backup do banco (pg_dump) antes de migrar;
#   4. prisma migrate deploy + seed idempotente com a imagem NOVA (se falhar, nada mudou);
#   5. pré-teste: a API e a web novas sobem em contêineres à parte e precisam responder
#      (a API com Postgres e Redis) enquanto a versão atual segue no ar; se falhar, para aqui;
#   6. troca as duas réplicas da API uma de cada vez (a outra segue atendendo) e sobe
#      worker, web, nginx e backup com as imagens novas;
#   7. saúde pela porta 3500 (Host api e www) e worker rodando; se falhar, volta às imagens
#      anteriores.
#
# As migrações não são desfeitas na volta automática (são aditivas). O backup do passo 3
# fica em /root/fuseai/backups; os diários (serviço backup) em /root/fuseai/backups/daily.
# Procedimentos manuais (restauração, rollback): docs/OPERACAO.md.
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
# A API não sobe com BETTER_AUTH_SECRET ou SESSION_TOKEN_SECRET < 32 caracteres, nem KEY_PEPPER < 16.
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
EMAIL_FROM=fusai <nao-responda@fusai.com.br>
VELOMAIL_API_KEY=
VELOMAIL_WEBHOOK_SECRET=
SMTP_URL=smtp://localhost:1025
SEED_ADMIN_EMAIL=admin@fusai.com.br
SEED_ADMIN_PASSWORD=${admin_password}
EOF
  chmod 600 .env
  echo "Segredos gerados em $APP_DIR/.env (permissão 600). A senha do admin está lá;"
  echo "leia por SSH, não pelo log. A chave da VeloMail vem dos secrets do GitHub."
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
set_env EMAIL_FROM 'fusai <nao-responda@fusai.com.br>'

# Segredos que chegam dos secrets do GitHub Actions: gravados só quando informados; vazio
# mantém o valor atual (um deploy sem o secret não desliga o e-mail que já funcionava).
if [ -n "${VELOMAIL_API_KEY:-}" ]; then set_env VELOMAIL_API_KEY "$VELOMAIL_API_KEY"; fi
if [ -n "${VELOMAIL_WEBHOOK_SECRET:-}" ]; then set_env VELOMAIL_WEBHOOK_SECRET "$VELOMAIL_WEBHOOK_SECRET"; fi
grep -q '^VELOMAIL_API_KEY=re_' .env && echo "E-mail: VeloMail configurada" || echo "AVISO: VELOMAIL_API_KEY ausente; e-mails da aplicação não serão enviados" >&2

# Asaas (Pix). O ambiente segue o prefixo da chave: $aact_prod_ = produção, $aact_hmlg_ =
# sandbox. Entre aspas simples: a chave começa com "$" e o compose interpolaria o valor.
if [ -n "${ASAAS_API_KEY:-}" ]; then
  case "$ASAAS_API_KEY" in
    '$aact_prod_'*) asaas_env=production ;;
    '$aact_hmlg_'*) asaas_env=sandbox ;;
    # Formato antigo (sem prod/hmlg): as chaves antigas de sandbox já não são emitidas.
    '$aact_'*) asaas_env=production ;;
    # Texto provisório ou chave colada errada: avisa e mantém o que já estava no .env.
    *) asaas_env="" ; echo "AVISO: o secret ASAAS_API_KEY não é uma chave do Asaas (\$aact_prod_... ou \$aact_hmlg_...); ignorado" >&2 ;;
  esac
  case "$ASAAS_API_KEY" in *"'"*) asaas_env="" ; echo "AVISO: ASAAS_API_KEY com aspas simples; ignorado" >&2 ;; esac
  if [ -n "$asaas_env" ]; then
    set_env ASAAS_API_KEY "'$ASAAS_API_KEY'"
    set_env ASAAS_ENV "$asaas_env"
  fi
fi
# Email que o Asaas avisa quando o webhook falha. Texto provisório (sem formato de email) é ignorado.
email_re='^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}$'
if [[ "${ASAAS_WEBHOOK_EMAIL:-}" =~ $email_re ]]; then
  set_env ASAAS_WEBHOOK_EMAIL "$ASAAS_WEBHOOK_EMAIL"
elif [ -n "${ASAAS_WEBHOOK_EMAIL:-}" ]; then
  echo "AVISO: o secret ASAAS_WEBHOOK_EMAIL não é um email; ignorado" >&2
fi
if grep -q "^ASAAS_API_KEY='\$aact_" .env; then
  echo "Pix: Asaas configurado ($(grep '^ASAAS_ENV=' .env | cut -d= -f2))"
else
  echo "AVISO: ASAAS_API_KEY ausente; recargas via Pix ficam indisponíveis" >&2
fi

compose() { docker compose -f docker-compose.vps.yml --env-file .env --env-file "$1" "${@:2}"; }

# Backups diários: fora do volume do Postgres, graváveis pelo usuário postgres (uid 70) do
# contêiner fuseai-backup.
export FUSEAI_BACKUP_DIR="$BACKUP_DIR/daily"
install -d -m 700 "$BACKUP_DIR"
install -d -m 700 -o 70 -g 70 "$FUSEAI_BACKUP_DIR"
# Status of the last daily backup, readable by the worker (dates only, no data).
export FUSEAI_BACKUP_STATUS_DIR="$BACKUP_DIR/status"
install -d -m 755 -o 70 -g 70 "$FUSEAI_BACKUP_STATUS_DIR"

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
if [ "${SKIP_MIGRATIONS:-0}" = 1 ]; then
  log "Rollback: sem migração e sem seed (o banco fica no schema atual)"
else
  log "Migrações (prisma migrate deploy)"
  compose images.env.new run --rm --no-deps -T -w /app/packages/db api \
    node_modules/.bin/prisma migrate deploy

  # O seed vem empacotado na imagem (apps/api/dist/seed.js): a imagem não leva tsx.
  log "Seed idempotente (admin, settings, provedores, pacotes)"
  compose images.env.new run --rm --no-deps -T api node apps/api/dist/seed.js
fi

# ---------------------------------------------------------------------------- 5. pré-teste
# Prontidão da API dentro de um contêiner: /health/ready (Postgres + Redis). Imagens antigas,
# sem essa rota (404), caem no /health.
api_ready_in() {
  docker exec "$1" node -e "
    const get = (p) => fetch('http://127.0.0.1:4000' + p, { signal: AbortSignal.timeout(5000) });
    get('/health/ready').then((r) => (r.status === 404 ? get('/health') : r))
      .then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));" 2>/dev/null
}
web_ready_in() {
  docker exec "$1" node -e "
    fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(5000) })
      .then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1));" 2>/dev/null
}
running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = true ]; }
container_healthy() { [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null)" = healthy ]; }

# Two API replicas (api -> fuseai-api, api2 -> fuseai-api-2) replaced one at a time: while
# one restarts, fuseai-nginx sends traffic to the other. api2 goes first so that, on the
# deploy that introduces it, it exists before nginx loads a config naming it.
roll_api() {
  local env_file="$1" svc ctr attempt
  for svc in api2 api; do
    ctr=fuseai-api
    if [ "$svc" = api2 ]; then ctr=fuseai-api-2; fi
    compose "$env_file" up -d --no-deps "$svc" || return 1
    for attempt in $(seq 1 30); do
      container_healthy "$ctr" && break
      running "$ctr" || return 1
      sleep 3
    done
    container_healthy "$ctr" || return 1
    # From here on nginx can route to both replicas.
    if [ "$svc" = api2 ]; then
      sync_nginx "$env_file" || echo "AVISO: nginx interno não recarregou" >&2
    fi
  done
  return 0
}

# A API e a web novas sobem em contêineres à parte (sem porta publicada, mesma rede e mesmo
# .env). Uma imagem que não sobe (segredo fraco recusado no boot, engine do Prisma faltando,
# import quebrado) é barrada aqui, sem tocar na versão que está atendendo.
preflight() {
  local ok=1 attempt
  docker rm -f fuseai-api-preflight fuseai-web-preflight >/dev/null 2>&1 || true
  if ! compose images.env.new run -d --no-deps --name fuseai-api-preflight api >/dev/null ||
    ! compose images.env.new run -d --no-deps --name fuseai-web-preflight web >/dev/null; then
    ok=2
  fi
  if [ "$ok" = 1 ]; then
    for attempt in $(seq 1 30); do
      if api_ready_in fuseai-api-preflight && web_ready_in fuseai-web-preflight; then
        ok=0
        break
      fi
      # Processo encerrado (erro no boot): não adianta esperar.
      if ! running fuseai-api-preflight || ! running fuseai-web-preflight; then break; fi
      sleep 3
    done
  fi
  if [ "$ok" != 0 ]; then
    echo "--- api (pré-teste)" >&2
    docker logs --tail 60 fuseai-api-preflight >&2 || true
    echo "--- web (pré-teste)" >&2
    docker logs --tail 30 fuseai-web-preflight >&2 || true
  fi
  docker rm -f fuseai-api-preflight fuseai-web-preflight >/dev/null 2>&1 || true
  [ "$ok" = 0 ]
}

log "Pré-teste das imagens novas (a versão atual continua no ar)"
if ! preflight; then
  echo "ERRO: a imagem nova não ficou pronta no pré-teste. Nada foi trocado; a versão anterior segue no ar." >&2
  exit 1
fi

# ---------------------------------------------------------------------------- 6. aplicação
# O nginx interno lê a pasta deploy/nginx montada. Confere que o contêiner vê exatamente o
# arquivo do disco, valida e recarrega (um rsync não recria o contêiner).
sync_nginx() {
  local disk ctr
  disk="$(sha256sum nginx/fuseai.conf | cut -d' ' -f1)"
  ctr="$(compose "$1" exec -T nginx sha256sum /etc/nginx/conf.d/fuseai.conf 2>/dev/null | cut -d' ' -f1 || true)"
  if [ "$disk" != "$ctr" ]; then
    echo "nginx interno com configuração diferente do disco: recriando o contêiner" >&2
    compose "$1" up -d --force-recreate --no-deps nginx || true
  fi
  compose "$1" exec -T nginx nginx -t
  compose "$1" exec -T nginx nginx -s reload
}

log "Trocando as réplicas da API uma de cada vez"
ROLLED=1
if ! roll_api images.env.new; then
  # The replica not yet replaced keeps serving: do not touch anything else, go straight to
  # the automatic rollback below.
  ROLLED=0
  echo "AVISO: uma réplica da API nova não ficou saudável; voltando às imagens anteriores" >&2
fi
if [ "$ROLLED" = 1 ]; then
  log "Subindo worker, web, nginx e backup"
  # --no-deps: the API replicas are already up; depends_on must not recreate them.
  compose images.env.new up -d --no-deps --remove-orphans worker web nginx backup || echo "AVISO: up retornou erro; verificando saúde" >&2
  sync_nginx images.env.new || echo "AVISO: falha ao validar/recarregar o nginx interno" >&2
fi

# ---------------------------------------------------------------------------- 7. saúde
# API pela porta 3500: /health/ready (com banco e Redis); imagem antiga sem a rota (404) cai
# no /health.
api_ready() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 -H 'Host: api.fusai.com.br' "http://127.0.0.1:$PORT/health/ready" || true)"
  [ "$code" = 200 ] && return 0
  [ "$code" = 404 ] &&
    curl -fsS -m 5 -H 'Host: api.fusai.com.br' "http://127.0.0.1:$PORT/health" | grep -q '"fuseai-api"'
}
healthy() {
  api_ready &&
    container_healthy fuseai-api &&
    container_healthy fuseai-api-2 &&
    running fuseai-worker &&
    curl -fsS -m 10 -o /dev/null -H 'Host: www.fusai.com.br' "http://127.0.0.1:$PORT/docs" &&
    curl -fsS -m 10 -o /dev/null -H 'Host: www.fusai.com.br' "http://127.0.0.1:$PORT/brand/logo-fusai.png"
}

log "Verificando saúde em 127.0.0.1:$PORT"
for attempt in $(seq 1 30); do
  [ "$ROLLED" = 1 ] || break
  if healthy; then
    mv images.env.new images.env
    log "Deploy OK (tentativa $attempt)"
    # Webhook do Asaas apontando para esta API (idempotente; erro aqui não desfaz o deploy).
    if grep -q "^ASAAS_API_KEY='" .env; then
      log "Webhook do Asaas"
      compose images.env run --rm --no-deps -T -v "$APP_DIR/asaas-webhook.mjs:/tmp/asaas-webhook.mjs:ro"         api node /tmp/asaas-webhook.mjs || echo "AVISO: não foi possível conferir o webhook do Asaas" >&2
    fi
    compose images.env ps --format 'table {{.Name}}\t{{.Status}}'
    if [ -f "$FUSEAI_BACKUP_DIR/backup.log" ]; then
      log "Últimos registros do backup diário"
      tail -n 3 "$FUSEAI_BACKUP_DIR/backup.log"
    fi
    exit 0
  fi
  sleep 4
done

if [ "$ROLLED" = 1 ]; then
  echo "ERRO: a aplicação não ficou saudável em 120 s." >&2
else
  echo "ERRO: a réplica nova da API não ficou saudável." >&2
fi
compose images.env.new logs --tail 60 api api2 worker web nginx backup >&2 || true

if [ -n "$PREVIOUS" ]; then
  log "Voltando às imagens anteriores"
  roll_api "$PREVIOUS" || true
  compose "$PREVIOUS" up -d --no-deps --remove-orphans worker web nginx backup || true
  sync_nginx "$PREVIOUS" || true
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
