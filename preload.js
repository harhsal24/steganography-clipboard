const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onNotification: (callback) => ipcRenderer.on('notification', callback),
  onTextProcessed: (callback) => ipcRenderer.on('text-processed', callback),
  onTextExtracted: (callback) => ipcRenderer.on('text-extracted', callback),
  onSettingsLoaded: (callback) => ipcRenderer.on('settings-loaded', callback),
  onShowSettings: (callback) => ipcRenderer.on('show-settings', callback),
  
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  extractFromFile: () => ipcRenderer.invoke('extract-from-file'),
   extractFromClipboard: () => ipcRenderer.invoke('extract-from-clipboard'),

  getClipboardImage: () => ipcRenderer.invoke('get-clipboard-image'),
  extractFromBuffer: (buffer) => ipcRenderer.invoke('extract-from-buffer', buffer),
saveClipboardImage: () => ipcRenderer.invoke('save-clipboard-image'),
});