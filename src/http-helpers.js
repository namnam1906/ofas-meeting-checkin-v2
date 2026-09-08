// ตัวช่วยที่ใช้ร่วมกันระหว่าง storage-api.js และ email-api.js

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export function unauthorized() {
  return json({ error: 'unauthorized' }, 401);
}

// การยืนยันตัวตน: ถ้าตั้งค่า environment variable STORAGE_TOKEN ไว้ใน Cloudflare
// (Settings > Variables and Secrets, ตั้งเป็น Secret) ทุก request ต้องแนบ header
// `X-Storage-Token: <ค่าเดียวกัน>` ไม่งั้นจะได้ 401 — ถ้าไม่ตั้งค่าไว้เลย endpoint จะเปิดสาธารณะ
// (ใช้ได้เฉพาะตอนพัฒนา/ทดสอบเท่านั้น ไม่ควรปล่อยแบบนี้ตอนใช้งานจริงกับข้อมูลส่วนบุคคล)
export function authOk(request, env) {
  if (!env.STORAGE_TOKEN) return true;
  return request.headers.get('X-Storage-Token') === env.STORAGE_TOKEN;
}
