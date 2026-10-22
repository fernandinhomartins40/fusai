# Operação da fusai na VPS

Produção roda na VPS compartilhada (2 vCPU, 7,75 GB, cerca de 11 outros apps). A fusai só mexe nos contêineres `fuseai-*`. **Toda mudança chega pelo push na `main` (GitHub Actions → `deploy/deploy.sh`).** Os comandos abaixo, executados na VPS, servem só para consulta e emergência.

## Serviços (`deploy/docker-compose.vps.yml`)

| Contêiner | Função | CPU (teto) | Memória | PIDs | Parada |
|---|---|---|---|---|---|
| fuseai-postgres | banco (volume `pgdata`) | 1,0 | 512 MB | 256 | padrão |
| fuseai-redis | filas BullMQ, rate limit | 0,5 | 192 MB | 128 | padrão |
| fuseai-api | Fastify (`/health`, `/health/ready`) | 1,0 | 512 MB | 256 | 65 s |
| fuseai-worker | Pix, webhooks, expiração, reservas | 0,5 | 384 MB | 128 | 65 s |
| fuseai-web | Next.js | 0,75 | 384 MB | 256 | 30 s |
| fuseai-nginx | roteia por Host em 127.0.0.1:3500 | 0,25 | 64 MB | 64 | padrão |
| fuseai-backup | `pg_dump` diário com teste de restauração | 0,25 | 256 MB | 64 | padrão |

### Por que esses limites

Em 2026-10-21 a pilha inteira usava cerca de 384 MiB e quase 0 % de CPU em repouso ([RELATORIO_PERFORMANCE_VPS.md](pie/RELATORIO_PERFORMANCE_VPS.md)).

- **CPU:** o `cpus` é um **teto**, não uma reserva. Nenhum contêiner pega os 2 vCPU dos vizinhos, mas cada um ainda pode chegar ao próprio teto num pico. A soma dos tetos (4,25) passa de 2 de propósito, porque os picos raramente coincidem.
- **Memória:** os valores já estavam em produção e ficam entre 2 e 4 vezes o uso medido.
- **Logs:** todos rodam com json-file de 10 MB × 3 arquivos.

## Healthchecks

- **API:** o `/health` só diz que o processo responde, e é ele que o Docker usa. O `/health/ready` também testa Postgres e Redis, com 2 s cada, e devolve 503 quando um deles falha. O deploy usa o `/health/ready`.
- **Worker:** grava `/tmp/fusai-worker-heartbeat` a cada job terminado. O `deliver-webhooks` roda a cada 30 s, então o arquivo é renovado com frequência. O healthcheck acusa problema quando o arquivo passa de 2 min sem atualização. Como o Docker não reinicia contêiner apenas "unhealthy", o próprio worker **encerra** depois de 3 min sem terminar nenhum job, e o `restart: unless-stopped` o sobe de novo.
- **Backup:** fica "unhealthy" quando o último backup verificado tem mais de 26 h.

```bash
docker ps --filter name=fuseai- --format 'table {{.Names}}\t{{.Status}}'
```

## Deploy

O `deploy/deploy.sh` faz, nesta ordem:

1. Confere o `.env`.
2. Baixa as imagens por digest.
3. Faz o backup pré-deploy.
4. Roda `prisma migrate deploy` e o seed.
5. **Pré-teste:** sobe a API e a web novas em contêineres à parte. A API precisa responder `/health/ready`, e a web, `/api/health`. Enquanto isso, a versão atual continua no ar. Se a imagem nova não subir (por exemplo, segredo fraco recusado no boot, engine do Prisma faltando ou import quebrado), o deploy para aqui **sem trocar nada**.
6. Troca api, worker, web, nginx e backup.
7. Verifica a saúde pela porta 3500. Se falhar, volta automaticamente às imagens anteriores.

**Desligamento sem cortar respostas:** ao receber SIGTERM, a API para de aceitar conexões e espera até 55 s pelas requisições e streams de chat em andamento. O worker termina os jobs em curso. O `stop_grace_period` de 65 s dá essa folga antes do SIGKILL.

### Primeiro deploy com estas mudanças

- **postgres e redis são recriados** (limites de CPU/PIDs e logs novos), com alguns segundos de indisponibilidade antes das migrações. A API antiga pode responder erro nesse intervalo.
- A imagem da API passa a ter só as dependências de produção. O tamanho comprimido aparece no resumo do job `build-api`.
- O serviço `fuseai-backup` nasce e faz o primeiro backup verificado logo ao subir, porque ainda não existe nenhum backup nas últimas 24 h.

## Rollback

**Automático:** acontece dentro do deploy (pré-teste e verificação de saúde).

**Manual, para defeito descoberto depois:**
1. Abra **Actions → "Rollback fusai (manual)" → Run workflow**.
2. Informe o SHA completo do commit bom.

O workflow reimplanta as imagens `sha-<commit>` que já estão no GHCR, sem build e **sem migração nem seed**. O banco continua no schema mais novo, porque as migrações são aditivas. Depois, reverta o commit na `main` para o código acompanhar.

> Imagens apagadas da VPS pelo prune diário do host não atrapalham: o rollback baixa do GHCR.

Pré-requisito das migrações: precisam continuar **aditivas** (expand/contract). Colunas e tabelas removidas só saem depois que nenhuma versão em uso depende delas.

## Backups

- **Pré-deploy:** `/root/fuseai/backups/fuseai-pre-deploy-*.dump`. São os últimos 14, feitos pelo `deploy.sh`.
- **Diários:** `/root/fuseai/backups/daily/fuseai-daily-*.dump`. São os últimos 7, feitos às 03:30 de Brasília (06:30 UTC) pelo `fuseai-backup` (`deploy/backup/backup.sh`).
  - Cada dump é **restaurado num Postgres temporário** dentro do contêiner. O teste compara o número de tabelas e de migrações aplicadas com a origem e registra as linhas de `user`, `Organization`, `Wallet`, `LedgerEntry` e `Payment`.
  - Só um dump aprovado entra na retenção e atualiza o `LAST_OK`. Um dump reprovado vira `*.dump.failed`, fica guardado por 7 dias e deixa o contêiner "unhealthy".
  - Log: `/root/fuseai/backups/daily/backup.log`.

**Limitação conhecida:** os backups ficam no mesmo disco da VPS (decisão do dono, sem custo novo). Uma perda do disco leva o banco e os backups juntos. Não há alerta por email: o sinal é o status "unhealthy" e o log.

```bash
# backup agora (fora do horário)
docker exec fuseai-backup sh /opt/backup/backup.sh once
# últimos resultados
tail -n 20 /root/fuseai/backups/daily/backup.log
```

### Restauração manual (emergência)

1. Escolha o dump, de preferência o diário mais recente aprovado no `backup.log`:
   ```bash
   ls -lt /root/fuseai/backups/daily/ /root/fuseai/backups/ | head
   ```
2. Pare quem escreve no banco, para não haver gravações durante a restauração:
   ```bash
   cd /root/fuseai/deploy
   docker compose -f docker-compose.vps.yml --env-file .env --env-file images.env stop api worker
   ```
3. Guarde o estado atual antes de sobrescrever:
   ```bash
   docker exec fuseai-postgres pg_dump -U fuseai -d fuseai -Fc > /root/fuseai/backups/antes-da-restauracao-$(date -u +%Y%m%d-%H%M%S).dump
   ```
4. Restaure. O `--clean --if-exists` recria os objetos do dump:
   ```bash
   docker exec -i fuseai-postgres pg_restore -U fuseai -d fuseai --clean --if-exists --no-owner < /root/fuseai/backups/daily/fuseai-daily-AAAAMMDD-HHMMSS.dump
   ```
5. Suba de novo e confira:
   ```bash
   docker compose -f docker-compose.vps.yml --env-file .env --env-file images.env up -d api worker
   curl -s -H 'Host: api.fusai.com.br' http://127.0.0.1:3500/health/ready
   ```
6. Os Pix pagos depois do horário do dump estão no Asaas. A varredura do worker reconcilia os pendentes; confira os demais no painel do Asaas.

Para só **inspecionar** um dump sem tocar em produção:
```bash
docker run --rm -v /root/fuseai/backups/daily:/b:ro postgres:16-alpine pg_restore -l /b/<arquivo>.dump | head
```
