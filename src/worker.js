// จุดเข้า Cloudflare Worker เดียวสำหรับทั้งเว็บนี้:
// - เสิร์ฟไฟล์ static ใน public/ (index.html และไฟล์อื่นๆ) ผ่าน env.ASSETS
// - ยกเว้น path /api/storage ที่ส่งต่อให้ src/storage-api.js จัดการ (ครอบ Cloudflare KV)
// - และ path /api/send-email ที่ส่งต่อให้ src/email-api.js จัดการ (ส่งอีเมลผ่าน Resend)
//
// บัญชี Cloudflare นี้ deploy โปรเจกต์ผ่าน `wrangler deploy` (รูปแบบ Workers + assets ใหม่)
// ไม่ใช่ Pages Functions รุ่นเก่า จึงรวม static hosting กับ API ไว้ในไฟล์เดียวนี้แทน
import { handleStorageRequest } from './storage-api.js';
import { handleEmailRequest } from './email-api.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/storage') {
      return handleStorageRequest(request, env);
    }
    if (url.pathname === '/api/send-email') {
      return handleEmailRequest(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
