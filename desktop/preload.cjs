const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('coreDesktop',{local:action=>ipcRenderer.invoke('core:local',action),vision:()=>ipcRenderer.invoke('core:vision')});
