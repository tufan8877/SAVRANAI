const {app,BrowserWindow,session,shell,Tray,Menu,nativeImage,ipcMain,dialog}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
let localBusy=false;
const url='https://savranai.onrender.com';
const trusted=u=>{try{return new URL(u).origin===url}catch{return false}};
let win,tray,quitting=false;
function show(){if(win&&!win.isDestroyed()){win.show();win.focus()}}
function menu(){return Menu.buildFromTemplate([
 {label:'CORE öffnen',click:show},
 {label:'Beim Anmelden starten',type:'checkbox',checked:app.getLoginItemSettings().openAtLogin,click:item=>app.setLoginItemSettings({openAtLogin:item.checked})},
 {label:'CORE vollständig beenden',click:()=>app.quit()}
])}
if(!app.requestSingleInstanceLock())app.quit();
else{
 app.on('second-instance',show);
 app.on('before-quit',()=>{quitting=true});
 app.whenReady().then(()=>{
 const ses=session.defaultSession;
 ses.setPermissionRequestHandler((wc,permission,callback,details)=>callback(trusted(details.requestingUrl||wc.getURL())&&permission==='media'&&Array.isArray(details.mediaTypes)&&details.mediaTypes.length>0&&details.mediaTypes.every(t=>t==='audio')));
 ses.setPermissionCheckHandler((wc,permission,origin,details)=>trusted(origin)&&permission==='media'&&details.mediaType==='audio');
 win=new BrowserWindow({width:1100,height:850,minWidth:360,minHeight:500,autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.cjs')}});
 win.webContents.on('will-navigate',(e,u)=>{if(!trusted(u))e.preventDefault()});
 win.webContents.on('will-redirect',(e,u)=>{if(!trusted(u))e.preventDefault()});
 win.webContents.setWindowOpenHandler(({url:u})=>{if(/^https:\/\//i.test(u))void shell.openExternal(u).catch(()=>{});return {action:'deny'}});
 const pixels=Buffer.alloc(32*32*4);
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){const d=Math.hypot(x-15.5,y-15.5);if((d>9&&d<13)||d<5){const i=(y*32+x)*4;pixels[i]=90;pixels[i+1]=175;pixels[i+2]=239;pixels[i+3]=255;}}
 tray=new Tray(nativeImage.createFromBitmap(pixels,{width:32,height:32}));
 tray.setToolTip('INTEL AI CORE');tray.setContextMenu(menu());tray.on('click',show);
 win.on('close',e=>{if(!quitting&&tray){e.preventDefault();win.hide()}});
 app.on('activate',show);
 ipcMain.handle('core:local',async(event,action)=>{
 if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||!trusted(event.senderFrame.url))throw new Error('Nicht autorisiert');
 const targets={desktop:'desktop',documents:'documents',downloads:'downloads'};
 if(typeof action!=='string'||!['desktop','documents','downloads','file','mail','outlook','program','list','read','save'].includes(action))throw new Error('Unbekannte Aktion');
 const labels={desktop:'Desktop öffnen',documents:'Dokumente öffnen',downloads:'Downloads öffnen',file:'Eine lokale Datei auswählen und öffnen',mail:'Neue E-Mail im Standard-Mailprogramm öffnen',outlook:'Outlook im Browser öffnen',program:'Installiertes Programm auswählen und starten',list:'Ordner auswählen und Dateinamen anzeigen',read:'Textdatei auswählen und lokal anzeigen',save:'Neue Textdatei erstellen'};
 if(localBusy)return 'Eine lokale Aktion läuft bereits.';
 localBusy=true;
 try{
 const confirmation=await dialog.showMessageBox(win,{type:'question',buttons:['Abbrechen','Erlauben'],defaultId:0,cancelId:0,title:'CORE – lokaler Zugriff',message:labels[action]+'?'});
 if(confirmation.response!==1)return 'Aktion abgebrochen.';
 if(action==='mail'||action==='outlook'){await shell.openExternal(action==='mail'?'mailto:':'https://outlook.office.com/mail/');return 'Mailprogramm beziehungsweise Outlook-Webseite geöffnet. Keine E-Mail versendet.'}
 if(action==='list'||action==='read'||action==='program'||action==='save'){
 if(action==='save'){const chosen=await dialog.showSaveDialog(win,{title:'Neue leere Textdatei',defaultPath:'CORE-Notiz.txt',filters:[{name:'Text',extensions:['txt']}]});if(chosen.canceled||!chosen.filePath)return 'Abgebrochen.';if(!/\.txt$/i.test(chosen.filePath))return 'Nur TXT erlaubt.';await fs.writeFile(chosen.filePath,'',{flag:'wx'});return 'Neue leere Textdatei erstellt.'}
 const selected=await dialog.showOpenDialog(win,{properties:[action==='list'?'openDirectory':'openFile']});if(selected.canceled)return 'Abgebrochen.';const selectedPath=selected.filePaths[0];
 if(action==='list'){const entries=await fs.readdir(selectedPath,{withFileTypes:true});await dialog.showMessageBox(win,{title:'Lokale Ordnerübersicht',message:entries.slice(0,100).map(e=>e.name).join('\n').slice(0,6000)||'Leerer Ordner'});return 'Ordnerübersicht lokal angezeigt.'}
 if(action==='read'){if(!/\.(txt|csv|md|log)$/i.test(selectedPath))return 'Nur Textdateien werden unterstützt.';const handle=await fs.open(selectedPath,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>65536)return 'Datei zu groß oder nicht unterstützt.';const buffer=Buffer.alloc(65536);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);await dialog.showMessageBox(win,{title:'Lokaler Dateiinhalt',message:buffer.toString('utf8',0,bytesRead).slice(0,12000)||'Leere Datei'});return 'Dateiinhalt lokal angezeigt, nicht an die KI übertragen.'}finally{await handle.close()}}
 if(!/\.(exe|app)$/i.test(selectedPath))return 'Bitte eine installierte EXE oder APP auswählen.';const check=await dialog.showMessageBox(win,{type:'warning',message:'Dieses Programm starten?',detail:selectedPath,buttons:['Abbrechen','Starten'],defaultId:0,cancelId:0});if(check.response!==1)return 'Abgebrochen.';const err=await shell.openPath(selectedPath);if(err)throw new Error('Programm konnte nicht geöffnet werden.');return 'Programm zum Starten übergeben.';
 }
 let target;
 if(action==='file'){const selected=await dialog.showOpenDialog(win,{properties:['openFile']});if(selected.canceled)return 'Keine Datei ausgewählt.';target=selected.filePaths[0];if(!/\.(pdf|txt|docx|xlsx|png|jpg|jpeg|csv)$/i.test(target))return 'Dieser Dateityp ist nicht freigegeben.'}
 else target=app.getPath(targets[action]);
 const error=await shell.openPath(target);if(error)throw new Error('Öffnen fehlgeschlagen.');
 return 'Die ausgewählte Datei oder der Ordner wurde zum Öffnen übergeben.';
 }finally{localBusy=false}
 });
 win.loadURL(url+'/?app=1');
 }).catch(error=>{console.error('CORE startup failed',error);app.quit()});
}
