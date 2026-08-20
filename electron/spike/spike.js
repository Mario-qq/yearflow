const role = new URLSearchParams(location.search).get('role');
document.getElementById('role').textContent = `role=${role}  origin=${location.origin}`;
const logEl = document.getElementById('log');
const log = (m) => {
  logEl.textContent += m + '\n';
};

const LOCK = 'yearflow:spike:leader';
const IDB_NAME = 'yearflow-spike';

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbOp(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

let releaseLock = null;

window.spike.on('listen-storage', () => {
  let settled = false;
  window.addEventListener('storage', (e) => {
    if (settled) return;
    settled = true;
    log(`storage event: ${e.key} = ${e.newValue}`);
    window.spike.report('storage-event', { received: true, key: e.key, newValue: e.newValue });
  });
  setTimeout(() => {
    if (settled) return;
    settled = true;
    log('storage event: TIMEOUT');
    window.spike.report('storage-event', { received: false });
  }, 2000);
  window.spike.report('storage-armed', true);
});

window.spike.on('write-storage', ({ key, value }) => {
  localStorage.setItem(key, value);
  log(`wrote localStorage ${key}=${value}`);
});

window.spike.on('hold-lock', () => {
  navigator.locks.request(LOCK, { mode: 'exclusive' }, () => {
    log('holding exclusive lock');
    window.spike.report('lock-held', true);
    return new Promise((resolve) => {
      releaseLock = resolve;
    });
  });
});

window.spike.on('release-lock', () => releaseLock?.());

window.spike.on('probe-lock', async () => {
  const granted = await navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => lock !== null);
  log(`probe lock: granted=${granted} (expect false)`);
  window.spike.report('lock-probe', { blocked: granted === false });
});

window.spike.on('idb-write', async () => {
  const db = await openIdb();
  const value = `written-by-a-${Date.now()}`;
  await idbOp(db, 'readwrite', (s) => s.put(value, 'probe'));
  log(`idb wrote ${value}`);
  window.spike.report('idb-written', value);
});

window.spike.on('idb-read', async () => {
  const db = await openIdb();
  const value = await idbOp(db, 'readonly', (s) => s.get('probe'));
  log(`idb read ${value}`);
  window.spike.report('idb-read', { value: value ?? null });
});

window.spike.on('timer-drift', ({ ms }) => {
  const t0 = Date.now();
  // 刻意复刻 kernel.ts:123 scheduleAlarm 的 MessageChannel 中转形态
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    const drift = Date.now() - t0 - ms;
    log(`timer drift over ${ms}ms while minimized: ${drift}ms`);
    window.spike.report('timer-drift', { driftMs: drift });
  };
  setTimeout(() => ch.port2.postMessage(0), ms);
});

log(`localStorage=${typeof localStorage} locks=${typeof navigator.locks} idb=${typeof indexedDB}`);
log(`isSecureContext=${window.isSecureContext}`);
window.spike.ready();
