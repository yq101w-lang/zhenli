'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../public/js/domain.js');
const D = globalThis.WorkbenchDomain;

function task(id, startupDifficulty, cognitiveLoad, priority) {
  return { id, title: id, category: '考研', nextAction: `打开 ${id}`, status: 'next', priority, estimatedMinutes: 25, startupDifficulty, cognitiveLoad };
}

const log = { energy: 3, focus: 3, anxiety: 4, minimumMode: false };

test('低状态优先推荐低启动、低认知负荷任务', () => {
  const result = D.chooseNextTask([task('难题', 'high', 'high', 3), task('单词', 'low', 'low', 2)], { ...log, energy: 2, focus: 2 });
  assert.equal(result.id, '单词');
});

test('前一天指定的第一动作优先', () => {
  const result = D.chooseNextTask([task('数学', 'high', 'high', 3), task('英语', 'low', 'low', 1)], log, { tomorrowFirstAction: '打开 英语' });
  assert.equal(result.id, '英语');
});

test('相关系数和倒计时工具', () => {
  assert.ok(Math.abs(D.correlation([[1, 2], [2, 4], [3, 6], [4, 8]]) - 1) < 1e-9);
  assert.equal(D.daysUntil('2020-01-01'), 0);
});

test('HTML 输出会转义用户输入', () => {
  assert.equal(D.escapeHTML('<script>'), '&lt;script&gt;');
});
