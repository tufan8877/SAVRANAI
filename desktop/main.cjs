const {app,BrowserWindow,session,shell,Tray,Menu,nativeImage,ipcMain,dialog,desktopCapturer,screen}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
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
 if(event.sender!==win.webContents||event.senderFrame?.parent!==null||!trusted(event.senderFrame.url))throw new Error('Nicht autorisiert');
 const targets={desktop:'desktop',documents:'documents',downloads:'downloads'};
 if(typeof action!=='string'||!['desktop','documents','downloads','file','mail','outlook','program','list','read','save','desktop-list','status'].includes(action))throw new Error('Unbekannte Aktion');
 if(action==='status')return 'Desktop-Schnittstelle 1.1 verbunden.';
 const labels={desktop:'Desktop öffnen',documents:'Dokumente öffnen',downloads:'Downloads öffnen',file:'Eine lokale Datei auswählen und öffnen',mail:'Neue E-Mail im Standard-Mailprogramm öffnen',outlook:'Outlook im Browser öffnen',program:'Installiertes Programm auswählen und starten',list:'Ordner auswählen und Dateinamen anzeigen',read:'Textdatei auswählen und lokal anzeigen',save:'Neue Textdatei erstellen','desktop-list':'Dateinamen auf deinem Desktop für CORE freigeben'};
 if(localBusy)return 'Eine lokale Aktion läuft bereits.';
 localBusy=true;
 try{
 const confirmation=await dialog.showMessageBox(win,{type:'question',buttons:['Abbrechen','Erlauben'],defaultId:0,cancelId:0,title:'CORE – lokaler Zugriff',message:labels[action]+'?'});
 if(confirmation.response!==1)return 'Aktion abgebrochen.';
 if(action==='mail'||action==='outlook'){await shell.openExternal(action==='mail'?'mailto:':'https://outlook.office.com/mail/');return 'Mailprogramm beziehungsweise Outlook-Webseite geöffnet. Keine E-Mail versendet.'}
 if(action==='desktop-list'){const entries=await fs.readdir(app.getPath('desktop'),{withFileTypes:true});return 'Desktop: '+(entries.slice(0,100).map(e=>(e.isDirectory()?'Ordner: ':'Datei: ')+e.name).join('\n').slice(0,6000)||'Keine Einträge');}
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
 ipcMain.handle('core:vision',async(event)=>{
 if(event.sender!==win.webContents||event.senderFrame?.parent!==null||!trusted(event.senderFrame.url))throw new Error('Nicht autorisiert');
 if(localBusy)throw new Error('Eine lokale Aktion läuft bereits.');
 localBusy=true;
 try{
 const consent=await dialog.showMessageBox(win,{type:'warning',title:'CORE Vision',message:'Bildschirm einmalig analysieren?',detail:'Ein Screenshot des Hauptbildschirms wird an den CORE-Server und den KI-Anbieter Groq übertragen. Schließe vorher vertrauliche Inhalte. CORE wird kurz ausgeblendet.',buttons:['Abbrechen','Screenshot erlauben'],defaultId:0,cancelId:0});
 if(consent.response!==1)return null;
 const display=screen.getPrimaryDisplay();
 win.hide();
 try{
 await new Promise(resolve=>setTimeout(resolve,650));
 const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1920,height:1080},fetchWindowIcons:false});
 const source=sources.find(s=>s.display_id===String(display.id))||(sources.length===1?sources[0]:null);
 if(!source||source.thumbnail.isEmpty())throw new Error('Hauptbildschirm konnte nicht aufgenommen werden.');
 const jpeg=source.thumbnail.toJPEG(85);
 if(jpeg.length>4*1024*1024)throw new Error('Screenshot zu groß.');
 return jpeg.toString('base64');
 }finally{show()}
 }finally{localBusy=false}
 });
 ipcMain.handle('core:control',async(event,action)=>{
 if(event.sender!==win.webContents||event.senderFrame?.parent!==null||!trusted(event.senderFrame.url))throw new Error('Nicht autorisiert');
 if(process.platform!=='win32')return 'CORE Control ist derzeit nur für Windows verfügbar.';
 if(localBusy)return 'Eine lokale Aktion läuft bereits.';
 const keys={escape:'{ESC}',tab:'{TAB}',enter:'{ENTER}',up:'{UP}',down:'{DOWN}',left:'{LEFT}',right:'{RIGHT}',pageup:'{PGUP}',pagedown:'{PGDN}'};
 const apps={notepad:'notepad.exe',calculator:'calc.exe',explorer:'explorer.exe'};
 if(!action||typeof action!=='object')throw new Error('Ungültige Aktion');
 const kind=action.kind;
 if(kind==='key'&&!Object.hasOwn(keys,action.key))throw new Error('Taste nicht freigegeben');
 if(kind==='app'&&!Object.hasOwn(apps,action.app))throw new Error('Programm nicht freigegeben');
 if(kind==='move'||kind==='click'){
 const b=screen.getPrimaryDisplay().bounds;
 if(!Number.isInteger(action.x)||!Number.isInteger(action.y)||action.x<0||action.y<0||action.x>=b.width||action.y>=b.height)throw new Error('Koordinaten außerhalb des Hauptbildschirms');
 }
 if(!['key','app','move','click'].includes(kind))throw new Error('Aktion nicht freigegeben');
 const label=kind==='key'?'Taste '+action.key:kind==='app'?'Programm '+action.app:kind==='move'?'Maus bewegen zu '+action.x+', '+action.y:'Einmal klicken bei '+action.x+', '+action.y;
 localBusy=true;
 try{
 const consent=await dialog.showMessageBox(win,{type:'warning',title:'CORE Control',message:label+'?',detail:'CORE wird ausgeblendet. Bei Tastaturaktionen wähle innerhalb von 3 Sekunden das gewünschte Fenster. Prüfe vor einem Klick die Zielposition.',buttons:['Abbrechen','Ausführen'],defaultId:0,cancelId:0});
 if(consent.response!==1)return 'Aktion abgebrochen.';
 win.hide();
 try{
 if(kind==='app'){await run(apps[action.app],[],{timeout:5000,windowsHide:true}).catch(e=>{if(!e.killed)throw e});return 'Programmstart angefordert.'}
 await new Promise(resolve=>setTimeout(resolve,3000));
 let script;
 if(kind==='key')script="Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('"+keys[action.key]+"')";
 else{
 const b=screen.getPrimaryDisplay().bounds;
 const p=screen.dipToScreenPoint({x:b.x+action.x,y:b.y+action.y});
 script="Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point("+p.x+","+p.y+");";
 if(kind==='click')script+=" Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class CoreMouse { [DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,uint x,uint y,uint d,System.UIntPtr e); }'; [CoreMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [CoreMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero);";
 }
 await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:10000,windowsHide:true});
 return 'Eingabe ausgeführt. Bitte Ergebnis im Zielprogramm prüfen.';
 }finally{if(!win.isDestroyed())win.showInactive()}
 }finally{localBusy=false}
 });
 win.loadURL(url+'/?app=1');
 }).catch(error=>{console.error('CORE startup failed',error);app.quit()});
}
