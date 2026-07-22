import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /authorization|cookie|password|passwd|token|secret|api[-_]?key|service[-_]?role[-_]?key/i;

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const startedAt = Date.now();

    const requestLog = {
      event: 'request',
      requestId: request.id,
      method: request.method,
      url: request.url,
      ip: request.ip,
      headers: sanitize(request.headers),
      params: sanitize(request.params),
      query: sanitize(request.query),
      body: sanitize(request.body),
    };
    this.logger.log(stringify(requestLog));

    return next.handle().pipe(
      tap({
        next: (body) => {
          this.logger.log(
            stringify({
              event: 'response',
              requestId: request.id,
              method: request.method,
              url: request.url,
              statusCode: reply.statusCode,
              durationMs: Date.now() - startedAt,
              body: sanitize(body),
            }),
          );
        },
        error: (error: unknown) => {
          const statusCode =
            error instanceof HttpException ? error.getStatus() : 500;
          const message =
            error instanceof Error ? error.message : 'Unknown request error';

          this.logger.error(
            stringify({
              event: 'error',
              requestId: request.id,
              method: request.method,
              url: request.url,
              statusCode,
              durationMs: Date.now() - startedAt,
              error: {
                name: error instanceof Error ? error.name : 'UnknownError',
                message,
                stack:
                  process.env.NODE_ENV === 'production'
                    ? undefined
                    : error instanceof Error
                      ? error.stack
                      : undefined,
              },
            }),
          );
        },
      }),
    );
  }
}

function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (depth >= 6) return '[MAX_DEPTH]';
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : sanitize(item, depth + 1),
    ]),
  );
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ event: 'log_serialization_error' });
  }
}
