#!/bin/sh
# Backup diário do Postgres da fusai com teste de restauração (PIE V-01).
# Roda no contêiner fuseai-backup (imagem postgres:16-alpine, usuário postgres, uid 70).
#
#   sh /opt/backup/backup.sh        laço: um backup por dia em BACKUP_AT_UTC
#   sh /opt/backup/backup.sh once   um backup agora (manual: docker exec fuseai-backup ...)
#
# Cada dump (pg_dump -Fc) é restaurado num Postgres temporário dentro do próprio contêiner. O
# teste confere o número de tabelas e de migrações aplicadas e lista as linhas das tabelas
# principais. Só um dump que passa no teste atualiza /backups/LAST_OK (lido pelo healthcheck)
# e entra na retenção (BACKUP_KEEP, padrão 7). O resultado fica em /backups/backup.log.
set -eu

DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP:-7}"
AT="${BACKUP_AT_UTC:-06:30}"
LOG="$DIR/backup.log"

log() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG"; }

# Restaura o dump num cluster temporário (só socket local) e compara com a origem.
verify() {
  dump="$1"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/restore.XXXXXX")"
  initdb -D "$tmp/data" -U fuseai --auth=trust -E UTF8 >/dev/null
  pg_ctl -D "$tmp/data" -s -w -l "$tmp/pg.log" \
    -o "-c listen_addresses= -c unix_socket_directories=$tmp -c shared_buffers=16MB -c fsync=off" start
  ok=0
  if createdb -h "$tmp" -U fuseai fuseai_restore &&
    pg_restore -h "$tmp" -U fuseai -d fuseai_restore --no-owner --exit-on-error "$dump"; then
    q_tables="select count(*) from information_schema.tables where table_schema='public'"
    q_migrations='select count(*) from "_prisma_migrations" where finished_at is not null'
    src_tables="$(psql -tAc "$q_tables")"
    dst_tables="$(psql -h "$tmp" -U fuseai -d fuseai_restore -tAc "$q_tables")"
    src_migrations="$(psql -tAc "$q_migrations")"
    dst_migrations="$(psql -h "$tmp" -U fuseai -d fuseai_restore -tAc "$q_migrations")"
    rows="$(psql -h "$tmp" -U fuseai -d fuseai_restore -tA -F= <<'SQL' | tr '
' ' '
select 'user', count(*) from "user"
union all select 'Organization', count(*) from "Organization"
union all select 'Wallet', count(*) from "Wallet"
union all select 'LedgerEntry', count(*) from "LedgerEntry"
union all select 'Payment', count(*) from "Payment";
SQL
)"
    if [ "$src_tables" = "$dst_tables" ] && [ "$src_migrations" = "$dst_migrations" ] &&
      [ "${dst_tables:-0}" -gt 0 ]; then
      log "restauração OK: $dst_tables tabelas, $dst_migrations migrações; linhas: $rows"
      ok=1
    else
      log "ERRO na restauração: tabelas $dst_tables/$src_tables, migrações $dst_migrations/$src_migrations"
    fi
  else
    log "ERRO: pg_restore falhou (detalhes em $tmp/pg.log antes da limpeza)"
  fi
  pg_ctl -D "$tmp/data" -s -m fast stop || true
  rm -rf "$tmp"
  [ "$ok" = 1 ]
}

run_once() {
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  file="$DIR/fuseai-daily-$stamp.dump"
  log "backup: iniciando $file"
  if ! pg_dump -Fc -f "$file.partial"; then
    rm -f "$file.partial"
    log "ERRO: pg_dump falhou"
    return 1
  fi
  mv "$file.partial" "$file"
  chmod 600 "$file"
  if ! verify "$file"; then
    mv "$file" "$file.failed"
    log "ERRO: dump não passou no teste de restauração (guardado como $file.failed)"
    return 1
  fi
  touch "$DIR/LAST_OK"
  # Retenção: os KEEP mais recentes que passaram no teste; falhas com mais de 7 dias saem.
  ls -1t "$DIR"/fuseai-daily-*.dump | tail -n +"$((KEEP + 1))" | xargs -r rm -f
  find "$DIR" -name 'fuseai-daily-*.dump.failed' -mtime +7 -exec rm -f {} +
  log "backup OK: $file ($(du -h "$file" | cut -f1))"
}

# Segundos até o próximo BACKUP_AT_UTC (HH:MM), só com aritmética (sem date -d).
seconds_until_next() {
  now="$(date -u +%s)"
  h="${AT%%:*}"
  m="${AT##*:}"
  h="${h#0}"
  m="${m#0}"
  target=$((h * 3600 + m * 60))
  wait=$(((target - now % 86400 + 86400) % 86400))
  [ "$wait" -eq 0 ] && wait=86400
  echo "$wait"
}

if [ "${1:-}" = "once" ]; then
  run_once
  exit $?
fi

log "agendador iniciado: backup diário às $AT UTC, mantendo $KEEP"
# Sem backup verificado nas últimas 24 h (contêiner novo ou parado): faz um agora.
if ! find "$DIR/LAST_OK" -mmin -1440 2>/dev/null | grep -q .; then
  run_once || true
fi
while true; do
  sleep "$(seconds_until_next)"
  run_once || true
done
