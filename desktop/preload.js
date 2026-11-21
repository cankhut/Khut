const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('khutApp', {
  get: () => ipcRenderer.invoke('options'),
  set: (key, value) => ipcRenderer.invoke('option', key, value),
  openData: () => ipcRenderer.invoke('open-data')
});
