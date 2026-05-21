export {};

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

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
