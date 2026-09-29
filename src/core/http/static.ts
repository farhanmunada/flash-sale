/**
 * Static asset serving for the frontend (public/ directory).
 * Falls back to null when the request is not a static asset.
 */

import { join } from 'node:path';

const PUBLIC_DIR = join(import.meta.dir, '..', '..', '..', 'public');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function resolvePath(pathname: string): string {
  const relative = pathname === '/' ? '/index.html' : pathname;
  return join(PUBLIC_DIR, relative);
}

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot >= 0 ? path.slice(dot) : '';
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** Returns a Response for a static file, or null if the path is not a page. */
export async function serveStatic(pathname: string): Promise<Response | null> {
  if (pathname.startsWith('/api')) return null;

  const filePath = resolvePath(pathname);
  const file = Bun.file(filePath);
  if (!(await file.exists())) return null;

  return new Response(file, { headers: { 'Content-Type': contentTypeFor(filePath) } });
}
