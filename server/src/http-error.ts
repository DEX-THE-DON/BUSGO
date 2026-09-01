/** Error carrying an HTTP status, the TS equivalent of FastAPI's HTTPException. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function httpError(statusCode: number, detail: string): never {
  throw new HttpError(statusCode, detail);
}
