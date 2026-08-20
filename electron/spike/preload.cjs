const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = [
  'listen-storage',
  'write-storage',
  'hold-lock',
  'probe-lock',
  'release-lock',
  'idb-write',
  'idb-read',
  'timer-drift',
];

contextBridge.exposeInMainWorld('spike', {
  ready: () => ipcRenderer.send('ready'),
  report: (key, value) => ipcRenderer.send(key, value),
  on: (channel, cb) => {
    if (!CHANNELS.includes(channel)) throw new Error(`bad channel ${channel}`);
    ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
});
