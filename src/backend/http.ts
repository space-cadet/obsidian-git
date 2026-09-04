import { GitCredential, HttpRequest, HttpResponse, HttpTransport, ProgressSink } from './types';

function statusMessage(status: number): string {
  const messages: Record<number, string> = {
    200: 'OK',
    201: 'Created',
    202: 'Accepted',
    204: 'No Content',
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
  };
  return messages[status] || 'Unknown';
}

async function collectBody(body: AsyncIterable<Uint8Array> | Uint8Array | ArrayBuffer | string | undefined): Promise<Uint8Array | undefined> {
  if (body === undefined) return undefined;
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);

  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function asBodyIterable(body: Uint8Array): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      yield body;
    },
  };
}

export class GitProtocolHttp {
  private progress?: ProgressSink;

  constructor(
    private readonly transport: HttpTransport,
    private readonly credentials?: () => Promise<GitCredential | null>,
    progress?: ProgressSink,
  ) {
    this.progress = progress;
  }

  setProgressSink(progress?: ProgressSink): void {
    this.progress = progress;
  }

  async request(config: any): Promise<any> {
    const credential = this.credentials ? await this.credentials() : null;
    const body = await collectBody(config.body);
    const headers: Record<string, string> = { ...(config.headers || {}) };

    if (credential?.username && credential.password) {
      const encoded = this.encodeBasic(`${credential.username}:${credential.password}`);
      headers.Authorization = `Basic ${encoded}`;
    }

    const response = await this.transport.request({
      url: config.url,
      method: config.method || 'GET',
      headers,
      body,
    });
    this.progress?.progress?.(response.body.byteLength, response.body.byteLength);

    return {
      url: config.url,
      method: config.method || 'GET',
      statusCode: response.status,
      statusMessage: statusMessage(response.status),
      headers: response.headers,
      body: asBodyIterable(response.body),
    };
  }

  private encodeBasic(value: string): string {
    if (typeof btoa === 'function') return btoa(value);
    const nodeBuffer = (globalThis as any).Buffer;
    if (nodeBuffer) return nodeBuffer.from(value, 'utf8').toString('base64');
    throw new Error('No base64 encoder is available for Git authentication');
  }
}

export function jsonRequest(transport: HttpTransport, request: HttpRequest): Promise<HttpResponse> {
  return transport.request({
    ...request,
    headers: {
      Accept: 'application/json',
      ...(request.body ? { 'Content-Type': 'application/json' } : {}),
      ...(request.headers || {}),
    },
  });
}
