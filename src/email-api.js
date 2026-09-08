// ตัวจัดการ route /api/send-email: ส่งอีเมลแนบรูป QR ให้ผู้ลงทะเบียน ผ่าน Resend API
// (Cloudflare Workers เองส่งอีเมลไม่ได้ ต้องพึ่งบริการภายนอก — ใช้ Resend เพราะสมัครง่ายและมี free tier)
//
// Route: POST /api/send-email
//   body: {
//     to: string,             อีเมลผู้รับ (จำเป็น)
//     subject: string,
//     html: string,           เนื้อหาอีเมล (HTML)
//     attachment: {           แนบไฟล์ QR (ไม่บังคับ)
//       filename: string,
//       contentBase64: string,   ตัด "data:image/png;base64," ออกก่อนส่งมาแล้ว
//     }
//   }
//
// ต้องตั้งค่า Secret ชื่อ RESEND_API_KEY ไว้ที่ Cloudflare (Settings > Variables and Secrets)
// ⚠️ ข้อจำกัดตอนยังไม่ได้ verify โดเมนของหน่วยงานกับ Resend: ต้องส่งจาก
// "onboarding@resend.dev" (sender ทดสอบของ Resend) และส่งได้ถึงแค่อีเมลที่ใช้สมัคร
// บัญชี Resend เท่านั้น — ส่งหาอีเมลผู้ลงทะเบียนจริงคนอื่นจะ error จนกว่าจะ verify โดเมนตัวเอง
// (ดูวิธี verify โดเมนใน README.md)
//
// การยืนยันตัวตนของ endpoint นี้ใช้ STORAGE_TOKEN เดียวกับ /api/storage — ดู src/http-helpers.js

import { json, unauthorized, authOk } from './http-helpers.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SANDBOX_FROM = 'onboarding@resend.dev';

export async function handleEmailRequest(request, env) {
  if (request.method.toUpperCase() !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }
  if (!authOk(request, env)) return unauthorized();
  if (!env.RESEND_API_KEY) {
    return json({ error: 'ยังไม่ได้ตั้งค่า RESEND_API_KEY ที่ฝั่ง Cloudflare' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid json body' }, 400);
  }

  const { to, subject, html, attachment } = body || {};
  if (!to || !subject) return json({ error: 'missing to or subject' }, 400);

  const payload = {
    from: env.EMAIL_FROM || SANDBOX_FROM,
    to: [to],
    subject,
    html: html || '',
  };
  if (attachment && attachment.filename && attachment.contentBase64) {
    payload.attachments = [
      { filename: attachment.filename, content: attachment.contentBase64 },
    ];
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json({ error: data.message || 'ส่งอีเมลไม่สำเร็จ', detail: data }, res.status);
  }
  return json({ ok: true, id: data.id });
}
