import { json, methodNotAllowed, readJson, requireAuth } from './http-helpers.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SANDBOX_FROM = 'onboarding@resend.dev';
const EVENT_ID = 'default';
const MAX_ATTACHMENT_BYTES = 1_000_000;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
}

export async function handleEmailRequest(request, env) {
  const denied = await requireAuth(request, env);
  if (denied) return denied;
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY is not configured' }, 503);

  const parsed = await readJson(request, 1_500_000);
  if (parsed.error) return parsed.error;
  const { attendeeId, testTo, attachment } = parsed.data || {};
  const id = String(attendeeId || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{4,64}$/.test(id)) return json({ error: 'invalid attendee id' }, 400);

  const attendee = await env.DB.prepare(`
    SELECT a.name,a.email,e.name AS event_name
    FROM attendees a JOIN events e ON e.id=a.event_id
    WHERE a.event_id=? AND a.id=?
  `).bind(EVENT_ID, id).first();
  if (!attendee) return json({ error: 'attendee not found' }, 404);

  const actor = request.headers.get('Cf-Access-Authenticated-User-Email') || '';
  const recipient = testTo ? String(testTo).trim().toLowerCase() : attendee.email;
  if (testTo && recipient !== actor.toLowerCase() && String(env.REQUIRE_ACCESS).toLowerCase() !== 'false') {
    return json({ error: 'test email must match the signed-in user' }, 403);
  }
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return json({ error: 'attendee has no valid email' }, 400);
  }

  const isTest = Boolean(testTo);
  const subject = `${isTest ? '[ทดสอบ] ' : ''}บัตรเข้างาน: ${attendee.event_name}`;
  const html = `
    ${isTest ? `<p style="color:#B4791C">[โหมดทดสอบ] ฉบับจริงจะส่งถึง ${escapeHtml(attendee.name)} &lt;${escapeHtml(attendee.email)}&gt;</p>` : ''}
    <p>สวัสดีคุณ ${escapeHtml(attendee.name)},</p>
    <p>นี่คือรหัสสำหรับเช็คอินเข้างาน “${escapeHtml(attendee.event_name)}”</p>
    <p>รหัสของคุณคือ: <strong>${escapeHtml(id)}</strong></p>
    <p>โปรดแสดง QR Code ที่แนบมาที่หน้างาน</p>
  `;

  const payload = { from: env.EMAIL_FROM || SANDBOX_FROM, to: [recipient], subject, html };
  if (attachment?.contentBase64) {
    const content = String(attachment.contentBase64);
    if (!/^[A-Za-z0-9+/=]+$/.test(content) || Math.ceil(content.length * 3 / 4) > MAX_ATTACHMENT_BYTES) {
      return json({ error: 'invalid or oversized attachment' }, 413);
    }
    payload.attachments = [{ filename: `QR_${id}.png`, content }];
  }

  const resend = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await resend.json().catch(() => ({}));
  const status = resend.ok ? 'sent' : 'failed';

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO email_deliveries(event_id,attendee_id,provider_id,status,error_message)
      VALUES(?,?,?,?,?)
    `).bind(EVENT_ID,id,data.id || null,status,resend.ok ? null : String(data.message || 'provider error').slice(0,500)),
    ...(resend.ok && !isTest ? [env.DB.prepare(
      "UPDATE attendees SET email_status='sent',updated_at=CURRENT_TIMESTAMP WHERE event_id=? AND id=?"
    ).bind(EVENT_ID,id)] : []),
  ]);

  if (!resend.ok) {
    console.error('resend error', { status: resend.status, message: data.message });
    return json({ error: 'ส่งอีเมลไม่สำเร็จ' }, 502);
  }
  return json({ ok: true, id: data.id });
}
