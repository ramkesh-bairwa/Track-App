const { app, BrowserWindow, nativeTheme } = require('electron');
const fs = require('fs');
const U='http://127.0.0.1:3097';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  const win = new BrowserWindow({ width: 1200, height: 1000, show: false, webPreferences:{ partition:'sql'+Date.now() } });
  const errs=[]; win.webContents.on('console-message',(e,l,m)=>{if(l>=2)errs.push(m.slice(0,120));});
  await win.loadURL(U+'/login'); await sleep(1200);
  await win.webContents.executeJavaScript(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'demo@example.com',password:'123!@#'})}).then(r=>r.status)`);
  await sleep(400); await win.loadURL(U+'/dashboard'); await sleep(2500);
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.profile-menu-trigger')).find(b=>b.getBoundingClientRect().width>0).click();`);
  await sleep(500);
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.profile-menu-item')).find(b=>/Export \\/ import/.test(b.textContent))?.click();`);
  await sleep(700);
  // inject a .sql File into the file input
  const injected = await win.webContents.executeJavaScript(`
    (()=>{const inp=document.querySelector('.data-transfer-modal input[type=file]'); if(!inp)return 'no-input';
      const f=new File(['-- MyTrack database\\nSET NAMES utf8mb4;\\nCREATE TABLE IF NOT EXISTS t (id int);\\nINSERT INTO t (id) VALUES (1);'],'backup.sql',{type:'application/sql'});
      const dt=new DataTransfer(); dt.items.add(f); inp.files=dt.files;
      inp.dispatchEvent(new Event('change',{bubbles:true})); return 'injected';})()`);
  await sleep(600);
  const ui = await win.webContents.executeJavaScript(`
    (()=>{const m=document.querySelector('.data-transfer-modal'); const btn=Array.from(m.querySelectorAll('button')).find(b=>/Run SQL file/.test(b.textContent)); const warn=Array.from(m.querySelectorAll('.field-hint')).some(e=>/runs the SQL/.test(e.textContent)); return {runBtn:!!btn, warn, crashed: !document.querySelector('.data-transfer-modal')};})()`);
  fs.writeFileSync(process.env.OUT, (await win.webContents.capturePage()).toPNG());
  console.log('INJECT', injected, 'UI', JSON.stringify(ui), 'ERRS', JSON.stringify(errs.slice(0,3)));
  app.quit();
});
