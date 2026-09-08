// จุดเข้า Cloudflare Worker เดียวสำหรับทั้งเว็บนี้:
// - เสิร์ฟไฟล์ static ใน public/ ผ่าน env.ASSETS
// - route /api/storage ส่งต่อให้ storage-api.js จัดการ Cloudflare KV
// - route /api/send-email ส่งต่อให้ email-api.js ซึ่งเรียก Google Apps Script
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
