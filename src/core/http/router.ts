/**
 * Minimal HTTP router for Bun.serve.
 * Supports path params (:id), method matching, and a middleware chain.
 */

export interface RequestContext {
  readonly request: Request;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  userId?: number;
  body?: unknown;
}

export type NextFunction = () => Promise<Response>;
export type Middleware = (ctx: RequestContext, next: NextFunction) => Promise<Response>;
export type RouteHandler = (ctx: RequestContext) => Promise<Response> | Response;

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly chain: readonly Middleware[];
  readonly handler: RouteHandler;
}

function toSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}

function matchParams(routeSegments: readonly string[], pathSegments: readonly string[]): Record<string, string> | null {
  if (routeSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegments.length; i += 1) {
    const routeSegment = routeSegments[i]!;
    const pathSegment = pathSegments[i]!;
    if (routeSegment.startsWith(':')) {
      params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
      continue;
    }
    if (routeSegment !== pathSegment) return null;
  }
  return params;
}

function compose(chain: readonly Middleware[], handler: RouteHandler): (ctx: RequestContext) => Promise<Response> {
  return async (ctx: RequestContext): Promise<Response> => {
    let index = -1;
    const dispatch = async (position: number): Promise<Response> => {
      if (position <= index) throw new Error('next() called multiple times');
      index = position;
      const middleware = chain[position];
      if (!middleware) return handler(ctx);
      return middleware(ctx, () => dispatch(position + 1));
    };
    return dispatch(0);
  };
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, chain: readonly Middleware[], handler: RouteHandler): void {
    this.routes.push({
      method: method.toUpperCase(),
      segments: toSegments(path),
      chain,
      handler,
    });
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathSegments = toSegments(url.pathname);
    const method = request.method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchParams(route.segments, pathSegments);
      if (!params) continue;
      const ctx: RequestContext = { request, params, query: url.searchParams };
      return compose(route.chain, route.handler)(ctx);
    }

    return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Rute tidak ditemukan' } }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
