import { json, methodNotAllowed, readJson, requireAuth } from './http-helpers.js';

const EVENT_ID = 'default';
const MAX_ATTENDEES = 1000;

function actorOf(request) {
  return request.headers.get('Cf-Access-Authenticated-User-Email') || 'local-development';
}

async function ensureEvent(env) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO events (id, name, status) VALUES (?, ?, 'active')"
  ).bind(EVENT_ID, 'งานอีเวนต์').run();
}

function attendeeFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    title: row.title || '',
    email: row.email || '',
    phone: row.phone || '',
    position: row.position || '',
    org: row.organization || '',
    registeredAt: row.registered_at || '',
    emailStatus: row.email_status || '',
  };
}

function validateRoster(value) {
  let rows;
  try { rows = JSON.parse(String(value)); } catch { throw new Error('roster must be valid JSON'); }
  if (!Array.isArray(rows)) throw new Error('roster must be an array');
  if (rows.length > MAX_ATTENDEES) throw new Error('roster exceeds 1000 attendees');

  const seen = new Set();
  return rows.map((row, index) => {
    const id = String(row.id || '').trim().toUpperCase();
    const name = String(row.name || '').trim();
    if (!/^[A-Z0-9_-]{4,64}$/.test(id)) throw new Error(`invalid attendee id at row ${index + 1}`);
    if (!name || name.length > 200) throw new Error(`invalid attendee name at row ${index + 1}`);
    if (seen.has(id)) throw new Error(`duplicate attendee id: ${id}`);
    seen.add(id);
    return {
      id, name,
      title: String(row.title || '').slice(0, 50),
      email: String(row.email || '').trim().slice(0, 254),
      phone: String(row.phone || '').trim().slice(0, 50),
      position: String(row.position || '').slice(0, 200),
      organization: String(row.org || row.organization || '').slice(0, 300),
      registeredAt: String(row.registeredAt || '').slice(0, 40),
      emailStatus: String(row.emailStatus || '').slice(0, 30),
    };
  });
}

async function getValue(key, env) {
  await ensureEvent(env);
  if (key === 'event-name') {
    const row = await env.DB.prepare('SELECT name FROM events WHERE id = ?').bind(EVENT_ID).first();
    return row?.name || '';
  }
  if (key === 'roster') {
    const result = await env.DB.prepare(
      'SELECT * FROM attendees WHERE event_id = ? ORDER BY created_at, id'
    ).bind(EVENT_ID).all();
    return JSON.stringify((result.results || []).map(attendeeFromRow));
  }
  if (key.startsWith('checkin:')) {
    const attendeeId = key.slice(8).toUpperCase();
    const row = await env.DB.prepare(
      'SELECT checked_in_at FROM checkins WHERE event_id = ? AND attendee_id = ?'
    ).bind(EVENT_ID, attendeeId).first();
    return row?.checked_in_at || null;
  }
  const row = await env.DB.prepare('SELECT value FROM app_state WHERE key = ?').bind(key).first();
  return row?.value ?? null;
}

async function listKeys(prefix, env) {
  if (prefix === 'checkin:') {
    const result = await env.DB.prepare(
      'SELECT attendee_id FROM checkins WHERE event_id = ? ORDER BY checked_in_at'
    ).bind(EVENT_ID).all();
    return (result.results || []).map((row) => `checkin:${row.attendee_id}`);
  }
  const result = await env.DB.prepare(
    "SELECT key FROM app_state WHERE key LIKE ? ESCAPE '\\' ORDER BY key"
  ).bind(prefix.replace(/[\\%_]/g, '\\$&') + '%').all();
  return (result.results || []).map((row) => row.key);
}

async function saveRoster(value, request, env) {
  const roster = validateRoster(value);
  await ensureEvent(env);
  const current = await env.DB.prepare('SELECT id FROM attendees WHERE event_id = ?')
    .bind(EVENT_ID).all();
  const nextIds = new Set(roster.map((row) => row.id));
  const statements = [];

  for (const row of roster) {
    statements.push(env.DB.prepare(`
      INSERT INTO attendees (
        event_id,id,name,title,email,phone,position,organization,registered_at,email_status
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(event_id,id) DO UPDATE SET
        name=excluded.name,title=excluded.title,email=excluded.email,phone=excluded.phone,
        position=excluded.position,organization=excluded.organization,
        registered_at=excluded.registered_at,email_status=excluded.email_status,
        updated_at=CURRENT_TIMESTAMP
    `).bind(
      EVENT_ID,row.id,row.name,row.title,row.email || null,row.phone || null,
      row.position,row.organization,row.registeredAt || null,row.emailStatus || null
    ));
  }
  for (const row of current.results || []) {
    if (!nextIds.has(row.id)) {
      statements.push(env.DB.prepare('DELETE FROM attendees WHERE event_id = ? AND id = ?')
        .bind(EVENT_ID, row.id));
    }
  }
  statements.push(env.DB.prepare(
    'INSERT INTO audit_logs(event_id,actor,action,target_type,detail) VALUES(?,?,?,?,?)'
  ).bind(EVENT_ID, actorOf(request), 'roster.sync', 'attendees', JSON.stringify({ count: roster.length })));
  if (statements.length) await env.DB.batch(statements);
}

async function putValue(key, value, request, env) {
  await ensureEvent(env);
  if (key === 'event-name') {
    const name = String(value || '').trim().slice(0, 200) || 'งานอีเวนต์';
    await env.DB.batch([
      env.DB.prepare('UPDATE events SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(name, EVENT_ID),
      env.DB.prepare('INSERT INTO audit_logs(event_id,actor,action,target_type,target_id) VALUES(?,?,?,?,?)')
        .bind(EVENT_ID, actorOf(request), 'event.rename', 'event', EVENT_ID),
    ]);
    return;
  }
  if (key === 'roster') return saveRoster(value, request, env);
  if (key.startsWith('checkin:')) {
    const result = await createCheckin(key.slice(8), request, env);
    if (!result.created) throw Object.assign(new Error('already checked in'), { status: 409 });
    return;
  }
  await env.DB.prepare(`
    INSERT INTO app_state(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP
  `).bind(key, value == null ? '' : String(value)).run();
}

async function deleteValue(key, request, env) {
  if (key.startsWith('checkin:')) {
    const id = key.slice(8).toUpperCase();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM checkins WHERE event_id = ? AND attendee_id = ?').bind(EVENT_ID, id),
      env.DB.prepare('INSERT INTO audit_logs(event_id,actor,action,target_type,target_id) VALUES(?,?,?,?,?)')
        .bind(EVENT_ID, actorOf(request), 'checkin.undo', 'attendee', id),
    ]);
    return;
  }
  if (key === 'roster') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM attendees WHERE event_id = ?').bind(EVENT_ID),
      env.DB.prepare('INSERT INTO audit_logs(event_id,actor,action,target_type) VALUES(?,?,?,?)')
        .bind(EVENT_ID, actorOf(request), 'roster.clear', 'attendees'),
    ]);
    return;
  }
  await env.DB.prepare('DELETE FROM app_state WHERE key = ?').bind(key).run();
}

export async function createCheckin(rawId, request, env) {
  const attendeeId = String(rawId || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,64}$/.test(attendeeId)) {
    return { error: 'invalid attendee id', status: 400 };
  }
  await ensureEvent(env);
  const attendee = await env.DB.prepare(
    'SELECT name FROM attendees WHERE event_id = ? AND id = ?'
  ).bind(EVENT_ID, attendeeId).first();
  if (!attendee) return { error: 'attendee not found', status: 404 };

  const actor = actorOf(request);
  const deviceId = request.headers.get('X-Device-Id')?.slice(0, 100) || null;
  const insert = await env.DB.prepare(`
    INSERT INTO checkins(event_id,attendee_id,checked_in_by,device_id)
    VALUES(?,?,?,?) ON CONFLICT(event_id,attendee_id) DO NOTHING
  `).bind(EVENT_ID, attendeeId, actor, deviceId).run();

  const row = await env.DB.prepare(
    'SELECT checked_in_at,checked_in_by FROM checkins WHERE event_id = ? AND attendee_id = ?'
  ).bind(EVENT_ID, attendeeId).first();
  if (!insert.meta?.changes) {
    return { created: false, attendeeId, attendeeName: attendee.name, ...row };
  }
  await env.DB.prepare(
    'INSERT INTO audit_logs(event_id,actor,action,target_type,target_id) VALUES(?,?,?,?,?)'
  ).bind(EVENT_ID, actor, 'checkin.create', 'attendee', attendeeId).run();
  return { created: true, attendeeId, attendeeName: attendee.name, ...row };
}

export async function handleCheckinRequest(request, env) {
  const denied = requireAuth(request, env);
  if (denied) return denied;
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const parsed = await readJson(request, 4096);
  if (parsed.error) return parsed.error;
  const result = await createCheckin(parsed.data?.attendeeId, request, env);
  if (result.error) return json({ error: result.error }, result.status);
  return json(result, result.created ? 201 : 409);
}

export async function handleStorageRequest(request, env) {
  const denied = requireAuth(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  try {
    if (request.method === 'GET') {
      const prefix = url.searchParams.get('prefix');
      if (prefix !== null) return json({ keys: await listKeys(prefix, env) });
      const key = url.searchParams.get('key');
      if (!key) return json({ error: 'missing key or prefix' }, 400);
      return json({ value: await getValue(key, env) });
    }
    if (request.method === 'PUT') {
      const parsed = await readJson(request, 2_000_000);
      if (parsed.error) return parsed.error;
      const { key, value } = parsed.data || {};
      if (!key || typeof key !== 'string' || key.length > 200) return json({ error: 'invalid key' }, 400);
      await putValue(key, value, request, env);
      return json({ ok: true });
    }
    if (request.method === 'DELETE') {
      const key = url.searchParams.get('key');
      if (!key) return json({ error: 'missing key' }, 400);
      await deleteValue(key, request, env);
      return json({ ok: true });
    }
    return methodNotAllowed(['GET','PUT','DELETE']);
  } catch (error) {
    const status = error.status || 500;
    console.error('storage error', error);
    return json({ error: status === 500 ? 'internal server error' : error.message }, status);
  }
}
