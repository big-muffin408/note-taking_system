const { app, BrowserWindow } = require('electron');

console.log('app:', typeof app);
console.log('BrowserWindow:', typeof BrowserWindow);

if (app) {
  console.log('app.isPackaged:', app.isPackaged);
  app.whenReady().then(() => {
    console.log('App is ready!');
    const win = new BrowserWindow({ width: 800, height: 600 });
    win.loadURL('https://www.electronjs.org');
    console.log('Window created!');
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
} else {
  console.log('app is undefined');
  console.log('process.versions.electron:', process.versions.electron);
  process.exit(1);
}
