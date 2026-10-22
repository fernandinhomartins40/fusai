# E2E (Playwright)

Smoke de ponta a ponta da web e da API reais:

- **Páginas públicas:** landing → docs, página de docs, termos, privacidade, 404, e o redirecionamento do painel para o login.
- **Jornada do cliente:** cadastro → link de verificação recebido por e-mail → onboarding (organização e projeto) → primeira chave → carteira com o diálogo de recarga.

Nada sai da máquina:

- **Asaas:** é o falso de `apps/api/test/fake-asaas.ts`.
- **E-mails:** vão para um SMTP local que grava em `e2e/.tmp/mail.txt`.
- **Banco:** um próprio. O nome **precisa terminar em `_e2e`**, como proteção para não usar outro banco por engano.

```bash
pnpm exec playwright install chromium   # uma vez
E2E_DATABASE_URL=postgresql://fuseai:fuseai@localhost:5432/fuseai_e2e pnpm test:e2e
```

O Playwright sobe sozinho os serviços falsos e a API, e roda `migrate deploy` e o seed antes. Depois sobe a web com `next dev`.

| Serviço | Porta | Variável para mudar |
|---|---|---|
| Web | 3200 | `E2E_WEB_PORT` |
| API | 4210 | `E2E_API_PORT` |
| Asaas falso | 4299 | `E2E_ASAAS_PORT` |
| SMTP | 2625 | `E2E_SMTP_PORT` |

O Redis padrão é `redis://localhost:6379/3`; mude com `E2E_REDIS_URL`.

Não rode junto com outro `next dev` ou `next build` em `apps/web`, porque eles disputam a pasta `.next`.

Relatório e traces de falhas ficam em `e2e/.tmp/`. No CI, o workflow `.github/workflows/e2e.yml` roda em cada PR e push na `main`.
