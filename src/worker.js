import { handleStorageRequest, handleCheckinRequest } from './storage-api-v2.js';
import { handleEmailRequest } from './email-api.js';
import { json, withSecurityHeaders } from './http-helpers.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;

    if (url.pathname === '/api/health') {
      try {
        await env.DB.prepare('SELECT 1').first();
        response = json({ ok: true, database: 'connected' });
      } catch {
        response = json({ ok: false, database: 'unavailable' }, 503);
      }
    } else if (url.pathname === '/api/storage') {
      response = await handleStorageRequest(request, env);
    } else if (url.pathname === '/api/checkins') {
      response = await handleCheckinRequest(request, env);
    } else if (url.pathname === '/api/send-email') {
      response = await handleEmailRequest(request, env);
    } else {
      response = await env.ASSETS.fetch(request);
    }
    return withSecurityHeaders(response);
  },
};
