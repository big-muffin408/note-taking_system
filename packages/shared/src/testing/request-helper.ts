import { Readable } from 'node:stream';
import type { Express, RequestHandler } from 'express';

type TestResponse = {
  status: number;
  body: any;
  headers: Record<string, string>;
  text: string;
};

class TestRequest {
  private headers: Record<string, string> = {};
  private payload: unknown;

  constructor(
    private readonly app: Express & { handle: RequestHandler },
    private readonly method: string,
    private readonly url: string,
  ) {}

  set(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  send(payload: unknown) {
    this.payload = payload;
    return this;
  }

  async expect(statusOrHeader: number | string, expected?: RegExp | string) {
    const response = await this.execute();

    if (typeof statusOrHeader === 'number') {
      expect(response.status).toBe(statusOrHeader);
      return response;
    }

    const header = response.headers[statusOrHeader.toLowerCase()];
    if (expected instanceof RegExp) {
      expect(header).toMatch(expected);
    } else {
      expect(header).toBe(expected);
    }
    return response;
  }

  private execute(): Promise<TestResponse> {
    const body = this.payload === undefined ? undefined : JSON.stringify(this.payload);
    const req = new Readable({
      read() {
        this.push(body ?? null);
        if (body) {
          this.push(null);
        }
      },
    }) as any;
    const headers = { ...this.headers };

    if (body) {
      headers['content-type'] ??= 'application/json';
      headers['content-length'] = Buffer.byteLength(body).toString();
    }

    req.method = this.method;
    req.url = this.url;
    req.headers = headers;
    req.connection = {};

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const responseHeaders: Record<string, string> = {};
      const res = {
        statusCode: 200,
        setHeader(name: string, value: string | number | readonly string[]) {
          responseHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        },
        getHeader(name: string) {
          return responseHeaders[name.toLowerCase()];
        },
        removeHeader(name: string) {
          delete responseHeaders[name.toLowerCase()];
        },
        end(chunk?: string | Buffer) {
          if (chunk) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const text = Buffer.concat(chunks).toString();
          let parsedBody: any = text;
          try {
            parsedBody = text ? JSON.parse(text) : {};
          } catch {
            parsedBody = text;
          }
          resolve({
            status: this.statusCode,
            body: parsedBody,
            headers: responseHeaders,
            text,
          });
        },
      } as any;

      this.app.handle(req, res, reject);
    });
  }
}

export function request(app: Express) {
  const testApp = app as Express & { handle: RequestHandler };
  return {
    get: (url: string) => new TestRequest(testApp, 'GET', url),
    post: (url: string) => new TestRequest(testApp, 'POST', url),
    put: (url: string) => new TestRequest(testApp, 'PUT', url),
    delete: (url: string) => new TestRequest(testApp, 'DELETE', url),
  };
}
