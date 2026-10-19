const { app, BrowserWindow, ipcMain, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { spawn } = require('child_process');
const http = require('http');
const { autoUpdater } = require('electron-updater');

let DiscordRPC = null;
try { DiscordRPC = require('discord-rpc'); } catch (e) { console.log('discord-rpc not installed'); }

let Client, Authenticator;
try {
  const mclc = require('minecraft-launcher-core');
  Client = mclc.Client;
  Authenticator = mclc.Authenticator;
} catch (e) { console.error('MCLC:', e); }

let mainWindow = null;
let launcherClient = null;
let isLaunching = false;
let rpcClient = null;

const SERVER_URL = 'http://localhost:3000'; // Твой сервер для онлайна
const ELY_CLIENT_ID = 'mewclient-launcher1'; 
const ELY_CLIENT_SECRET = 'tZ0fkybxheS_ylbIetkvIKCGe3ICzHHRP_tYJSqAADXWHVgbV4mM1on1AOwCxRFz'; 
const ELY_REDIRECT_URI = 'http://localhost:3000/auth/ely/callback';
const RPC_CLIENT_ID = '123456789012345678';
const CLIENT_ID = crypto.createHash('md5').update(os.hostname() + os.userInfo().username).digest('hex');

const CONFIG_PATH = () => path.join(app.getPath('userData'), 'mewclient-config.json');

// Функция получения папки конкретного профиля
function getProfileDir(cfg) {
  const base = cfg.gameDir && cfg.gameDir.trim() ? cfg.gameDir.trim() : path.join(app.getPath('userData'), 'minecraft');
  const profile = cfg.activeProfile || 'Default';
  return path.join(base, 'instances', profile);
}

function getModsDir() {
  const cfg = loadConfig();
  return path.join(getProfileDir(cfg), 'mods');
}

function getBundledJavaDir() { return path.join(app.getPath('userData'), 'jre'); }
function getBundledJavaPath() {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  return path.join(getBundledJavaDir(), 'bin', exe);
}

function getRecommendedRAM() {
  const totalGB = Math.floor(os.totalmem() / (1024 ** 3));
  if (totalGB <= 4) return 2048;
  if (totalGB <= 8) return 4096;
  if (totalGB <= 16) return 6144;
  return 8192;
}

const DEFAULT_CONFIG = {
  nickname: 'Steve', version: '1.21.4', loader: 'fabric',
  ram: 6144, javaPath: '', gameDir: '', fullscreen: false,
  width: 1280, height: 720, theme: 'dark',
  activeProfile: 'Default', profiles: ['Default'],
  servers: ['mc.hypixel.net'],
  bgImage: '',
  accessToken: null, refreshToken: null, uuid: null, authType: 'offline'
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH())) {
      const loaded = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH(), 'utf-8')) };
      if (!loaded.ram || loaded.ram < 1024) loaded.ram = getRecommendedRAM();
      return loaded;
    }
  } catch (e) {}
  return { ...DEFAULT_CONFIG, ram: getRecommendedRAM() };
}

function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH(), JSON.stringify(cfg, null, 2), 'utf-8'); return true; }
  catch (e) { return false; }
}

function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: options.method || 'GET', url, redirect: 'follow' });
    if (options.headers) for (const [k, v] of Object.entries(options.headers)) req.setHeader(k, v);
    req.on('response', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function downloadFile(url, dest, retries = 2) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const makeRequest = () => {
      const req = net.request({ method: 'GET', url, redirect: 'follow' });
      req.setHeader('User-Agent', 'Mozilla/5.0');
      req.on('response', (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return downloadFile(res.headers.location, dest, retries).then(resolve).catch(reject);
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        const file = fs.createWriteStream(dest);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(dest); });
        file.on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
      });
      req.on('error', (e) => { if (attempts < retries) { attempts++; setTimeout(makeRequest, 1000); } else reject(e); });
      req.end();
    };
    makeRequest();
  });
}

// === БАЗОВЫЕ ФУНКЦИИ ИГРЫ ===
async function ensureJava(log) {
  if (fs.existsSync(getBundledJavaPath())) return getBundledJavaPath();
  log('Скачиваю Java 21...', 'info');
  const api = `https://api.adoptium.net/v3/binary/latest/21/ga/${process.platform === 'win32' ? 'windows' : 'linux'}/${os.arch() === 'arm64' ? 'aarch64' : 'x64'}/jre/hotspot/normal/eclipse`;
  const cacheDir = path.join(app.getPath('userData'), 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  const archivePath = path.join(cacheDir, 'java.zip');
  await downloadFile(api, archivePath);
  const jreDir = getBundledJavaDir();
  fs.mkdirSync(jreDir, { recursive: true });
  const zip = new AdmZip(archivePath);
  zip.extractAllTo(cacheDir, true);
  const extracted = fs.readdirSync(cacheDir).find(n => n.startsWith('jdk-'));
  if (extracted) {
    const extPath = path.join(cacheDir, extracted);
    for (const item of fs.readdirSync(extPath)) fs.renameSync(path.join(extPath, item), path.join(jreDir, item));
    fs.rmSync(extPath, { recursive: true, force: true });
  }
  fs.unlinkSync(archivePath);
  return getBundledJavaPath();
}

async function installLoader(dir, version, loader, javaPath, log) {
  if (loader === 'vanilla') return version;
  log(`Установка ${loader}...`, 'info');
  const manifest = await fetchJSON('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
  const vinfo = manifest.versions.find(v => v.id === version);
  const vanilla = await fetchJSON(vinfo.url);
  
  let profile, versionName;
  if (loader === 'fabric' || loader === 'quilt') {
    const url = loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
    const list = await fetchJSON(`${url}/versions/loader/${version}`);
    const loaderVer = list[0].loader.version;
    profile = await fetchJSON(`${url}/versions/loader/${version}/${loaderVer}/profile/json`);
    versionName = `${loader}-loader-${loaderVer}-${version}`;
  } else {
    // Для Forge мы не будем переписывать сложный инсталлятор, просто выведем ошибку, если нет авто-установки
    throw new Error('Автоустановка Forge в профили временно недоступна.');
  }

  const vDir = path.join(dir, 'versions', versionName);
  fs.mkdirSync(vDir, { recursive: true });
  const merged = JSON.parse(JSON.stringify(vanilla));
  merged.id = versionName;
  merged.mainClass = profile.mainClass || merged.mainClass;
  merged.libraries = (vanilla.libraries || []).concat(profile.libraries || []);
  merged.jar = version;
  
  fs.writeFileSync(path.join(vDir, versionName + '.json'), JSON.stringify(merged, null, 2), 'utf-8');
  return versionName;
}

// === ОСНОВНОЙ ЗАПУСК ===
async function launchGame(cfg) {
  if (!Client) return { ok: false, error: 'MCLC не установлен' };
  const config = { ...loadConfig(), ...cfg };
  saveConfig(config);
  const root = getProfileDir(config);
  fs.mkdirSync(root, { recursive: true });
  const log = (msg, type) => { if (mainWindow) mainWindow.webContents.send('launch:log', { type, message: msg }); };
  
  let javaPath = await ensureJava(log).catch(e => { log('Java: ' + e.message, 'error'); return null; });
  if (!javaPath) return { ok: false, error: 'Java error' };

  let versionName = config.version;
  if (config.loader !== 'vanilla') {
    versionName = await installLoader(root, config.version, config.loader, javaPath, log).catch(e => {
      log(e.message, 'error');
      return config.version;
    });
  }

  isLaunching = true;
  launcherClient = new Client();
  launcherClient.on('debug', m => log(String(m), 'debug'));
  launcherClient.on('data', m => log(String(m), 'data'));
  launcherClient.on('close', code => { isLaunching = false; if (mainWindow) mainWindow.webContents.send('launch:close', { code }); });

  const versionObj = { number: versionName, type: 'release', custom: versionName !== config.version ? versionName : undefined };
  const ramMB = Math.max(1024, Math.min(Number(config.ram) || 6144, 16384));

  let auth;
  if (config.accessToken && config.authType === 'ely') {
      const injectorPath = path.join(app.getPath('userData'), 'authlib-injector.jar');
      if (!fs.existsSync(injectorPath)) await downloadFile('https://authlib-injector.yushi.moe/artifact/56/authlib-injector-1.2.8.jar', injectorPath);
      auth = { accessToken: config.accessToken, clientToken: config.accessToken, selectedProfile: { id: config.uuid, name: config.nickname }, uuid: config.uuid, name: config.nickname, userType: 'mojang' };
      // В реальном проекте аргументы JVM нужно прокидывать, здесь упрощенно
  } else {
      auth = Authenticator.getAuth(config.nickname);
  }

  const o = {
    authorization: auth, root, version: versionObj, javaPath,
    memory: { max: ramMB + 'M', min: '2048M' },
    window: { width: Number(config.width) || 1280, height: Number(config.height) || 720, fullscreen: !!config.fullscreen },
    overrides: { maxSockets: 8, detached: false }
  };

  launcherClient.launch(o);
  return { ok: true };
}

// === ГЛАВНОЕ ОКНО ===
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 740, minWidth: 940, minHeight: 620,
    frame: false, backgroundColor: '#161718', show: false,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    autoUpdater.checkForUpdatesAndNotify(); // Проверка обновлений
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// === IPC ОБРАБОТЧИКИ ===
ipcMain.on('window:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window:maximize', () => { if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
ipcMain.on('window:close', () => mainWindow && mainWindow.close());

ipcMain.handle('config:get', () => loadConfig());
ipcMain.handle('config:set', (_e, cfg) => saveConfig({ ...loadConfig(), ...cfg }));

ipcMain.handle('versions:get', async () => {
  try {
    const m = await fetchJSON('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
    return { ok: true, versions: m.versions.filter(v => v.type === 'release').map(v => ({ id: v.id, releaseTime: v.releaseTime })) };
  } catch (e) { return { ok: false, versions: [] }; }
});

ipcMain.handle('system:info', () => ({
  totalRam: Math.floor(os.totalmem() / (1024 ** 3)), freeRam: Math.floor(os.freemem() / (1024 ** 3)),
  recommendedRam: getRecommendedRAM(), cpus: os.cpus().length, platform: process.platform
}));

// Фоновое изображение
ipcMain.handle('bg:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg'] }] });
  return res.canceled ? null : res.filePaths[0];
});

// Сервера (Пинг)
ipcMain.handle('server:ping', async (_e, ip) => {
  try {
    const res = await fetch(`https://api.mcsrvstat.us/3/${ip}`);
    const data = await res.json();
    return { online: data.online || false, players: data.players ? data.players.online : 0 };
  } catch (e) { return { online: false, players: 0 }; }
});

// Магазин Modrinth
ipcMain.handle('mods:search', async (_e, query) => {
  try {
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=12&facets=[["project_type:mod"]]`;
    const data = await fetchJSON(url);
    return { ok: true, hits: data.hits };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('mods:download', async (_e, { projectId, version, loader }) => {
  try {
    const url = `https://api.modrinth.com/v2/project/${projectId}/version?game_versions=%5B%22${version}%22%5D&loaders=%5B%22${loader}%22%5D`;
    const versions = await fetchJSON(url);
    if (!versions || !versions.length) return { ok: false, error: 'Мод не найден для этой версии/ядра.' };
    const file = versions[0].files.find(f => f.primary) || versions[0].files[0];
    const modsDir = getModsDir();
    fs.mkdirSync(modsDir, { recursive: true });
    await downloadFile(file.url, path.join(modsDir, file.filename));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Скриншоты
ipcMain.handle('screenshots:list', () => {
  try {
    const dir = path.join(getProfileDir(loadConfig()), 'screenshots');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.png')).map(f => ({ name: f, path: 'file://' + path.join(dir, f).replace(/\\/g, '/') }));
  } catch (e) { return []; }
});

// Моды (Drag & Drop)
ipcMain.handle('mods:drop', async (_e, filePaths) => {
  const modsDir = getModsDir();
  fs.mkdirSync(modsDir, { recursive: true });
  filePaths.forEach(p => {
    if (p.endsWith('.jar')) fs.copyFileSync(p, path.join(modsDir, path.basename(p)));
  });
  return { ok: true };
});

ipcMain.handle('mods:list', () => {
  try {
    const dir = getModsDir();
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.jar')).map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: (st.size / 1024 / 1024).toFixed(2) + ' МБ' };
    });
  } catch (e) { return []; }
});

ipcMain.handle('mods:remove', (_e, name) => {
  try { fs.unlinkSync(path.join(getModsDir(), name)); return { ok: true }; } catch (e) { return { ok: false }; }
});

ipcMain.handle('game:launch', (_e, cfg) => launchGame(cfg));
ipcMain.handle('shell:openFolder', async (_e, p) => { if (p) await shell.openPath(p); });
ipcMain.handle('shell:pickFolder', async () => { const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] }); return res.canceled ? null : res.filePaths[0]; });
ipcMain.handle('shell:pickJava', async () => { const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Java', extensions: ['exe'] }] }); return res.canceled ? null : res.filePaths[0]; });
ipcMain.handle('shell:openExternal', async (_e, url) => { await shell.openExternal(url); });

// Инициализация
app.whenReady().then(() => {
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });