'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { createServer, extractOutputText, safePublicPath } = require('../server.js');

test('只允许解析 public 目录内路径', () => {
  assert.equal(safePublicPath('/').endsWith(path.join('public', 'index.html')), true);
  assert.equal(safePublicPath('/..%2Fserver.js'), null);
});

test('提取 Responses API 文本输出', () => {
  const value = extractOutputText({ output: [{ type: 'message', content: [{ type: 'output_text', text: '下一步：打开讲义。' }] }] });
  assert.equal(value, '下一步：打开讲义。');
});

test('静态服务器和健康检查无需第三方依赖', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (route) => new Promise((resolve, reject) => http.get(`http://127.0.0.1:${port}${route}`, (response) => { const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })); }).on('error', reject));
  try {
    const health = await request('/api/health');
    const home = await request('/');
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).ok, true);
    assert.equal(home.status, 200);
    assert.match(home.body, /缓冲区/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
