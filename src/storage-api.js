// ตัวจัดการ route /api/storage: REST endpoint บางๆ ครอบ Cloudflare KV binding
// แทนที่ window.storage ของ Claude Artifacts เดิม (ดู public/index.html: storeGet/storeSet/storeDelete/storeList)
// เรียกใช้จาก src/worker.js (Cloudflare Worker เดียวที่เสิร์ฟทั้ง static assets และ API นี้)
//
// Route: /api/storage
//   GET    /api/storage?key=<key>            -> { value: string|null }
//   GET    /api/storage?prefix=<prefix>       -> { keys: string[] }
//   PUT    /api/storage   body {key, value}   -> { ok: true }
//   DELETE /api/storage?key=<key>             -> { ok: true }
//
// ต้อง bind KV namespace ชื่อ STORAGE_KV ใน wrangler.toml (ดูไฟล์ wrangler.toml ใน repo นี้)
// การยืนยันตัวตนใช้ STORAGE_TOKEN ร่วมกับ email-api.js — ดู src/http-helpers.js

import { json, unauthorized, authOk } from './http-helpers.js';

async function handleGet(request, env) {
  if (!authOk(request, env)) return unauthorized();
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix');

  if (prefix !== null) {
    const keys = [];
    let cursor;
    do {
      const page = await env.STORAGE_KV.list({ prefix, cursor });
      keys.push(...page.keys.map((k) => k.name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return json({ keys });
  }

  const key = url.searchParams.get('key');
  if (!key) return json({ error: 'missing key or prefix' }, 400);
  const value = await env.STORAGE_KV.get(key);
  return json({ value });
}

async function handlePut(request, env) {
  if (!authOk(request, env)) return unauthorized();
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid json body' }, 400);
  }
  const { key, value } = body || {};
  if (!key) return json({ error: 'missing key' }, 400);
  await env.STORAGE_KV.put(key, value == null ? '' : String(value));
  return json({ ok: true });
}

async function handleDelete(request, env) {
  if (!authOk(request, env)) return unauthorized();
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) return json({ error: 'missing key' }, 400);
  await env.STORAGE_KV.delete(key);
  return json({ ok: true });
}

// เรียกจาก src/worker.js เมื่อ path ตรงกับ /api/storage
export async function handleStorageRequest(request, env) {
  switch (request.method.toUpperCase()) {
    case 'GET':
      return handleGet(request, env);
    case 'PUT':
      return handlePut(request, env);
    case 'DELETE':
      return handleDelete(request, env);
    default:
      return json({ error: 'method not allowed' }, 405);
  }
}
