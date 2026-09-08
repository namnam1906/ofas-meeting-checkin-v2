// ตัวจัดการ route /api/send-email: ส่งอีเมลแนบรูป QR ผ่าน Google Apps Script
// โดย Apps Script จะส่งจากบัญชี Google Workspace ของเจ้าของ deployment
//
// Route: POST /api/send-email
//   body: {
//     to: string,
//     subject: string,
//     html: string,
//     attachment: {
//       filename: string,
//       contentBase64: string,
//     }
//   }
//
// ต้องตั้ง Cloudflare Secret ชื่อ GOOGLE_APPS_SCRIPT_TOKEN ให้ตรงกับ Script Property
// ชื่อ API_TOKEN ใน Google Apps Script ห้ามฝังค่านี้ไว้ใน repo หรือในโค้ดฝั่ง browser

import { json, unauthorized, authOk } from './http-helpers.js';

const GOOGLE_APPS_SCRIPT_ENDPOINT =
  'https://script.google.com/macros/s/AKfycbzMxBeamBvTohljuQIrR1m5aoho2j9IgeaCeWrOGm0ooGVE0vwn38Y2enFwz0oTU775/exec';

export async function handleEmailRequest(request, env) {
  if (request.method.toUpperCase() !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }
  if (!authOk(request, env)) return unauthorized();
  if (!env.GOOGLE_APPS_SCRIPT_TOKEN) {
    return json(
      { error: 'ยังไม่ได้ตั้งค่า GOOGLE_APPS_SCRIPT_TOKEN ที่ฝั่ง Cloudflare' },
      500,
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid json body' }, 400);
  }

  const { to, subject, html, attachment } = body || {};
  if (!to || !subject) {
    return json({ error: 'missing to or subject' }, 400);
  }

  const payload = {
    token: env.GOOGLE_APPS_SCRIPT_TOKEN,
    to,
    subject,
    html: html || '',
    text: 'กรุณาเปิดอีเมลนี้ด้วยโปรแกรมที่รองรับ HTML',
    attachment,
  };

  let response;
  try {
    response = await fetch(GOOGLE_APPS_SCRIPT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    });
  } catch (error) {
    return json(
      { error: 'เชื่อมต่อ Google Apps Script ไม่สำเร็จ', detail: String(error) },
      502,
    );
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return json(
      {
        error: 'Google Apps Script ตอบกลับไม่สำเร็จ',
        detail: data || { status: response.status },
      },
      502,
    );
  }
  if (!data || !data.ok) {
    return json(
      {
        error: (data && data.error) || 'ส่งอีเมลไม่สำเร็จ',
        detail: data,
      },
      502,
    );
  }

  return json({
    ok: true,
    remainingQuota: data.remainingQuota,
  });
}
