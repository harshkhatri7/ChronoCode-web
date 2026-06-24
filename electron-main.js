const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');

const isDev = process.env.ELECTRON_DEV === '1';
let mainWindow = null;

// ─────────────────────────────────────────────
// START SERVER + WAIT FOR READINESS
// ─────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    process.env.ELECTRON_DATA_DIR = path.join(require('os').homedir(), '.chronocode');
    const serverModule = require('./server.js');
    const httpServer = http.createServer(serverModule);
    const port = parseInt(process.env.CHRONO_PORT_HTTP || '9998', 10);

    // Use the wss instance exported by server.js
    if (serverModule._wss) {
      httpServer.on('upgrade', (request, socket, head) => {
        serverModule._wss.handleUpgrade(request, socket, head, (ws) => {
          serverModule._wss.emit('connection', ws, request);
        });
      });
    }

    const maxRetries = 50;
    let retries = 0;

    function tryListen() {
      httpServer.listen(port, '0.0.0.0', () => {
        console.log(`[Electron] Server ready on http://localhost:${port}`);
        resolve(httpServer);
      });

      httpServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`[Electron] Port ${port} in use — server already running, connecting...`);
          resolve(null); // Server already running externally
        } else if (retries < maxRetries) {
          retries++;
          console.log(`[Electron] Server not ready (attempt ${retries}/${maxRetries}), retrying in 500ms...`);
          setTimeout(tryListen, 500);
        } else {
          reject(err);
        }
      });
    }

    // Give the server module a moment to initialize (db, chokidar, etc.)
    setTimeout(tryListen, 300);
  });
}

// ─────────────────────────────────────────────
// HEALTH CHECK — ensure HTTP server responds
// ─────────────────────────────────────────────
function waitForServer(url, maxAttempts = 30, intervalMs = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    function check() {
      http.get(url, (res) => {
        res.resume();
        resolve(true);
      }).on('error', () => {
        if (++attempts >= maxAttempts) {
          reject(new Error('Server did not become ready in time'));
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

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ChronoCode',
    icon: iconPath,
    backgroundColor: '#08090a',
    titleBarStyle: 'hidden',
    frame: process.platform === 'darwin', // macOS gets native frame for traffic lights
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadURL('http://localhost:9998/login.html');

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
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-is-maximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// ─────────────────────────────────────────────
// APP LIFECYCLE
// ─────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    console.log('[Electron] Starting ChronoCode server...');
    await startServer();
    console.log('[Electron] Waiting for server health check...');
    await waitForServer('http://localhost:9998/api/health');
    console.log('[Electron] Server healthy — creating window');
    createWindow();
  } catch (err) {
    console.error('[Electron] Failed to start server:', err);
    // Still create window — user can see error in UI
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
