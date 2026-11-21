const { app, BrowserWindow, Tray, Menu, dialog, shell, ipcMain } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const KHUT = app.isPackaged ? path.join(process.resourcesPath, 'khut') : path.join(__dirname, '..');
const DATA = app.isPackaged ? path.join(app.getPath('userData'), 'bot') : KHUT;
const CONFIG = path.join(app.getPath('userData'), 'app.json');
const ICON = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');

let win = null;
let tray = null;
let panel = null;
let url = null;
let quitting = false;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  } catch {
    return {};
  }
}

function options() {
  return {
    closeToTray: !!readConfig().closeToTray,
    startWithWindows: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin,
    packaged: app.isPackaged
  };
}

function setOption(key, value) {
  if (key === 'closeToTray') {
    fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
    fs.writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), closeToTray: value }));
  }
  if (key === 'startWithWindows' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: value, args: ['--hidden'] });
  trayMenu();
  return options();
}

function startPanel() {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(DATA, { recursive: true });
    let output = '';
    panel = spawn(process.execPath, [path.join(KHUT, 'src', 'panel.js'), '--app'], {
      cwd: DATA,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', KHUT_DATA: DATA, NODE_PATH: path.join(__dirname, 'node_modules') }
    });
    panel.on('error', reject);
    panel.stderr.on('data', chunk => (output += chunk));
    panel.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/Khut panel: (http:\/\/\S+)/);
      if (match) resolve(match[1]);
    });
    panel.on('exit', code => {
      panel = null;
      if (quitting) return;
      if (!url) return reject(new Error(output.trim() || `The panel stopped (exit code ${code}).`));
      dialog.showErrorBox('Khut', `The panel stopped unexpectedly.\n\n${output.trim().slice(-1500)}`);
      quit();
    });
  });
}

function stopPanel() {
  return new Promise(resolve => {
    const child = panel;
    if (!child) return resolve();
    const force = setTimeout(() => {
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => resolve());
      else child.kill('SIGKILL');
    }, 5000);
    child.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    child.stdin.end();
  });
}

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1200,
    height: 850,
    minWidth: 800,
    minHeight: 600,
    icon: ICON,
    backgroundColor: '#1e1f22',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });
  win.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    if (options().closeToTray) win.hide();
    else quit();
  });
  win.once('ready-to-show', () => {
    if (!hidden) win.show();
  });
  win.loadURL(url);
}

function trayMenu() {
  if (!tray) return;
  const current = options();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Khut', click: show },
    { type: 'separator' },
    { label: 'Close to tray', type: 'checkbox', checked: current.closeToTray, click: item => setOption('closeToTray', item.checked) },
    { label: 'Start with Windows', type: 'checkbox', enabled: app.isPackaged, checked: current.startWithWindows, click: item => setOption('startWithWindows', item.checked) },
    { label: 'Open data folder', click: () => shell.openPath(DATA) },
    { type: 'separator' },
    { label: 'Quit Khut', click: quit }
  ]));
}

async function quit() {
  if (quitting) return;
  quitting = true;
  tray?.destroy();
  win?.destroy();
  await stopPanel();
  app.exit(0);
}

if (process.platform === 'win32') app.setAppUserModelId('com.cankhut.khut');

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', show);
  app.on('before-quit', event => {
    event.preventDefault();
    quit();
  });
  app.on('window-all-closed', () => {});
  ipcMain.handle('options', () => options());
  ipcMain.handle('option', (event, key, value) => setOption(key, !!value));
  ipcMain.handle('open-data', () => shell.openPath(DATA));
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      url = await startPanel();
    } catch (err) {
      dialog.showErrorBox("Khut couldn't start", err.message.slice(-1500));
      return app.exit(1);
    }
    tray = new Tray(ICON);
    tray.setToolTip('Khut');
    tray.on('click', show);
    trayMenu();
    createWindow(process.argv.includes('--hidden'));
  });
}
