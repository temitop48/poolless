/**
 * POOLLESS production server
 *
 * Serves the Vite-built frontend from dist/ AND handles /api/* routes.
 * Single process, single port — suitable for Hugging Face Docker Spaces.
 *
 * Port: process.env.PORT ?? 7860  (HF Docker Spaces default is 7860)
 *
 * Request routing:
 *   OPTIONS *            -> CORS preflight (JSON headers)
 *   GET /api/health      -> health check JSON (no credentials exposed)
 *   POST /api/<route>    -> Circle UCW API routes (from server/index.ts)
 *   GET /api/*           -> 405 Method Not Allowed (JSON)
 *   /api/* (unknown)     -> 404 JSON  (never falls through to SPA)
 *   GET /*               -> static file from dist/, or index.html (SPA fallback)
 */

import { handleApiRequest } from './index'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.PORT ?? 7860)
const DIST = join(import.meta.dir, '..', 'dist')

// ─── MIME type map for static assets ────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.map': 'application/json',
}

function mimeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'))
  return MIME[ext] ?? 'application/octet-stream'
}

// ─── Static file helper ──────────────────────────────────────────────────────

function serveFile(filePath: string): Response | null {
  if (!existsSync(filePath)) return null
  try {
    if (!statSync(filePath).isFile()) return null
  } catch {
    return null
  }
  const body = readFileSync(filePath)
  return new Response(body, {
    headers: {
      'Content-Type': mimeFor(filePath),
      'Cache-Control': filePath.endsWith('.html')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    },
  })
}

function serveIndex(): Response {
  const indexPath = join(DIST, 'index.html')
  if (!existsSync(indexPath)) {
    return new Response('Frontend not built — run bun run build first', { status: 503 })
  }
  return new Response(readFileSync(indexPath), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}

// ─── JSON helpers (mirrors server/index.ts for /api/health) ─────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

// ─── Server ──────────────────────────────────────────────────────────────────

const apiKey = process.env.CIRCLE_API_KEY

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const { pathname } = url

    // ── CORS preflight ───────────────────────────────────────────────────
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    // ── /api/* — always returns JSON, never falls through to SPA ────────
    if (pathname.startsWith('/api/')) {
      const subpath = pathname.slice(4) // strip /api prefix -> /create-user etc.

      // Health endpoint — no credentials required or exposed
      if (subpath === '/health' && req.method === 'GET') {
        return json({ status: 'ok', circleConfigured: !!apiKey })
      }

      // Reuse all Circle UCW route handlers from server/index.ts
      const apiReq = new Request(
        new URL(subpath, req.url).href.replace(url.origin, `http://localhost:${PORT}`),
        req,
      )
      const apiRes = await handleApiRequest(apiReq)
      if (apiRes) return apiRes

      // Unknown /api/* route
      return json({ error: 'Not found' }, 404)
    }

    // ── Static assets and SPA fallback (GET only) ────────────────────────
    if (req.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405)
    }

    // Try exact file match first
    const exactPath = join(DIST, pathname)
    const fileRes = serveFile(exactPath)
    if (fileRes) return fileRes

    // Try with .html extension (for clean URLs, unlikely in Vite SPA but safe)
    const htmlPath = join(DIST, pathname + '.html')
    const htmlRes = serveFile(htmlPath)
    if (htmlRes) return htmlRes

    // SPA fallback — all non-asset GETs serve index.html so the React router handles it
    return serveIndex()
  },
})

console.log(`[poolless-prod] Listening on http://0.0.0.0:${PORT}`)
console.log(`[poolless-prod] CIRCLE_API_KEY: ${apiKey ? 'configured' : 'NOT SET — /api routes will return 503'}`)
