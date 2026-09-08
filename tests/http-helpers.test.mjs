import test from 'node:test';
import assert from 'node:assert/strict';
import { json, readJson, requireAuth, withSecurityHeaders } from '../src/http-helpers.js';

test('API responses are JSON and never cached', async () => {
  const response = json({ ok: true }, 201);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: true });
});

test('Access configuration is required by default', async () => {
  const request = new Request('https://example.test/api/storage');
  assert.equal((await requireAuth(request, {})).status, 503);
});

test('local development bypass must be explicit', async () => {
  const request = new Request('http://localhost/api/storage');
  assert.equal(await requireAuth(request, { REQUIRE_ACCESS: 'false' }), null);
});

test('JSON parser rejects an incorrect content type', async () => {
  const request = new Request('https://example.test/api', { method: 'POST', body: '{}' });
  const result = await readJson(request);
  assert.equal(result.error.status, 415);
});

test('security headers prevent framing and MIME sniffing', () => {
  const response = withSecurityHeaders(new Response('ok'));
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
