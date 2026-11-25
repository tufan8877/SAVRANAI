const {app,BrowserWindow,session,shell,Tray,Menu,nativeImage}=require('electron');
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
 win=new BrowserWindow({width:1100,height:850,minWidth:360,minHeight:500,autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 win.webContents.on('will-navigate',(e,u)=>{if(!trusted(u))e.preventDefault()});
 win.webContents.on('will-redirect',(e,u)=>{if(!trusted(u))e.preventDefault()});
 win.webContents.setWindowOpenHandler(({url:u})=>{if(/^https:\/\//i.test(u))void shell.openExternal(u).catch(()=>{});return {action:'deny'}});
 const pixels=Buffer.alloc(32*32*4);
 for(let y=0;y<32;y++)for(let x=0;x<32;x++){const d=Math.hypot(x-15.5,y-15.5);if((d>9&&d<13)||d<5){const i=(y*32+x)*4;pixels[i]=90;pixels[i+1]=175;pixels[i+2]=239;pixels[i+3]=255;}}
 tray=new Tray(nativeImage.createFromBitmap(pixels,{width:32,height:32}));
 tray.setToolTip('INTEL AI CORE');tray.setContextMenu(menu());tray.on('click',show);
 win.on('close',e=>{if(!quitting&&tray){e.preventDefault();win.hide()}});
 app.on('activate',show);
 win.loadURL(url+'/?app=1');
 }).catch(error=>{console.error('CORE startup failed',error);app.quit()});
}
