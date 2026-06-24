const { app, BrowserWindow } = require('electron');
const path = require('path');

// Launch the local SaaS Express + WebSocket server
require('./server.js');

const isDev = process.env.ELECTRON_DEV === '1';

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'ChronoCode',
    icon: path.join(__dirname, 'assets', 'logo.svg'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Load the central login gateway first
  mainWindow.loadURL('http://localhost:9998/login.html');

  if (!isDev) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
