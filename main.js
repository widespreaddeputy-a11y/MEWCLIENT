const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawnSync } = require('child_process');

let Client, Authenticator;
try {
  const mclc = require('minecraft-launcher-core');
  Client = mclc.Client;
  Authenticator = mclc.Authenticator;
} catch (e) { console.error('MCLC не загружен:', e); }

let mainWindow = null;
let launcherClient = null;
let isLaunching = false;

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'mewclient-config.json');

const DEFAULT_CONFIG = {
  nickname: 'Steve',
  version: '1.20.1',
  ram: 4096,
  javaPath: '',
  gameDir: '',
  fullscreen: false,
  width: 1280,
  height: 720
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH())) {
      const raw = fs.readFileSync(CONFIG_PATH(), 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) { console.error('Ошибка чтения конфига:', e); }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2), 'utf-8');
    return true;
  } catch (e) { console.error('Ошибка записи конфига:', e); return false; }
}

function getGameDir(cfg) {
  if (cfg && cfg.gameDir && cfg.gameDir.trim()) return cfg.gameDir.trim();
  return path.join(app.getPath('userData'), 'minecraft');
}

function createWindow() {
  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1180, height: 740, minWidth: 940, minHeight: 620,
    frame: false, backgroundColor: '#161718', show: false, autoHideMenuBar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false));
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return;
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow && mainWindow.close());

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, cfg) => saveConfig({ ...loadConfig(), ...cfg }));

ipcMain.handle('shell:openFolder', async (_e, p) => {
  const target = p && p.trim() ? p : getGameDir(loadConfig());
  try { fs.mkdirSync(target, { recursive: true }); await shell.openPath(target); return true; }
  catch (e) { return false; }
});

ipcMain.handle('shell:pickFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'], title: 'Выберите папку с игрой'
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle('shell:pickJava', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'], title: 'Выберите java.exe',
    filters: process.platform === 'win32'
      ? [{ name: 'Java', extensions: ['exe'] }]
      : [{ name: 'All', extensions: ['*'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// Только релизы от 1.8.9 и новее
ipcMain.handle('versions:get', async () => {
  try {
    const manifest = await fetchJSON('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
    const latest = manifest.latest;

    // манифест отсортирован от новых к старым
    const releases = manifest.versions.filter((v) => v.type === 'release');

    // Находим индекс 1.8.9 (или, если его нет, берём весь список релизов)
    const cutoff = releases.findIndex((v) => v.id === '1.8.9');
    const end = cutoff >= 0 ? cutoff + 1 : releases.length;

    const list = releases.slice(0, end).map((v) => ({
      id: v.id,
      type: v.type,
      releaseTime: v.releaseTime
    }));

    return { ok: true, latest, versions: list };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

ipcMain.handle('game:launch', async (_e, cfg) => {
  if (!Client) {
    send('launch:log', { type: 'error', message: 'Модуль minecraft-launcher-core не найден' });
    return { ok: false, error: 'MCLC not found' };
  }
  if (isLaunching) return { ok: false, error: 'Игра уже запускается' };

  const config = { ...loadConfig(), ...cfg };
  saveConfig(config);

  if (!config.nickname || config.nickname.length < 3) {
    return { ok: false, error: 'Ник должен быть не короче 3 символов' };
  }

  const root = getGameDir(config);
  fs.mkdirSync(root, { recursive: true });
  isLaunching = true;

  try {
    launcherClient = new Client();
    launcherClient.on('debug', (m) => send('launch:log', { type: 'debug', message: String(m) }));
    launcherClient.on('data', (m) => send('launch:log', { type: 'data', message: String(m) }));
    launcherClient.on('error', (e) => send('launch:log', { type: 'error', message: String(e) }));
    launcherClient.on('progress', (p) => {
      send('launch:progress', { type: p.type || 'download', task: p.task || 0, total: p.total || 0 });
    });
    launcherClient.on('download-status', (d) => {
      send('launch:progress', { type: d.type || 'download', task: d.current || 0, total: d.total || 0, name: d.name || '' });
    });
    launcherClient.on('close', (code) => {
      isLaunching = false; launcherClient = null;
      send('launch:close', { code });
    });

    const opts = {
      authorization: Authenticator.getAuth(config.nickname),
      root: root,
      version: { number: config.version, type: 'release' },
      memory: { max: `${Math.max(1024, Number(config.ram) || 4096)}M`, min: '1024M' },
      window: {
        width: Number(config.width) || 1280,
        height: Number(config.height) || 720,
        fullscreen: !!config.fullscreen
      },
      overrides: { maxSockets: 8, detached: false }
    };
    if (config.javaPath && config.javaPath.trim()) opts.javaPath = config.javaPath.trim();

    send('launch:log', { type: 'info', message: `Запуск Minecraft ${config.version} для ${config.nickname}...` });
    send('launch:log', { type: 'info', message: `Папка игры: ${root}` });
    launcherClient.launch(opts);
    return { ok: true };
  } catch (e) {
    isLaunching = false; launcherClient = null;
    send('launch:log', { type: 'error', message: String(e.message || e) });
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('java:detect', async () => {
  try {
    const r = spawnSync('java', ['-version'], { encoding: 'utf-8' });
    if (r.status === 0 || r.stderr) return { ok: true, path: 'java' };
  } catch (_) {}
  if (process.platform === 'win32') {
    const bases = [
      'C:\\Program Files\\Java',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Microsoft\\jdk',
      'C:\\Program Files (x86)\\Java'
    ];
    for (const base of bases) {
      try {
        if (!fs.existsSync(base)) continue;
        for (const d of fs.readdirSync(base)) {
          const exe = path.join(base, d, 'bin', 'java.exe');
          if (fs.existsSync(exe)) return { ok: true, path: exe };
        }
      } catch (_) {}
    }
  }
  return { ok: false, path: '' };
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  userData: app.getPath('userData')
}));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});