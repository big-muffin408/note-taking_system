import { app, BrowserWindow, Menu, shell, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

// 全局错误捕获，防止静默崩溃
process.on('uncaughtException', (error) => {
  console.error('[Electron] Uncaught Exception:', error);
  dialog.showErrorBox('应用错误', `未捕获的异常: ${error.message}`);
});

// 检查是否是开发模式
const isDev = !app.isPackaged;

// ── 配置管理 ──────────────────────────────────────────────
interface AppConfig {
  apiBaseUrl: string;   // 例: https://api.example.com/api
  wsBaseUrl: string;    // 例: wss://api.example.com/ws
}

const CONFIG_FILE = join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG: AppConfig = { apiBaseUrl: '', wsBaseUrl: '' };

function loadConfig(): AppConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) };
    }
  } catch (e) {
    console.error('[Electron] 读取配置失败:', e);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config: AppConfig): void {
  try {
    const dir = join(CONFIG_FILE, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Electron] 保存配置失败:', e);
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  // 图标路径：打包后 public/ 在 app 根目录，开发模式在项目根目录
  const iconPath = isDev
    ? join(__dirname, '../public/pwa-512x512.svg')
    : join(app.getAppPath(), 'public/pwa-512x512.svg');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'AI 协作笔记系统',
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // macOS 窗口标题栏样式
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  });

  // 窗口准备好后显示，避免白屏闪烁
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // 渲染进程加载失败时显示错误
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[Electron] 页面加载失败: ${errorCode} - ${errorDescription}`);
    dialog.showErrorBox('加载失败', `页面加载出错 (${errorCode}): ${errorDescription}`);
  });

  // 处理外部链接，在默认浏览器中打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 开发模式：加载 Vite 开发服务器
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    mainWindow.webContents.openDevTools();
  } else {
    // 生产模式：加载打包后的文件
    const indexPath = join(app.getAppPath(), 'dist/index.html');
    if (!existsSync(indexPath)) {
      dialog.showErrorBox('启动失败', `找不到入口文件: ${indexPath}`);
      app.quit();
      return;
    }
    mainWindow.loadFile(indexPath);
  }
}

// 创建应用菜单
function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '设置…',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow?.webContents.send('open-settings');
          },
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            // TODO: 显示关于对话框
          },
        },
      ],
    },
  ];

  // macOS 菜单调整
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about', label: `关于 ${app.getName()}` },
        { type: 'separator' },
        { role: 'hide', label: '隐藏' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '显示全部' },
        { type: 'separator' },
        { role: 'quit', label: `退出 ${app.getName()}` },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ── IPC 通信 ─────────────────────────────────────────────
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-config', () => {
  return loadConfig();
});

ipcMain.handle('set-config', (_event, config: Partial<AppConfig>) => {
  const current = loadConfig();
  const updated = { ...current, ...config };
  saveConfig(updated);
  return updated;
});

// 应用生命周期
app.whenReady().then(() => {
  createMenu();
  createWindow();

  // macOS: 点击 dock 图标时重新创建窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 关闭所有窗口时退出（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
