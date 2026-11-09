// Minimal stand-in for OpenRouter's Decisions API, used only by end-to-end tests.
// Chooses the criterion the engine marked best (or the first). Controllable via POST /control.
import http from 'node:http';

const port = Number(process.env.FAKE_JEV_PORT ?? 4100);
let calls = 0;
let delayMs = 0;
let failNext = 0;

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

http
  .createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    if (req.method === 'GET' && req.url === '/calls') return send(res, 200, { calls });
    if (req.method === 'POST' && req.url === '/control') {
      const c = JSON.parse(raw || '{}');
      if (c.delayMs !== undefined) delayMs = c.delayMs;
      if (c.failNext !== undefined) failNext = c.failNext;
      if (c.reset) calls = 0;
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && req.url === '/api/alpha/decisions') {
      calls++;
      if (req.headers.authorization !== 'Bearer test-key') return send(res, 401, { error: { message: 'bad key' } });
      if (failNext > 0) {
        failNext--;
        return send(res, 503, { error: { message: 'upstream unavailable' } });
      }
      const body = JSON.parse(raw);
      const criteria = body.questions.move.criteria;
      const ids = Object.keys(criteria);
      const best = ids.find((id) => /^(best move|wins by force)/.test(criteria[id].engine ?? '')) ?? ids[0];
      await new Promise((r) => setTimeout(r, delayMs));
      if (res.destroyed) return;
      return send(res, 200, {
        model: 'typesafe/jev-fake',
        answers: { move: { type: 'choice', choice: best, probabilities: { [best]: 0.97 }, confidence: 0.96 } },
      });
    }
    send(res, 404, { error: 'not found' });
  })
  .listen(port, () => console.log(`fake OpenRouter on :${port}`));
