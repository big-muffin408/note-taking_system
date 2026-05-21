/**
 * Electron 桌面端配置模块
 * 启动时从主进程加载配置，提供同步访问
 */

interface AppConfig {
  apiBaseUrl: string;
  wsBaseUrl: string;
}

let cached: AppConfig | null = null;
let loading: Promise<AppConfig> | null = null;

async function loadFromElectron(): Promise<AppConfig> {
  if (!window.electronAPI) return { apiBaseUrl: '', wsBaseUrl: '' };
  return window.electronAPI.getConfig();
}

/** 初始化配置（应用启动时调用一次） */
export async function initElectronConfig(): Promise<void> {
  if (cached) return;
  if (!loading) loading = loadFromElectron();
  cached = await loading;
}

/** 获取 API 基础地址（同步，需先调用 initElectronConfig） */
export function getApiBaseUrl(): string {
  return cached?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '';
}

/** 获取 WebSocket 基础地址（同步，需先调用 initElectronConfig） */
export function getWsBaseUrl(): string {
  return cached?.wsBaseUrl ?? import.meta.env.VITE_WS_BASE_URL ?? '/ws';
}

/** 更新配置 */
export async function updateElectronConfig(config: Partial<AppConfig>): Promise<void> {
  if (!window.electronAPI) return;
  cached = await window.electronAPI.setConfig(config);
}

/** 是否运行在 Electron 环境 */
export function isElectron(): boolean {
  return !!window.electronAPI;
}

/** 后端地址是否已配置 */
export function isBackendConfigured(): boolean {
  return !!cached?.apiBaseUrl;
}
