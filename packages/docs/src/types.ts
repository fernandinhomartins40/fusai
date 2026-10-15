export type DocPage = { slug: string; title: string; description: string; body: string };

/** Absolute URLs substituted into the docs: {{API}}, {{V1}}, {{MCP}}, {{APP}}. */
export type DocUrls = { api: string; app: string };
