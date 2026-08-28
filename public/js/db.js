(function (global) {
  'use strict';

  const DATABASE_NAME = 'life-workbench';
  const DATABASE_VERSION = 1;
  const STORE_NAME = 'app';
  let databasePromise;

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!global.indexedDB) return reject(new Error('当前浏览器不支持 IndexedDB'));
      const request = global.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开 IndexedDB'));
      request.onblocked = () => reject(new Error('数据库升级被另一个标签页阻止，请关闭旧标签页后重试'));
    });
    return databasePromise;
  }

  async function get(key) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async function put(key, value) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put({ key, value, updatedAt: new Date().toISOString() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function clear() {
    const database = await open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  global.WorkbenchDB = { open, get, put, clear, name: DATABASE_NAME };
})(window);
