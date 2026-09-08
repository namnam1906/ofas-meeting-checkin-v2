const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

export function methodNotAllowed(allowed) {
  return json({ error: 'method not allowed' }, 405, { allow: allowed.join(', ') });
}

export async function readJson(request, maxBytes = 64_000) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return { error: json({ error: 'content-type must be application/json' }, 415) };
  }
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > maxBytes) return { error: json({ error: 'request body too large' }, 413) };
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { error: json({ error: 'request body too large' }, 413) };
  }
  try {
    return { data: JSON.parse(text) };
  } catch {
    return { error: json({ error: 'invalid json body' }, 400) };
  }
}

export function requireAuth(request, env) {
  if (String(env.REQUIRE_ACCESS).toLowerCase() === 'false') return null;
  const email = request.headers.get('Cf-Access-Authenticated-User-Email');
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!email || !assertion) return json({ error: 'authentication required' }, 401);
  return null;
}

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://quickchart.io; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
