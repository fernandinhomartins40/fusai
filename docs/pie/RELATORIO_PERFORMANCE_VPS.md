# Relatório PIE — Motor D: infraestrutura, deploy e desempenho

- Data da coleta: 2026-10-21, entre 18:21 e 18:24 UTC.
- Escopo: código e configuração (Dockerfile, `deploy/`, workflows, nginx, tsup, next.config, API e worker) e medição **somente leitura** na VPS compartilhada (alias SSH `fuseai-vps`).
- Nada foi alterado: nenhum código, commit, push, restart, prune ou edição na VPS. Não foram lidos `.env` nem segredos.
- Legenda: **MEDIDO** = observado por comando nesta coleta. **INFERIDO** = deduzido do código ou da configuração, sem medição.

## 1. Topologia

```
Internet ─► nginx do HOST (1.18, TLS certbot, :80/:443, compartilhado por ~8 sites)
             └─► 127.0.0.1:3500 ─► fuseai-nginx (1.27-alpine, roteia pelo Host)
                                     ├─ api.fusai.com.br ─► fuseai-api :4000 (Fastify 5)
                                     └─ www / apex     ─► fuseai-web :3000 (Next 15 standalone)
             fuseai-worker (mesma imagem da API, BullMQ, concurrency 4)
             fuseai-postgres (16-alpine, volume pgdata) · fuseai-redis (7-alpine, AOF, noeviction 128 MB)
             rede docker "internal": só o fuseai-nginx publica porta (127.0.0.1:3500)
```

- **Deploy** (`.github/workflows/deploy.yml`): push na main → validação de migrações → lint/typecheck/test → build das imagens `fuseai-api` e `fuseai-web` no GHCR (por digest) → rsync de `deploy/` → `deploy.sh` na VPS: pull, `pg_dump` pré-deploy, `prisma migrate deploy` + seed com a imagem NOVA, `up -d`, reload do nginx interno, health em :3500 (até 120 s) e **volta automática** às imagens anteriores se falhar → verificação pública.
- **Vizinhos na VPS** (MEDIDO, `docker ps`): 39 contêineres de cerca de 11 aplicações (mercadoflow, bipae, rebania, makucho, palmital, advocacia, metalgest, tagflow, fusesite e outras). A fusai tem 6 contêineres.

## 2. Medições (MEDIDO)

| Item | Comando | Resultado |
|---|---|---|
| Host | `uptime`, `nproc` | 2 vCPU; ligado há 4 d 6 h; load 0,60 / 1,00 / 1,28 |
| RAM | `free -m` | 7936 MB no total; 2771 usados; 5010 em buff/cache; **4295 disponíveis**; **sem swap** |
| CPU | `vmstat 1 3` | us 5–10 %, sy 4–6 %, id 74–81 %, **st (steal) 6–17 %** |
| Pressão | `/proc/pressure/*` | CPU some avg300 = **8,27 %**; memória some 0,07 %; I/O some 0,22 % |
| OOM | `journalctl -k --since -4days` | 0 eventos de OOM |
| Disco | `df -h` | `/` 97 G, 55 G usados (57 %), 42 G livres; SSD (`rotational=0`) |
| Docker | `docker system df` | 42 imagens / 11,4 GB (2,6 GB recuperáveis); volumes 6,76 GB; 23 imagens dangling |
| Imagens fusai | `docker images`, `docker history` | **fuseai-api 1,44 GB** (camada `COPY /app /app` = 1,19 GB); fuseai-web 340 MB (standalone 83 MB) |
| Volumes fusai | `docker system df -v` | pgdata 50 MB; redisdata 67 MB |
| Uso por contêiner | `docker stats --no-stream` | web 110 MiB/384; api 139/512; worker 61/384; nginx 8/64; postgres 60/512; redis 6/192 → **fusai ≈ 384 MiB no total (≈ 4,8 % da RAM)**, CPU ≈ 0 % (redis 3,3 % na amostra) |
| Limites | `docker inspect` | mem_limit em todos (soma 2048 MiB); **sem limite de CPU** (NanoCpus=0); **sem PidsLimit**; restart `unless-stopped`; RestartCount 0; OOMKilled false; api/worker/web rodam como `node` |
| Logs | `docker inspect` + `du` no LogPath | api 3,9 MB; redis 152 KB; nginx 20 KB; demais 0. api/worker/web com `max-size 10m, max-file 3`; **postgres/redis/nginx sem opções de rotação** (`map[]`) |
| Rotação global | `/etc/docker/daemon.json` | json-file 10m×3 (vale só para contêineres criados depois dela) |
| Redis | `redis-cli INFO` | usados 3,4 MB de 128 MB; noeviction; 5 clientes (1 bloqueado = worker BullMQ); 0 evicted; 2,17 M comandos em ~4 dias (≈ 6/s em repouso); AOF 66 MB contra base de 280 KB |
| Postgres | `psql` (pg_stat_activity, show) | 10 conexões (1 ativa, 9 ociosas) de 100 (`max_connections`); shared_buffers 128 MB; banco de 9,5 MB |
| Backups | `ls /root/fuseai/backups` | 14 dumps pré-deploy (53–66 KB, 824 KB no total), o último de 18/10 18:56; **nenhum agendamento**; mesmo disco da VPS |
| Prune automático | `/etc/cron.d/docker-image-prune` | `docker image prune -af --filter until=24h` todo dia às 00:04 |
| Imagens anteriores | digests de `images.env.previous` contra `docker images --digests` | **0 de 2 presentes** no disco |
| Portas | `ss -tlnp` | fusai só em 127.0.0.1:3500 ✔; outros apps publicam 0.0.0.0 (3010, 3180, 3190, 3230, 7000, 8109) |
| HTTP/2 | grep em `sites-enabled` | o site fusai não declara `http2`; 8 sites declaram (no nginx 1.18 o http2 vale por socket, então a fusai provavelmente herda; INFERIDO) |
| Resposta local (:3500) | `curl -w %{time_total}` (5 api, 3+3+2 web) | api `/health` 2–8 ms; web `/api/health` 5 ms; home 4–8 ms (30,8 KB); `/docs` 5–9 ms |
| Resposta pública | `curl` a partir da estação do auditor (10 requisições) | www home: TTFB 149–244 ms (o TLS responde por ~60–110 ms disso); api `/health` total 222–298 ms; apex → 301 para www em 229 ms. CSS estático com gzip (44 KB → 9 KB) e `immutable` |

Leitura: a fusai gasta pouco (≈ 384 MiB e CPU próxima de zero em repouso). A latência pública vem quase toda de rede e TLS, já que o processamento local fica abaixo de 10 ms. O ponto fraco do host é a CPU: são 2 vCPU para 39 contêineres, com steal de até 17 % e pressão de CPU de 8 %.

## 3. Achados

| ID | Sev. | Achado | Base |
|---|---|---|---|
| V-01 | **Alta** | Backup só antes de cada deploy, no mesmo disco e sem cópia externa | MEDIDO |
| V-02 | Média | A imagem da API tem 1,44 GB, com o monorepo inteiro e as devDependencies | MEDIDO |
| V-03 | Média | Rollback manual frágil: o prune diário apaga as imagens anteriores, e as migrações não voltam | MEDIDO + INFERIDO |
| V-04 | Média | Deploy derruba streams SSE/MCP longos (stop timeout padrão de 10 s) | INFERIDO |
| V-05 | Média | O worker não tem healthcheck, e o `/health` da API não testa Postgres nem Redis | MEDIDO (config) |
| V-06 | Média | Nenhum contêiner tem limite de CPU ou de PIDs num host de 2 vCPU com 39 contêineres | MEDIDO |
| V-07 | Baixa | postgres, redis e nginx da fusai sem rotação de log | MEDIDO |
| V-08 | Baixa | Healthchecks com `node -e fetch` sobem um processo Node a cada 10 s (api e web) | INFERIDO |
| V-09 | Baixa | O AOF do Redis cresce até ~64 MB antes de reescrever (dados reais: 3,4 MB) | MEDIDO |
| V-10 | Baixa | O site do host não declara `http2`, e o nginx do host expõe a versão | MEDIDO (config) |
| V-11 | Info | Pool do Prisma no padrão (5 conexões por processo) | MEDIDO |
| V-12 | Info | Host sobrecomprometido: a soma dos limites passa da RAM, não há swap e 4 apps não têm limite | MEDIDO |

### V-01 — Backup só pré-deploy, no mesmo disco (Alta)
- **Evidência:** `deploy/deploy.sh` (passo 3) só roda `pg_dump` dentro do deploy. Em `/root/fuseai/backups` há 14 dumps, o último de 18/10. Não há cron nem timer de backup da fusai. Os dumps ficam no mesmo disco do volume `pgdata`, e nenhuma restauração é testada.
- **Impacto:** o banco guarda o ledger financeiro (saldos, pagamentos Pix). Hoje 3 dias de transações estão sem backup. Se o disco ou a VPS se perderem, perdem-se o banco e os backups juntos.
- **Recomendação:** um `pg_dump -Fc` diário (com retenção de 7 diários e 4 semanais) por um contêiner/serviço `backup` no compose da fusai, versionado e aplicado pelo deploy, com cópia cifrada para fora da VPS (bucket S3 compatível ou Backblaze, credencial em secret). Também um teste mensal de restauração num banco temporário. O dump atual é de ~66 KB, então o custo é desprezível.
- **Risco:** baixo. O `pg_dump` não bloqueia escrita. A credencial do bucket deve ser só de escrita.
- **Rollback:** remover o serviço `backup` do compose. Isso não afeta a aplicação.

### V-02 — Imagem da API de 1,44 GB (Média)
- **Evidência:** no `Dockerfile`, o estágio `api` faz `COPY --from=build-api /app /app` e leva o monorepo inteiro com todos os `node_modules`: Next, devDependencies e o fonte da web. `docker history` mostra 1,19 GB nessa camada. O motivo é que `deploy.sh` usa a mesma imagem para `prisma migrate deploy` e `tsx prisma/seed.ts`.
- **Impacto:** cada deploy baixa ~1,2 GB descomprimidos, porque essa camada muda a cada commit. Isso gasta banda e I/O do host compartilhado durante o pull e aumenta o tempo de deploy e a superfície de ataque. Não afeta a RAM em execução.
- **Recomendação:** separar os alvos. O alvo `api` leva só `apps/api/dist` e as dependências de produção (`pnpm deploy --prod --filter @fusai/api /out`, mais `prisma generate`). Um alvo `migrate` à parte leva `prisma` e `tsx` para migrações e seed. Ganho esperado: imagem de runtime entre ~250 e 400 MB, ou seja, pull de 3 a 5 vezes menor.
- **Risco:** médio. O bundle do tsup marca `@prisma/client` e `.prisma` como externos, então eles precisam estar na imagem. Um engine do Prisma faltando derruba a API. A volta automática do `deploy.sh` cobre esse caso.
- **Rollback:** reverter o commit do Dockerfile/deploy. O próximo deploy volta à imagem completa.

### V-03 — Rollback manual frágil (Média)
- **Evidência:** a volta automática do `deploy.sh` só existe dentro do job de deploy. O cron diário `docker image prune -af --filter until=24h`, que é do host e não da fusai, já apagou as duas imagens de `images.env.previous` (MEDIDO: 0 de 2). O job faz `docker logout ghcr.io` ao terminar, e o workflow não aceita entrada de digest para reimplantar uma versão. As migrações são aplicadas antes da troca e não são desfeitas.
- **Impacto:** se um defeito aparecer horas depois do deploy, voltar exige reverter o commit na main e esperar a esteira inteira (testes e build, cerca de 10 a 20 min). A versão antiga também precisa tolerar o schema novo (INFERIDO: a regra "migrações aditivas" está documentada, mas nada a força).
- **Recomendação:** (a) um `workflow_dispatch` "Rollback" com entrada `sha`, que reimplanta as imagens `sha-<commit>` já no GHCR sem rodar build nem migração; (b) documentar o padrão expand/contract nas migrações. Não mexer no cron de prune, que é do host e serve aos outros apps.
- **Risco:** baixo. Só acrescenta um caminho.
- **Rollback:** apagar o workflow.

### V-04 — Deploy derruba streams longos (Média)
- **Evidência:** o nginx permite `proxy_read_timeout 600s` para SSE e MCP. O compose não define `stop_grace_period`, então vale o padrão de 10 s antes do SIGKILL. O `server.ts` faz `app.close()`. A volta automática e o `up -d` recriam api, web e worker em todo deploy, com uma única réplica.
- **Impacto:** a cada deploy há alguns segundos de indisponibilidade da API, e um chat em streaming com mais de 10 s é cortado. A reserva de saldo fica presa até o `release-holds` (a cada 5 min) liberá-la, e o cliente recebe erro no meio da resposta.
- **Recomendação:** `stop_grace_period: 60s` em api e worker. Avaliar também deploys em horário de baixo uso. Zero downtime de verdade, com duas réplicas atrás do nginx interno, custaria mais RAM, cerca de 140 MiB por réplica.
- **Risco:** baixo. O deploy fica até ~60 s mais longo.
- **Rollback:** remover a chave do compose.

### V-05 — Worker sem healthcheck e health raso (Média)
- **Evidência:** `fuseai-worker` mostra só "Up", sem `(healthy)`. O `/health` da API devolve `ok` sem consultar Postgres nem Redis (`modules/health/routes.ts`).
- **Impacto:** se o worker travar com o processo vivo (conexão Redis presa, por exemplo), Pix pago deixa de ser creditado, as cobranças não expiram e os webhooks não são entregues, sem alerta nem reinício. Uma API sem banco continua "saudável", e o deploy a aprova.
- **Recomendação:** o worker grava um heartbeat (chave Redis com TTL ou arquivo) a cada job agendado, e um healthcheck o confere. Criar um `/health/ready` que faça `SELECT 1` e `PING` com timeout curto, usado pelo `deploy.sh`. O `/health` raso continua para o docker. Para alertar, monitor externo gratuito no `/health/ready`.
- **Risco:** baixo. Um readiness mal calibrado pode reprovar um deploy bom; usar timeout de 2 s.
- **Rollback:** remover o healthcheck ou a rota.

### V-06 — Sem limite de CPU e de PIDs (Média, efeito nos vizinhos)
- **Evidência:** NanoCpus=0 e PidsLimit vazio em todos os contêineres fusai. O host tem 2 vCPU, steal de 6 a 17 % e pressão de CPU de 8 % (MEDIDO).
- **Impacto:** um pico de tokenização (`js-tiktoken`) ou de JSON grande (bodyLimit de 20 MB) na API, ou um laço no worker, pode tomar os 2 vCPU e degradar os outros apps. O inverso também acontece. O caso mais provável é o seed ou a migração no deploy.
- **Recomendação:** `cpus: "1.0"` em api, `0.5` em worker e web, `0.5` em postgres e `pids_limit: 256`. Esses tetos não reservam nada: só impedem um contêiner de usar a CPU toda.
- **Risco:** baixo a médio. Pode aumentar a latência da API em pico, por isso convém medir p95 antes e depois com a mesma carga.
- **Rollback:** remover as chaves e fazer novo deploy.

### V-07 — Logs sem rotação em postgres, redis e nginx (Baixa)
- **Evidência:** `LogConfig.Config = map[]` nesses 3 contêineres, criados antes do `daemon.json` atual. Os três de aplicação têm 10m×3. Os tamanhos ainda são pequenos (≤ 152 KB), mas o nginx interno manda o access log para o stdout.
- **Recomendação:** um `x-logging` explícito no compose (json-file, 10m, 3), aplicado a todos os serviços, para não depender do host. Isso só vale ao recriar os contêineres, o que no postgres e no redis significa alguns segundos de queda, então fazer junto de um deploy planejado.
- **Risco:** baixo. **Rollback:** remover a âncora.

### V-08 — Healthcheck com `node -e` (Baixa)
- **Evidência:** api e web rodam `node -e "fetch(...)"` a cada 10 s, ou seja, sobem dois processos Node a cada 10 s (~40 MB e ~50–100 ms de CPU cada, INFERIDO).
- **Recomendação:** intervalo de 30 s depois do `start_period`, ou um binário leve de checagem (`wget` do busybox numa imagem slim, ou um script `node` mínimo já carregado). Ganho estimado: cerca de 1 % de um núcleo, que conta num host de 2 vCPU.
- **Risco:** detecção de falha mais lenta (até 3 min com 6 retries). **Rollback:** voltar o intervalo.

### V-09 — AOF do Redis (Baixa)
- **Evidência:** `aof_current_size` de 66 MB contra `aof_base_size` de 280 KB e 3,4 MB de dados. O BullMQ gera ~6 comandos/s em repouso.
- **Recomendação:** `--auto-aof-rewrite-min-size 16mb` no `command` do redis, o que economiza ~50 MB de disco e acelera o restart.
- **Risco:** desprezível. **Rollback:** remover o parâmetro.

### V-10 — HTTP/2 e versão do nginx do host (Baixa)
- **Evidência:** `deploy/nginx-host/fusai.com.br` e o arquivo no host têm `listen 443 ssl` sem `http2`. O cabeçalho `Server: nginx/1.18.0 (Ubuntu)` aparece. O curl do auditor não suporta HTTP/2, então não foi possível confirmar o protocolo negociado.
- **Recomendação:** acrescentar `http2` ao `listen 443 ssl` do site fusai. No 1.18 o socket já é compartilhado com sites que o declaram, então o risco é mínimo. O `server_tokens off` é global e afeta os outros sites, por isso só com aprovação do dono da VPS.
- **Rollback:** tirar o `http2` e fazer `nginx -t && reload`.

### V-11 — Pool do Prisma no padrão (Info)
- MEDIDO: 10 conexões, ou seja, 5 por processo (2 vCPU × 2 + 1) entre api e worker, de 100 possíveis. É adequado para o volume atual. Sob carga de chat concorrente, se aparecer espera por conexão, ajustar `connection_limit` na `DATABASE_URL` (por exemplo 10 na api). Sem ação agora.
- Também MEDIDO: há um único worker (sem duplicata) e 5 clientes Redis, o esperado (api: cliente e fila; worker: conexão e bloqueante).

### V-12 — Host sobrecomprometido (Info, efeito nos vizinhos)
- MEDIDO: a soma dos `mem_limit` dos contêineres com limite passa de ~10 GB em 7,75 GB de RAM. 4 apps rodam sem limite (palmital, metalgest, tagflow, fusesite), não há swap, e `fusesite` está `unhealthy`. Hoje há 4,3 GB disponíveis e nenhum OOM em 4 dias.
- A fusai está dentro do que reserva (2048 MiB de teto, 384 MiB de uso). Reduzir os limites da fusai não libera memória, porque limite não é reserva.
- Recomendação para o dono da VPS, fora do escopo da fusai e com aprovação: swap de 2 a 4 GB como amortecedor contra o OOM killer do host, e limites nos apps sem limite.

## 4. Efeito nas outras aplicações da VPS

- **Em repouso:** a fusai usa ≈ 384 MiB de RAM (4,8 %), CPU próxima de zero, ~120 MB de volumes e 1,8 GB de imagens. O impacto é baixo.
- **Durante o deploy:** é o maior impacto. Há o pull de ~1,2 GB (V-02), a migração e o seed com `tsx`, que pesa em CPU, e a recriação de 3 contêineres, tudo sem teto de CPU (V-06). Num host de 2 vCPU com steal alto, isso pode aumentar a latência dos vizinhos por alguns minutos. V-02 e V-06 reduzem esse efeito.
- **Rede e portas:** a fusai está isolada, com só 127.0.0.1:3500 e rede docker própria. O site no nginx do host é independente, e o `setup-host.sh` usa `reload`, não restart.
- **Prune do host:** o cron global de prune afeta o rollback da fusai (V-03), mas não deve ser alterado por ela.

## 5. Ordem sugerida (nada aplicado)

1. V-01 (backup diário com cópia externa e teste de restauração).
2. V-05 (heartbeat do worker e readiness) e V-04 (`stop_grace_period`).
3. V-03 (workflow de rollback por SHA).
4. V-06 e V-07 (CPU, PIDs e logs no compose, num único deploy planejado).
5. V-02 (imagem enxuta). Medir antes e depois o tempo de deploy e o tamanho da imagem.
6. V-08, V-09 e V-10 (ajustes finos).

Todas as mudanças passam pela esteira: commit na main, GitHub Actions e a volta automática do `deploy.sh`, sempre com aprovação do dono antes.

## 6. Não verificado

- O protocolo HTTP/2 negociado (limitação do curl local).
- p95/p99 sob carga, porque não foi feito teste de carga para não afetar a VPS compartilhada.
- Consultas lentas: `pg_stat_statements` não está instalado; só existe a extensão `plpgsql`.
- Visibilidade (pública ou privada) dos pacotes no GHCR.
- Se o Node 22 limita o heap pelo cgroup nesses contêineres (sem `NODE_OPTIONS` definido).

## 7. Medição do gateway (2026-10-22)

> **Ambiente:** máquina de desenvolvimento Windows 11 (8 núcleos lógicos), **não é a VPS**. API em modo produção (`node dist/server.js`, `NODE_ENV=production`, log `info`), Postgres 16 local (porta 5433, banco `fuseai_pie_pf` próprio), Redis local 5.0 (produção usa 7). Os outros agentes da auditoria rodavam suítes de teste ao mesmo tempo: carga de CPU da máquina de **44% no início e 22% no fim** da bateria final (74% durante a primeira bateria). Os números servem para comparar ordens de grandeza, não como SLA de produção.

**Método.** Upstream falso local (`scratchpad/perf/fake.cjs`) com latência fixa: sem streaming responde após 20 ms (≈ 31 ms medidos, por causa da granularidade do timer do Windows); com streaming envia o 1º chunk na hora e grava o instante exato em que o escreveu. Carga com autocannon 7.15 (instalado só no scratchpad), 15 s por cenário, aquecimento antes. Latência coletada por requisição para p95 exato.
- **Overhead** (meta PRD §13: p95 < 50 ms) = latência pelo gateway − latência direta no upstream falso, na mesma concorrência.
- **Repasse do 1º chunk** (meta: < 30 ms após o 1º chunk do upstream) = instante em que o cliente recebe o byte com o id do chunk − instante em que o upstream o escreveu (mesma máquina, relógio `performance.timeOrigin + now()`).

### Resultados (bateria final, código atual, sem mudanças de desempenho)

| Concorrência | Direto p50 / p95 | Gateway p50 / p95 / p99 | **Overhead p50 / p95** | Gateway req/s | Repasse 1º chunk p50 / p95 / p99 | Erros |
|---|---|---|---|---|---|---|
| 1 | 31,4 / 33,2 ms | 47,1 / 52,1 / 62,9 ms | **15,7 / 18,9 ms** ✅ | 21 | 1,4 / 1,9 / 2,2 ms ✅ | 0 |
| 10 | 31,5 / 33,2 ms | 70,8 / 115,4 / 150,6 ms | **39,4 / 82,1 ms** ❌ | 132 | 1,1 / 1,6 / 2,3 ms ✅ | 0 |
| 50 | 31,6 / 33,9 ms | 324,5 / 475,1 / 613,0 ms | **292,9 / 441,3 ms** ❌ | 146 | 1,2 / 1,9 / 2,8 ms ✅ | 0 |

Primeira bateria (mesmo código, máquina a 74% de CPU): overhead p95 de 321 ms (c=1), 332 ms (c=10) e 1,46 s (c=50), com 6 a 64 req/s. A diferença entre as baterias é a carga dos outros processos, não o código: com a máquina livre, o mesmo build caiu para 19 ms de overhead p95 em c=1.

**Conclusões**
- **Streaming: meta atendida** com folga em todas as concorrências (p99 ≤ 2,8 ms contra a meta de 30 ms).
- **Overhead sem streaming: meta atendida em baixa concorrência** (c=1: p95 19 ms) e **não atendida a partir de ~10 conexões simultâneas** num único processo Node: a vazão satura em ~130–150 req/s e o tempo vira fila.
- **Decomposição por requisição** (c=1, marcações temporárias no handler, já removidas): ~5 ms antes do upstream (autenticação, rate limit, reserva), ~9 ms depois (liquidação + `UsageLog` na mesma transação), ~4 ms de Fastify/autenticação fora do handler.
- **Gargalo é CPU, e a maior parte é o Prisma**: perfil de CPU sob c=10 (`scratchpad/perf/before.cpuprofile`) mostrou ~10 ms de CPU por requisição; **41% no cliente Prisma** (`parseEngineResponse`, `request`, `mapQueryEngineResult`), 26% em internals do Node (I/O da engine, buffers), 8% undici (chamada ao upstream), 3% no código da fusai, 2% Fastify, 1,6% pino, 1,6% ioredis, 0,2% js-tiktoken.
- **Commits do Postgres não são o gargalo**: medido p50 0,8 ms (`SELECT 1`), 1,1 ms (`UPDATE` autocommit), 2,2 ms (transação interativa com 1 `UPDATE`).

**Por que nenhuma otimização foi aplicada.** O custo está em código fora do escopo seguro do gateway: as transações interativas de `reserve()`/`settle()` (regra de dinheiro, `billing/wallet.ts`) e a autenticação com `include` aninhado (`apiKey → project → org → wallet`), que o Prisma 6 executa como 4 consultas separadas sem o recurso `relationJoins` (exige mudar o `schema.prisma`). As alternativas dentro do gateway (pular a checagem de saldo baixo por alguns segundos, cachear a chave em memória) mudam comportamento (alerta perdido no último pedido, chave revogada aceita por alguns segundos) e não foram feitas sem decisão do dono.

**Recomendações (por ganho estimado)**
1. **Mais de um processo da API** (2 réplicas atrás do `fuseai-nginx`, ou `node:cluster`): o gargalo é CPU de um único núcleo; dobra a vazão sem tocar em regras. Requer avaliar memória na VPS compartilhada.
2. **`previewFeatures = ["relationJoins"]`** no `schema.prisma` + `relationLoadStrategy: 'join'` na autenticação: 4 consultas viram 1.
3. **Reserva e liquidação sem transação interativa**: `reserve()` pode virar um único `WITH … UPDATE … INSERT` em `$executeRaw` (mesma condição atômica `balance − reserved + limit ≥ hold`). Mexe em regra de dinheiro: exige revisão e os testes de concorrência existentes.
4. **Medir na VPS** com a mesma bateria (fora do horário de pico, poucos segundos por cenário), porque a VPS é Linux, com outra CPU e vizinhos.

Artefatos (fora do repositório): `scratchpad/perf/bench.mjs`, `fake.cjs`, `result-before.json`, `result-after.json`, `before.cpuprofile`.

## 8. Autenticação em 1 consulta e 2 réplicas da API (2026-10-23)

Aprovado pelo dono: (a) consulta de autenticação única e (b) duas réplicas da API na VPS.

**Mudanças**
- `schema.prisma`: `previewFeatures = ["relationJoins"]`. `gateway/auth.ts` usa `relationLoadStrategy: 'join'`: chave → projeto → organização → carteira passam de **4 consultas para 1** (conferido com o log de queries do Prisma). No session token, o usuário final e a chave emissora são lidos em paralelo. Sem cache de chave: uma chave revogada continua recusada na hora.
- `deploy/docker-compose.vps.yml`: serviço `api2` (`fuseai-api-2`), igual ao `api`; cada réplica com teto de 0,75 vCPU e 512 MB.
- `deploy/nginx/fuseai.conf`: upstream com as duas réplicas (`least_conn`, `max_fails=3 fail_timeout=10s`, `keepalive 32`), e `proxy_next_upstream error` com 2 tentativas. O nginx não reenvia um POST que já chegou a uma API, então uma cobrança não roda duas vezes.
- `deploy/deploy.sh`: as réplicas são trocadas **uma de cada vez** (`api2` primeiro, depois `api`), esperando o healthcheck de cada uma; a outra segue atendendo. Se a réplica nova não ficar saudável, o script volta às imagens anteriores **sem tocar na réplica que ainda está com a versão atual**.

**Validação**
- `bash -n` e `dash -n` no `deploy.sh`; `docker compose config` renderiza `api2` com healthcheck, limites e `depends_on` herdados.
- `nginx -t` (nginx 1.26.3 oficial) aprovou a configuração, com os nomes dos contêineres trocados por `127.0.0.1`.
- Simulação do `deploy.sh` com `docker` e `curl` falsos (o `docker` guarda qual imagem cada réplica roda):

  | Cenário | Resultado |
  |---|---|
  | Primeiro deploy (sem `api2`) | `api2` nasce, o nginx recarrega com as duas, depois a `api` é trocada; "Deploy OK" |
  | Deploy de rotina | Mesma ordem; "Deploy OK" |
  | Réplica nova com defeito | Só a `api2` recebe a imagem nova; a `api` nunca é tocada; volta às imagens anteriores; saída 1 |

- A própria simulação achou um defeito na primeira versão, já corrigido: depois de uma réplica falhar, o `up` seguinte trocaria também a réplica saudável pela imagem ruim.

**Medição (máquina dev Windows, não é a VPS)**

Mesmo método da seção 7 (bench do scratchpad, 10 s por cenário). As duas réplicas rodaram atrás do **nginx real** com a configuração de produção; a carga ficou dividida igualmente (2.734 / 2.733 requisições). **A máquina estava muito carregada pelas suítes de outros agentes**, e a carga variou entre as baterias.

| Cenário | CPU da máquina | Overhead p95 c=1 | Overhead p95 c=10 · req/s | Overhead p95 c=50 · req/s | Repasse do 1º chunk p99 |
|---|---|---|---|---|---|
| Antes (client antigo, 1 processo) | 32–57 % | 20,9 ms | 212 ms · 76 | 980 ms · 77 | ≤ 17,6 ms |
| Join, 1 processo | 66 % | 17,9 ms | 209 ms · 70 | 940 ms · 71 | ≤ 6,1 ms |
| Join, 2 réplicas + nginx | 28–53 % | 23,7 ms | **152 ms · 91** | 1.202 ms · 82 | ≤ 2,5 ms |

**Conclusões**
- Com 1 conexão, a meta de 50 ms continua atendida. O streaming continua dentro da meta (p99 ≤ 30 ms) em todos os cenários.
- Com 10 conexões, as 2 réplicas deram **+30 % de vazão** e reduziram o p95 de 209 para 152 ms, ainda **acima da meta**. Com 50 conexões, a fila aumentou (o nginx para Windows usa um processo só, com `select`, e as réplicas disputavam CPU com os testes dos outros agentes).
- **Não dá para afirmar que a meta foi atingida.** Os números desta máquina, sob carga externa, não representam a VPS: na bateria da seção 7, com a máquina mais livre, um único processo chegou a 132–146 req/s. A confirmação precisa da mesma bateria **na VPS**, fora do pico.
- O ganho estrutural das réplicas independe da medição local: elas dobram o teto de CPU disponível para a API (de 1 para 1,5 vCPU no total) e eliminam a janela de indisponibilidade da API no deploy.
