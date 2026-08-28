'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY_BYTES = 32 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const rateBuckets = new Map();

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function securityHeaders(contentType) {
  return { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { ...securityHeaders('application/json; charset=utf-8'), 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function safePublicPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(PUBLIC_DIR, relative);
  return resolved === PUBLIC_DIR || resolved.startsWith(`${PUBLIC_DIR}${path.sep}`) ? resolved : null;
}

function isRateLimited(address) {
  const now = Date.now();
  const recent = (rateBuckets.get(address) || []).filter((time) => now - time < RATE_WINDOW_MS);
  recent.push(now);
  rateBuckets.set(address, recent);
  return recent.length > RATE_LIMIT;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('请求内容过大'), { status: 413 })); request.destroy(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('JSON 格式无效'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  return (response.output || []).flatMap((item) => item.type === 'message' ? (item.content || []) : []).filter((item) => item.type === 'output_text' && typeof item.text === 'string').map((item) => item.text).join('\n').trim();
}

function callOpenAI(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Promise.reject(Object.assign(new Error('AI 代理尚未配置 OPENAI_API_KEY'), { status: 503 }));
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const upstream = https.request({ hostname: 'api.openai.com', port: 443, path: '/v1/responses', method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 45_000 }, (upstreamResponse) => {
      const chunks = [];
      upstreamResponse.on('data', (chunk) => chunks.push(chunk));
      upstreamResponse.on('end', () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return reject(Object.assign(new Error('AI 服务返回了无法解析的响应'), { status: 502 })); }
        if (upstreamResponse.statusCode < 200 || upstreamResponse.statusCode >= 300) {
          const message = data && data.error && data.error.message ? data.error.message : 'AI 服务请求失败';
          return reject(Object.assign(new Error(message), { status: upstreamResponse.statusCode || 502 }));
        }
        resolve(data);
      });
    });
    upstream.on('timeout', () => upstream.destroy(new Error('AI 服务响应超时')));
    upstream.on('error', (error) => reject(Object.assign(error, { status: 502 })));
    upstream.end(body);
  });
}

function agentInstructions(mode) {
  const shared = ['你是考研 / ADHD 友好型个人工作台中的行动拆解助手。', '语气安静、简洁、具体，不训人，不制造羞耻，不输出效率总分。', '只帮助降低执行负担，不诊断 ADHD、焦虑、BDD 或疾病，不提供药物、补剂剂量或医疗判断。', '优先给出可在 60 秒内开始的物理动作，状态差时主动降低难度。', '不要要求用户补偿昨天，不使用连续打卡激励。'];
  const modes = { next_action: '根据任务与当前状态，只返回：建议下一动作、建议时长、为什么此刻适合。总共不超过 120 个汉字。', review_insight: '根据匿名化的近期行为摘要，给出一条非因果的行为观察和一个明天可尝试的小实验。不超过 160 个汉字。', chat: '回答用户关于开始、拆解或重新回来的问题。最多三个短段落。' };
  return [...shared, modes[mode] || modes.chat].join('\n');
}

async function handleAgent(request, response) {
  if (request.method !== 'POST') return sendJson(response, 405, { error: '仅支持 POST' });
  if (isRateLimited(request.socket.remoteAddress || 'local')) return sendJson(response, 429, { error: '请求有点密集，请稍后再试。' });
  try {
    const body = await readJsonBody(request);
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const mode = ['next_action', 'review_insight', 'chat'].includes(body.mode) ? body.mode : 'chat';
    if (!prompt || prompt.length > 6000) return sendJson(response, 400, { error: '请输入 1–6000 个字符。' });
    const apiResponse = await callOpenAI({ model: process.env.OPENAI_MODEL || 'gpt-5.4', instructions: agentInstructions(mode), input: prompt, store: false, max_output_tokens: 600 });
    return sendJson(response, 200, { text: extractOutputText(apiResponse), model: apiResponse.model, responseId: apiResponse.id });
  } catch (error) {
    const status = Number(error.status) || 500;
    return sendJson(response, status >= 400 && status < 600 ? status : 500, { error: error.message || 'AI 代理发生错误' });
  }
}

function serveStatic(request, response) {
  const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
  const filePath = safePublicPath(pathname);
  if (!filePath) return sendJson(response, 400, { error: '无效路径' });
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) return sendJson(response, 404, { error: '未找到资源' });
    const extension = path.extname(filePath).toLowerCase();
    const cacheControl = ['.html', '.js', '.css'].includes(extension) ? 'no-cache' : 'public, max-age=86400';
    response.writeHead(200, { ...securityHeaders(MIME[extension] || 'application/octet-stream'), 'Cache-Control': cacheControl });
    if (request.method === 'HEAD') return response.end();
    fs.createReadStream(filePath).pipe(response);
  });
}

function createServer() {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    if (pathname === '/api/health') return sendJson(response, 200, { ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || 'gpt-5.4' });
    if (pathname === '/api/agent') return void handleAgent(request, response);
    if (!['GET', 'HEAD'].includes(request.method)) return sendJson(response, 405, { error: '不支持此请求方法' });
    return serveStatic(request, response);
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`缓冲区已运行：http://${HOST}:${PORT}`);
    console.log(`AI 代理：${process.env.OPENAI_API_KEY ? '已配置' : '未配置（设置 OPENAI_API_KEY 后启用）'}`);
  });
}

module.exports = { createServer, extractOutputText, safePublicPath };
