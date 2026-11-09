import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { CommandRequestSchema, type CommandResponse, type Snapshot } from '../../shared/contracts/index.ts';
import type { GameStore } from '../game/store.ts';

const OWNER_COOKIE = 'cvj_owner';

export interface AppOptions {
  store: GameStore;
  health: () => Record<string, unknown>;
  staticDir?: string | null;
}

function readOwner(req: FastifyRequest): string | null {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === OWNER_COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

function ensureOwner(req: FastifyRequest, reply: FastifyReply): string {
  const existing = readOwner(req);
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing;
  const id = randomUUID();
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  reply.header('set-cookie', `${OWNER_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure}`);
  return id;
}

const STATUS: Record<string, number> = { stale: 409, 'not-found': 404, forbidden: 403, 'bad-request': 400 };

export async function buildApp(opts: AppOptions) {
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024, trustProxy: true });

  // Cross-site write protection: JSON-only writes, and a same-origin check when Origin is sent.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST') return;
    const type = req.headers['content-type'] ?? '';
    if (!type.startsWith('application/json')) return reply.code(415).send({ ok: false, error: 'bad-request', message: 'JSON required.' });
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (origin && host && new URL(origin).host !== host) {
      return reply.code(403).send({ ok: false, error: 'forbidden', message: 'Cross-origin request rejected.' });
    }
  });

  app.get('/api/health', async () => ({ ok: true, ...opts.health() }));

  app.post('/api/games', async (req, reply) => {
    const owner = ensureOwner(req, reply);
    return reply.code(201).send(opts.store.create(owner));
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    const result = opts.store.get(req.params.id, readOwner(req) ?? '');
    if (result === 'not-found') return reply.code(404).send({ ok: false, error: 'not-found', message: 'Session expired — start a new game.' });
    if (result === 'forbidden') return reply.code(403).send({ ok: false, error: 'forbidden', message: 'Not your game.' });
    return result;
  });

  app.post<{ Params: { id: string } }>('/api/games/:id/commands', async (req, reply) => {
    const parsed = CommandRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const res: CommandResponse = { ok: false, error: 'bad-request', message: 'Invalid command.', snapshot: null };
      return reply.code(400).send(res);
    }
    const res = opts.store.dispatch(req.params.id, readOwner(req) ?? '', parsed.data);
    return reply.code(res.ok ? 200 : (STATUS[res.error] ?? 422)).send(res);
  });

  // Server-sent events: the current snapshot first, then every change.
  app.get<{ Params: { id: string } }>('/api/games/:id/events', (req, reply) => {
    const owner = readOwner(req) ?? '';
    const first = opts.store.get(req.params.id, owner);
    if (first === 'not-found' || first === 'forbidden') {
      void reply.code(first === 'not-found' ? 404 : 403).send({ ok: false, error: first, message: 'Unavailable.' });
      return;
    }
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (snap: Snapshot) => raw.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);
    send(first);
    const unsubscribe = opts.store.subscribe(req.params.id, owner, send);
    const ping = setInterval(() => raw.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      if (typeof unsubscribe === 'function') unsubscribe();
    });
  });

  if (opts.staticDir && fs.existsSync(path.join(opts.staticDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: path.resolve(opts.staticDir), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ ok: false, error: 'not-found', message: 'Unknown endpoint.' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}
