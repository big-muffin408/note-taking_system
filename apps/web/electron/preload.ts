import { contextBridge, ipcRenderer } from 'electron';

interface AppConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
}

interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  platform: string;
  getConfig: () => Promise<AppConfig>;
  setConfig: (config: Partial<AppConfig>) => Promise<AppConfig>;
  onOpenSettings: (callback: () => void) => () => void;
}

const electronAPI: ElectronAPI = {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  platform: process.platform,
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),
  onOpenSettings: (callback) => {
    ipcRenderer.on('open-settings', callback);
    return () => ipcRenderer.removeListener('open-settings', callback);
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
