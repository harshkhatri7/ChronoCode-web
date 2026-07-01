const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');

const isDev = process.env.ELECTRON_DEV === '1';
let mainWindow = null;
let httpServer = null;

const CURRENT_VERSION = app.getVersion();
const DATA_DIR = path.join(require('os').homedir(), '.chronocode');
const TOKEN_FILE = path.join(DATA_DIR, 'session.json');

function loadSession() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const raw = fs.readFileSync(TOKEN_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return null;
}

function saveSession(token, user) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ token, user }, null, 2), 'utf-8');
  } catch (_) {}
}

function clearSession() {
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch (_) {}
}

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const serverApp = require('./server.js');
    const wss = require('./server.js')._wss;
    httpServer = http.createServer(serverApp);
    const port = parseInt(process.env.CHRONO_PORT_HTTP || '9998', 10);

    if (wss) {
      httpServer.on('upgrade', (request, socket, head) => {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      });
    }

    function tryListen() {
      httpServer.listen(port, '0.0.0.0', () => {
        console.log(`[Electron] Server ready on http://localhost:${port}`);
        resolve(httpServer);
      });

      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[Electron] Port ${port} already in use, connecting to existing server`);
          resolve(null);
        } else {
          reject(err);
        }
      });
    }

    setTimeout(tryListen, 200);
  });
}

function waitForServer(url, maxAttempts = 30, intervalMs = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function check() {
      http.get(url, (res) => {
        res.resume();
        resolve(true);
      }).on('error', () => {
        if (++attempts >= maxAttempts) {
          reject(new Error('Server did not become ready'));
        } else {
          setTimeout(check, intervalMs);
        }
      });
    }
    check();
  });
}

// ─────────────────────────────────────────────
// CREATE WINDOW
// ─────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'logo.png');
  const hasIcon = fs.existsSync(iconPath);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ChronoCode',
    icon: hasIcon ? iconPath : undefined,
    backgroundColor: '#08090a',
    titleBarStyle: 'hidden',
    frame: process.platform === 'darwin',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const session = loadSession();
  if (session && session.token) {
    mainWindow.loadURL('http://localhost:9998/public/index.html');
  } else {
    mainWindow.loadURL('http://localhost:9998/login.html');
  }

  if (!isDev) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─────────────────────────────────────────────
// IPC — WINDOW CONTROLS
// ─────────────────────────────────────────────
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// ─────────────────────────────────────────────
// IPC — SESSION MANAGEMENT
// ─────────────────────────────────────────────
ipcMain.handle('session-get', () => {
  return loadSession();
});

ipcMain.on('session-save', (_event, token, user) => {
  saveSession(token, user);
  if (mainWindow) {
    mainWindow.loadURL('http://localhost:9998/public/index.html');
  }
});

ipcMain.on('session-clear', () => {
  clearSession();
  if (mainWindow) {
    mainWindow.loadURL('http://localhost:9998/login.html');
  }
});

// ─────────────────────────────────────────────
// IPC — AUTO UPDATE
// ─────────────────────────────────────────────
ipcMain.handle('check-update', async () => {
  return new Promise((resolve) => {
    const url = 'https://chronocode-ai.vercel.app/api/version';
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          const latest = info.version || CURRENT_VERSION;
          const needsUpdate = compareVersions(latest, CURRENT_VERSION) > 0;
          resolve({ needsUpdate, currentVersion: CURRENT_VERSION, latestVersion: latest, downloadUrl: info.downloadUrl, releaseDate: info.releaseDate, notes: info.notes });
        } catch (e) {
          resolve({ needsUpdate: false, currentVersion: CURRENT_VERSION, latestVersion: CURRENT_VERSION, error: e.message });
        }
      });
    }).on('error', (e) => {
      resolve({ needsUpdate: false, currentVersion: CURRENT_VERSION, latestVersion: CURRENT_VERSION, error: e.message });
    });
  });
});

ipcMain.on('open-download', (_event, url) => {
  shell.openExternal(url || 'https://chronocode-ai.vercel.app');
});

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// ─────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    console.log('[Electron] Starting ChronoCode server...');
    await startServer();
    console.log('[Electron] Waiting for server health...');
    await waitForServer('http://localhost:9998/api/health');
    console.log('[Electron] Server healthy — launching');
    createWindow();
  } catch (err) {
    console.error('[Electron] Failed to start:', err);
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
