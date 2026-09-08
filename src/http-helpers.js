const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

let jwksCache = null;
let jwksCachedAt = 0;

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

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getAccessKeys(teamDomain) {
  if (jwksCache && Date.now() - jwksCachedAt < 3_600_000) return jwksCache;
  const host = teamDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const response = await fetch(`https://${host}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('unable to load Access public keys');
  const data = await response.json();
  jwksCache = data.keys || data.public_certs || [];
  jwksCachedAt = Date.now();
  return jwksCache;
}

async function verifyAccessJwt(token, env) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const header = decodeJwtPart(parts[0]);
  const payload = decodeJwtPart(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) return null;

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(env.CF_ACCESS_AUD)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now || (payload.nbf && payload.nbf > now)) return null;

  const keys = await getAccessKeys(env.CF_ACCESS_TEAM_DOMAIN);
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) return null;
  const cryptoKey = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    decodeBase64Url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  return valid ? payload : null;
}

export async function requireAuth(request, env) {
  if (String(env.REQUIRE_ACCESS).toLowerCase() === 'false') return null;
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    return json({ error: 'Cloudflare Access is not configured' }, 503);
  }
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion) return json({ error: 'authentication required' }, 401);
  try {
    const payload = await verifyAccessJwt(assertion, env);
    const email = request.headers.get('Cf-Access-Authenticated-User-Email');
    if (!payload?.email || !email || payload.email.toLowerCase() !== email.toLowerCase()) {
      return json({ error: 'invalid Access identity' }, 401);
    }
    return null;
  } catch (error) {
    console.error('Access verification failed', error);
    return json({ error: 'authentication verification failed' }, 401);
  }
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
