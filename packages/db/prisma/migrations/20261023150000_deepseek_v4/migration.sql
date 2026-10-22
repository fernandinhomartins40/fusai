-- DeepSeek retired deepseek-chat / deepseek-reasoner; the current models are deepseek-flash
-- (DeepSeek-V4.1-Flash-1017) and deepseek-v4-pro. Public slugs stay the same for clients.
-- Costs are DeepSeek's official PEAK prices in USD per 1M tokens (never sell below cost):
-- https://api-docs.deepseek.com/quick_start/pricing (checked 2026-10-23).

-- Provider-specific fields merged into the upstream body (e.g. thinking on/off).
ALTER TABLE "Model" ADD COLUMN "upstreamParams" JSONB;

-- fuse/deepseek-chat -> deepseek-flash without thinking (thinking is on by default upstream).
UPDATE "Model" SET
  "upstreamModel" = 'deepseek-flash',
  "upstreamParams" = '{"thinking":{"type":"disabled"}}'::jsonb,
  "contextWindow" = 1000000,
  "maxOutputTokens" = 8192,
  "inputCostUsdPerM" = 0.30,
  "cachedInputCostUsdPerM" = 0.006,
  "outputCostUsdPerM" = 1.20,
  "supportsTools" = true,
  "supportsVision" = true,
  "supportsReasoning" = false,
  "displayName" = CASE WHEN "displayName" = 'DeepSeek Chat' THEN 'DeepSeek V4.1 Flash' ELSE "displayName" END,
  "description" = CASE
    WHEN "description" IS NULL OR "description" LIKE 'Preço de exemplo%'
    THEN 'Modelo rápido de uso geral da DeepSeek (V4.1 Flash), com respostas diretas, sem etapa de raciocínio. Aceita ferramentas (tool calling), saída em JSON e imagens. Contexto de 1 milhão de tokens.'
    ELSE "description" END
WHERE "slug" = 'fuse/deepseek-chat';

-- fuse/deepseek-reasoner -> deepseek-flash with thinking (the upstream default).
UPDATE "Model" SET
  "upstreamModel" = 'deepseek-flash',
  "upstreamParams" = NULL,
  "contextWindow" = 1000000,
  "maxOutputTokens" = 32768,
  "inputCostUsdPerM" = 0.30,
  "cachedInputCostUsdPerM" = 0.006,
  "outputCostUsdPerM" = 1.20,
  "supportsTools" = true,
  "supportsVision" = true,
  "supportsReasoning" = true,
  "displayName" = CASE WHEN "displayName" = 'DeepSeek Reasoner' THEN 'DeepSeek V4.1 Flash (raciocínio)' ELSE "displayName" END,
  "description" = CASE
    WHEN "description" IS NULL OR "description" LIKE 'Preço de exemplo%'
    THEN 'DeepSeek V4.1 Flash com raciocínio: pensa antes de responder, indicado para lógica, matemática e código. Aceita ferramentas (tool calling), saída em JSON e imagens. Contexto de 1 milhão de tokens.'
    ELSE "description" END
WHERE "slug" = 'fuse/deepseek-reasoner';

-- New fuse/deepseek-v4-pro, active, AUTO price with the global markup.
INSERT INTO "Model" (
  "id", "slug", "displayName", "description", "providerId", "upstreamModel",
  "contextWindow", "maxOutputTokens", "inputCostUsdPerM", "cachedInputCostUsdPerM",
  "outputCostUsdPerM", "priceMode", "supportsTools", "supportsVision", "supportsReasoning",
  "fallbackModelIds", "active", "public", "sortOrder"
)
SELECT
  'deepseek-v4-pro-' || substr(md5(random()::text), 1, 12),
  'fuse/deepseek-v4-pro',
  'DeepSeek V4 Pro',
  'Modelo mais capaz da DeepSeek (V4 Pro), com raciocínio para tarefas complexas, agentes e código. Aceita ferramentas (tool calling) e saída em JSON. Contexto de 1 milhão de tokens.',
  p."id",
  'deepseek-v4-pro',
  1000000, 32768, 1.32, 0.044, 3.96,
  'AUTO', true, false, true,
  ARRAY[]::TEXT[], true, true, 2
FROM "Provider" p
WHERE p."slug" = 'deepseek'
ON CONFLICT ("slug") DO NOTHING;
