/** Errors returned by /v1 in the OpenAI format: `{ error: { message, type, code } }` (PRD §7.1). */
export class GatewayError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly type: string = typeFor(statusCode),
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }

  toBody() {
    return { error: { message: this.message, type: this.type, code: this.code } };
  }
}

function typeFor(status: number): string {
  if (status === 401) return 'authentication_error';
  if (status === 402) return 'billing_error';
  if (status === 403) return 'permission_error';
  if (status === 429) return 'rate_limit_error';
  if (status >= 500) return 'api_error';
  return 'invalid_request_error';
}

export const invalidApiKey = (message = 'Chave de API inválida, revogada ou expirada.') =>
  new GatewayError(401, 'invalid_api_key', message);

export const insufficientFunds = () =>
  new GatewayError(
    402,
    'insufficient_funds',
    'Saldo insuficiente. Adicione créditos para continuar.',
  );

export const modelNotFound = (model: string) =>
  new GatewayError(
    404,
    'model_not_found',
    `O modelo "${model}" não existe ou não está disponível.`,
  );

export const modelNotAllowed = (model: string, reason = 'não é permitido para este projeto') =>
  new GatewayError(403, 'model_not_allowed', `O modelo "${model}" ${reason}.`);

export const rateLimited = (retryAfterMs: number) =>
  new GatewayError(
    429,
    'rate_limited',
    'Limite de requisições por minuto atingido.',
    'rate_limit_error',
    {
      'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
    },
  );

export const upstreamFailed = (message = 'Os provedores de IA não responderam. Tente novamente.') =>
  new GatewayError(502, 'upstream_error', message);
