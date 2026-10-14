/** Error with an HTTP status and a stable code, rendered as `{ error: { message, code } }`. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthorized = (message = 'Faça login para continuar') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Acesso negado') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Não encontrado') => new HttpError(404, 'not_found', message);
export const conflict = (message: string) => new HttpError(409, 'conflict', message);
