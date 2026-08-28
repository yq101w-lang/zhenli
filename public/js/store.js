(function (global) {
  'use strict';

  const D = global.WorkbenchDomain;
  const DB = global.WorkbenchDB;
  const STATE_KEY = 'state-v2';
  const LEGACY_KEY = 'life-workbench-v1';
  const listeners = new Set();
  let state;
  let saveTimer;
  let pendingSave = Promise.resolve();

  function defaultLog(date) {
    return { date: date || D.localDate(), energy: 3, focus: 3, mood: 3, anxiety: 4, studyMinutes: 0, exerciseMinutes: 0, outdoorMinutes: 0, minimumCompleted: false, minimumMode: false, startCount: 0, reviewCompleted: false, morningCompleted: false };
  }

  function seedData() {
    const now = new Date();
    const exam = new Date(now.getFullYear() + (now.getMonth() === 11 ? 1 : 0), 11, 20);
    return {
      schemaVersion: 2,
      settings: { examDate: D.localDate(exam), wakeTime: '07:30', preferredSessionLength: 25, subjects: ['数学', '英语', '政治', '专业课'], dailyMinimum: 25, weeklyTheme: '先启动，再优化', stage: '基础与强化', theme: 'system', morningEnabled: true },
      projects: [{ id: 'project-exam', name: '考研', category: '考研', goal: '稳定推进四科复习', status: 'active' }, { id: 'project-health', name: '身体底盘', category: '健康', goal: '维持睡眠与活动', status: 'active' }],
      tasks: [
        { id: 'example-math', title: '高数强化', category: '考研', projectId: 'project-exam', subject: '数学', nextAction: '打开强化讲义 P42 → 做例 3', status: 'next', priority: 3, estimatedMinutes: 25, actualMinutes: 0, startupDifficulty: 'medium', cognitiveLoad: 'high', createdAt: now.toISOString(), notes: '', grade: null, isExample: true },
        { id: 'example-english', title: '英语词汇回顾', category: '考研', projectId: 'project-exam', subject: '英语', nextAction: '复习昨天的 20 个单词', status: 'next', priority: 2, estimatedMinutes: 15, actualMinutes: 0, startupDifficulty: 'low', cognitiveLoad: 'low', createdAt: now.toISOString(), notes: '', grade: null, isExample: true },
        { id: 'example-walk', title: '今日活动', category: '健身', projectId: 'project-health', nextAction: '穿鞋，出门走 10 分钟', status: 'next', priority: 1, estimatedMinutes: 10, actualMinutes: 0, startupDifficulty: 'low', cognitiveLoad: 'low', createdAt: now.toISOString(), notes: '', grade: null, isExample: true },
      ],
      sessions: [], dailyLogs: [defaultLog()], emotionalEvents: [], reviews: [],
      knowledgeDrops: [
        { id: 'drop-bayes', content: 'P(A|B) 和 P(B|A) 有什么区别？', answer: '条件方向不同：前者是在 B 已发生时 A 的概率，后者相反；二者通常不相等。', type: 'question', sourceSubject: '数学', createdAt: now.toISOString(), reviewCount: 0, confidence: 2, nextReview: D.localDate() },
        { id: 'drop-start', content: '害怕一个任务时，整理桌子为什么突然变得很有吸引力？', answer: '整理桌子边界清楚、反馈快速，也暂时降低了面对不确定任务的不适。把原任务缩成一个物理动作通常更有帮助。', type: 'concept', createdAt: now.toISOString(), reviewCount: 0, confidence: 2, nextReview: D.localDate() },
      ],
      scripts: [
        { id: 'script-phone', ifText: '我开始刷手机', thenText: '手机移出视线 → 启动一个 10 分钟任务' },
        { id: 'script-day', ifText: '我觉得今天已经废了', thenText: '进入最低线模式' },
        { id: 'script-stuck', ifText: '一道题卡超过 10 分钟', thenText: '标记卡点 → 看提示或解析' },
        { id: 'script-perfect', ifText: '我开始重新排版笔记', thenText: '切换「丑陋完成模式」' },
        { id: 'script-missed', ifText: '我昨天没学习或没复盘', thenText: '今天直接继续，不补昨天' },
      ],
      supplements: [], workouts: [], distractions: [], activeTimer: null, uglyMode: false, toiletProgress: {}, migratedFromLocalStorage: false,
    };
  }

  function normalize(candidate) {
    const seed = seedData();
    const value = candidate && typeof candidate === 'object' ? candidate : {};
    const normalized = { ...seed, ...value, settings: { ...seed.settings, ...(value.settings || {}) } };
    ['projects', 'tasks', 'sessions', 'dailyLogs', 'emotionalEvents', 'reviews', 'knowledgeDrops', 'scripts', 'supplements', 'workouts', 'distractions'].forEach((key) => { if (!Array.isArray(normalized[key])) normalized[key] = seed[key]; });
    if (!normalized.toiletProgress || typeof normalized.toiletProgress !== 'object') normalized.toiletProgress = {};
    if (!normalized.dailyLogs.some((log) => log.date === D.localDate())) normalized.dailyLogs.push(defaultLog());
    normalized.schemaVersion = 2;
    return normalized;
  }

  function legacyData() {
    try {
      const raw = global.localStorage && global.localStorage.getItem(LEGACY_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const legacy = parsed && parsed.state ? parsed.state : parsed;
      return legacy && legacy.settings && Array.isArray(legacy.tasks) ? { ...legacy, migratedFromLocalStorage: true } : null;
    } catch { return null; }
  }

  async function init() {
    const saved = await DB.get(STATE_KEY);
    state = normalize(saved || legacyData() || seedData());
    await DB.put(STATE_KEY, state);
    applyTheme();
    return state;
  }

  function snapshot() { return state; }
  function clone(value) { return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
  function notify() { listeners.forEach((listener) => listener(state)); }
  function scheduleSave() {
    global.clearTimeout(saveTimer);
    saveTimer = global.setTimeout(() => { pendingSave = DB.put(STATE_KEY, state).catch((error) => console.error('IndexedDB 保存失败', error)); }, 80);
  }
  function commit(next) { state = normalize(next); applyTheme(); scheduleSave(); notify(); return state; }
  function mutate(mutator) { const next = clone(state); mutator(next); return commit(next); }
  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  function getToday() { return state.dailyLogs.find((log) => log.date === D.localDate()) || defaultLog(); }
  function updateToday(patch) { mutate((next) => { const index = next.dailyLogs.findIndex((log) => log.date === D.localDate()); if (index >= 0) next.dailyLogs[index] = { ...next.dailyLogs[index], ...patch }; else next.dailyLogs.push({ ...defaultLog(), ...patch }); }); }
  function updateSettings(patch) { mutate((next) => { next.settings = { ...next.settings, ...patch }; }); }
  function applyTheme() { if (!state) return; const dark = state.settings.theme === 'dark' || (state.settings.theme === 'system' && global.matchMedia && global.matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }

  function addTask(task) { mutate((next) => next.tasks.push({ id: D.uid(), createdAt: new Date().toISOString(), actualMinutes: 0, notes: '', grade: null, status: 'next', ...task })); }
  function updateTask(id, patch) { mutate((next) => { next.tasks = next.tasks.map((task) => task.id === id ? { ...task, ...patch } : task); }); }
  function removeTask(id) { mutate((next) => { next.tasks = next.tasks.filter((task) => task.id !== id); }); }
  function clearExamples() { mutate((next) => { next.tasks = next.tasks.filter((task) => !task.isExample); }); }
  function addEmotionalEvent(event) { mutate((next) => next.emotionalEvents.push({ id: D.uid(), dateTime: new Date().toISOString(), ...event })); }
  function addReview(review) { mutate((next) => { const date = D.localDate(); next.reviews = next.reviews.filter((item) => item.date !== date); next.reviews.push({ id: D.uid(), date, ...review }); const log = next.dailyLogs.find((item) => item.date === date); if (log) log.reviewCompleted = true; }); }
  function addKnowledgeDrop(drop) { mutate((next) => next.knowledgeDrops.push({ id: D.uid(), createdAt: new Date().toISOString(), reviewCount: 0, nextReview: D.localDate(), confidence: 2, ...drop })); }
  function addScript(ifText, thenText) { mutate((next) => next.scripts.push({ id: D.uid(), ifText: ifText.trim(), thenText: thenText.trim() })); }
  function updateScript(id, ifText, thenText) { mutate((next) => { next.scripts = next.scripts.map((script) => script.id === id ? { ...script, ifText: ifText.trim(), thenText: thenText.trim() } : script); }); }
  function removeScript(id) { mutate((next) => { next.scripts = next.scripts.filter((script) => script.id !== id); }); }
  function addDistraction(content) { mutate((next) => next.distractions.push({ id: D.uid(), content: content.trim(), createdAt: new Date().toISOString(), processed: false })); }
  function toggleUglyMode() { mutate((next) => { next.uglyMode = !next.uglyMode; }); }
  function setToiletProgress(index) { mutate((next) => { next.toiletProgress[D.localDate()] = index; }); }

  function startTimer(taskId, plannedMinutes, kind) { mutate((next) => { next.activeTimer = { taskId: taskId || null, plannedMinutes: Number(plannedMinutes), kind: kind || 'focus', startedAt: new Date().toISOString(), pausedSeconds: 0, interruptions: 0 }; }); }
  function toggleTimerPause() { mutate((next) => { const timer = next.activeTimer; if (!timer) return; if (!timer.pausedAt) timer.pausedAt = new Date().toISOString(); else { timer.pausedSeconds += Math.floor((Date.now() - new Date(timer.pausedAt).getTime()) / 1000); delete timer.pausedAt; } }); }
  function incrementInterruption() { mutate((next) => { if (next.activeTimer) next.activeTimer.interruptions += 1; }); }
  function cancelTimer() { mutate((next) => { next.activeTimer = null; }); }
  function finishTimer(details) {
    const timer = state.activeTimer;
    if (!timer) return null;
    const task = state.tasks.find((item) => item.id === timer.taskId);
    const duration = Math.max(1, Math.round(D.elapsedSeconds(timer) / 60));
    const session = { id: D.uid(), taskId: timer.taskId || null, projectId: task && task.projectId, subject: task && task.subject, startTime: timer.startedAt, endTime: new Date().toISOString(), duration, plannedDuration: timer.plannedMinutes, focusQuality: details.focusQuality || 3, interruptions: timer.interruptions, output: details.output || '', notes: '', kind: timer.kind };
    mutate((next) => {
      next.sessions.push(session); next.activeTimer = null;
      const currentTask = next.tasks.find((item) => item.id === timer.taskId); if (currentTask) currentTask.actualMinutes += duration;
      const log = next.dailyLogs.find((item) => item.date === D.localDate()) || defaultLog();
      if (!next.dailyLogs.includes(log)) next.dailyLogs.push(log);
      log.startCount += 1; log.firstStartTime = log.firstStartTime || timer.startedAt;
      if (task && task.category === '考研') { log.studyMinutes += duration; if (log.studyMinutes >= next.settings.dailyMinimum) log.minimumCompleted = true; }
    });
    return session;
  }

  async function replaceData(data) { state = normalize(data); applyTheme(); notify(); await DB.put(STATE_KEY, state); }
  async function resetAll() { state = seedData(); applyTheme(); notify(); await DB.put(STATE_KEY, state); }
  async function flush() { global.clearTimeout(saveTimer); await DB.put(STATE_KEY, state); await pendingSave; }

  global.WorkbenchStore = { init, snapshot, subscribe, getToday, updateToday, updateSettings, addTask, updateTask, removeTask, clearExamples, addEmotionalEvent, addReview, addKnowledgeDrop, addScript, updateScript, removeScript, addDistraction, toggleUglyMode, setToiletProgress, startTimer, toggleTimerPause, incrementInterruption, cancelTimer, finishTimer, replaceData, resetAll, flush, seedData };
})(window);
