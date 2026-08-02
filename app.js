// NUBE VOLADORA PCJS V4.3 - BUSQUEDA INSTANTANEA POR INICIO - 02/08/2026
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_SCOPE = "openid email profile https://www.googleapis.com/auth/drive";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const CONFIG_KEY = "siit_pcjs_google_config_v2";
const CACHE_KEY = "siit_pcjs_google_cache_v2";
const FAV_KEY = "siit_pcjs_google_favorites_v2";
const AUTO_REFRESH_MS = 30000;
const SEARCH_INDEX_TTL_MS = 5 * 60 * 1000;
const SEARCH_RESULT_LIMIT = 3000;
const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 180;

const $ = (id) => document.getElementById(id);
const els = {
  app: $("app"), loginScreen: $("loginScreen"), loginBtn: $("loginBtn"), loginHelp: $("loginHelp"),
  openSetupBtn: $("openSetupBtn"), setupModal: $("setupModal"), actionModal: $("actionModal"),
  modalBackdrop: $("modalBackdrop"), clientIdInput: $("clientIdInput"), rootFolderInput: $("rootFolderInput"),
  accountModeInput: $("accountModeInput"), preferredEmailInput: $("preferredEmailInput"), redirectUriText: $("redirectUriText"), saveSetupBtn: $("saveSetupBtn"),
  refreshBtn: $("refreshBtn"), connectionBadge: $("connectionBadge"), accountBtn: $("accountBtn"),
  searchInput: $("searchInput"), clearSearchBtn: $("clearSearchBtn"), typeFilter: $("typeFilter"),
  content: $("content"), loading: $("loading"), emptyState: $("emptyState"), notice: $("notice"),
  statFolders: $("statFolders"), statFiles: $("statFiles"), statSync: $("statSync"), breadcrumb: $("breadcrumb"),
  uploadBtn: $("uploadBtn"), mobileUploadBtn: $("mobileUploadBtn"), fileInput: $("fileInput"), newFolderBtn: $("newFolderBtn"),
  settingsBtn: $("settingsBtn"), mobileSettingsBtn: $("mobileSettingsBtn"), logoutBtn: $("logoutBtn"),
  viewTitle: $("viewTitle"), viewSubtitle: $("viewSubtitle"), actionTitle: $("actionTitle"), actionBody: $("actionBody"), actionFooter: $("actionFooter"),
  toastContainer: $("toastContainer")
};

let config = loadConfig();
let tokenClient = null;
let accessToken = "";
let account = null;
let rootItem = null;
let rootFolders = [];
let currentFolder = null;
let currentView = "dashboard";
let currentItems = [];
let searchTimer = null;
let loading = false;
let autoRefreshTimer = null;
let silentRefreshing = false;
let repositoryIndex = [];
let repositoryIndexPromise = null;
let repositoryIndexUpdatedAt = 0;
let repositoryIndexGeneration = 0;
let searchRunId = 0;

function loadConfig() {
  const defaults = window.SIIT_CONFIG || { clientId: "", rootFolder: "EXPEDIENTES_SUNAFIL", preferredEmail: "paulus.iuris@gmail.com" };
  try { return { ...defaults, ...(JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}) }; }
  catch { return defaults; }
}
function saveConfig(value) { config = value; localStorage.setItem(CONFIG_KEY, JSON.stringify(value)); }
function getAuthorizedOrigin() { return location.origin; }
function esc(value="") { return String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function formatBytes(bytes=0) { const value=Number(bytes||0); if (!value) return "0 B"; const units=["B","KB","MB","GB","TB"]; const i=Math.min(Math.floor(Math.log(value)/Math.log(1024)),units.length-1); return `${(value/1024**i).toFixed(i?1:0)} ${units[i]}`; }
function formatDate(value) { if (!value) return "—"; return new Intl.DateTimeFormat("es-PE", {dateStyle:"short", timeStyle:"short"}).format(new Date(value)); }
function extension(name="") { const p=name.toLowerCase().split("."); return p.length>1?p.pop():""; }
function normalizeSearchText(value="") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\-./\\]+/g, " ")
    .replace(/[^a-zA-Z0-9ñÑ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es");
}
function iconClass(item) {
  if (item.folder) return ["folder","▰"];
  const ext=extension(item.name), mime=item.mimeType||"";
  if(ext==="pdf")return["pdf","PDF"];
  if(mime==="application/vnd.google-apps.document"||["doc","docx","docm","odt","rtf","txt"].includes(ext))return["word","W"];
  if(mime==="application/vnd.google-apps.spreadsheet"||["xls","xlsx","xlsm","ods","csv","tsv"].includes(ext))return["excel","X"];
  if(mime==="application/vnd.google-apps.presentation"||["ppt","pptx","pptm","odp"].includes(ext))return["slides","P"];
  if(["png","jpg","jpeg","webp","gif"].includes(ext))return["image","IMG"];
  return ["","DOC"];
}
function isMacroOffice(item) { return ["docm","xlsm","pptm"].includes(extension(item.name)); }
function isAndroidDevice() { return /Android/i.test(navigator.userAgent || ""); }
function buildAndroidEditorIntent(url, packageName) {
  const withoutScheme=url.replace(/^https:\/\//i, "");
  const fallback=encodeURIComponent(`https://play.google.com/store/apps/details?id=${packageName}`);
  return `intent://${withoutScheme}#Intent;scheme=https;package=${packageName};S.browser_fallback_url=${fallback};end`;
}
function editorInfo(item) {
  if(!item || item.folder || isMacroOffice(item)) return null;
  const ext=extension(item.name), mime=item.mimeType||"", id=encodeURIComponent(item.id);
  if(mime==="application/vnd.google-apps.document"||["doc","docx","odt","rtf","txt"].includes(ext)) {
    const url=`https://docs.google.com/document/d/${id}/edit?usp=drivesdk`;
    return {app:"Documentos de Google",label:isAndroidDevice()?"Editar en Google Docs":"Editar original",url,androidPackage:"com.google.android.apps.docs.editors.docs"};
  }
  if(mime==="application/vnd.google-apps.spreadsheet"||["xls","xlsx","ods","csv","tsv"].includes(ext)) {
    const url=`https://docs.google.com/spreadsheets/d/${id}/edit?usp=drivesdk`;
    return {app:"Hojas de cálculo de Google",label:isAndroidDevice()?"Editar en Hojas de cálculo":"Editar original",url,androidPackage:"com.google.android.apps.docs.editors.sheets"};
  }
  if(mime==="application/vnd.google-apps.presentation"||["ppt","pptx","odp"].includes(ext)) {
    const url=`https://docs.google.com/presentation/d/${id}/edit?usp=drivesdk`;
    return {app:"Presentaciones de Google",label:isAndroidDevice()?"Editar en Presentaciones":"Editar original",url,androidPackage:"com.google.android.apps.docs.editors.slides"};
  }
  return null;
}
function openInGoogleEditor(item) {
  if(!navigator.onLine){toast("Necesitas conexión para editar este documento.","error");return;}
  if(isMacroOffice(item)){
    toast("Este archivo contiene macros. Para no dañarlas, edítalo en la laptop con Microsoft Office y Google Drive para ordenadores.","error");
    return;
  }
  const editor=editorInfo(item);
  if(!editor){toast("Este tipo de archivo no admite edición directa desde el celular.","error");return;}
  if(isAndroidDevice() && editor.androidPackage){
    toast(`Abriendo el archivo original en ${editor.app}. No elijas Microsoft Word; los cambios se guardarán en el mismo archivo de Drive.`);
    window.location.href=buildAndroidEditorIntent(editor.url,editor.androidPackage);
    return;
  }
  toast(`Abriendo el archivo original en ${editor.app}. Los cambios se guardarán automáticamente en Google Drive.`);
  window.open(editor.url,"_blank","noopener");
}
function parseExpediente(name="") {
  const clean=name.replace(/_/g," ").trim();
  const match=clean.match(/^(\d{1,5}(?:\s*(?:y|[-/])\s*\d{1,5})?\s*-\s*20\d{2})[\s_-]*(.*)$/i);
  return match ? {order:match[1].replace(/\s+/g," "), company:match[2]||"Sin razón social indicada"} : {order:"EXPEDIENTE",company:clean};
}
function setConnection(type, text) { els.connectionBadge.className=`status-pill status-${type}`; els.connectionBadge.textContent=text; }
function showLoading(show=true) {
  loading=show;
  // La actualización se ejecuta sin bloquear ni ocultar los documentos ya visibles.
  els.loading.hidden=true;
  if(show){
    els.emptyState.hidden=true;
    if(accessToken) setConnection("sync","Actualizando");
  }
}
function showNotice(message="", kind="warn") { els.notice.hidden=!message; els.notice.textContent=message; els.notice.style.background=kind==="error"?"#fff0ef":"#fff8dc"; els.notice.style.color=kind==="error"?"#8b1e18":"#6f5700"; }
function toast(message, type="success") { const node=document.createElement("div"); node.className=`toast ${type}`; node.textContent=message; els.toastContainer.append(node); setTimeout(()=>node.remove(),4200); }
function cacheState() { try { localStorage.setItem(CACHE_KEY, JSON.stringify({rootFolders, savedAt:new Date().toISOString()})); } catch {} }
function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } }
function getFavorites() { try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY))||[]); } catch { return new Set(); } }
function setFavorites(set) { localStorage.setItem(FAV_KEY, JSON.stringify([...set])); }
function escapeQuery(value="") { return value.replace(/\\/g,"\\\\").replace(/'/g,"\\'"); }
function normalizeFile(file) {
  const isFolder=file.mimeType===FOLDER_MIME;
  return {
    id:file.id,
    name:file.name,
    mimeType:file.mimeType,
    size:Number(file.size||0),
    folder:isFolder?{childCount:null}:null,
    file:isFolder?null:{mimeType:file.mimeType},
    webUrl:file.webViewLink||`https://drive.google.com/open?id=${encodeURIComponent(file.id)}`,
    webContentLink:file.webContentLink||"",
    lastModifiedDateTime:file.modifiedTime,
    createdDateTime:file.createdTime,
    parents:file.parents||[],
    parentReference:{id:file.parents?.[0]||"",path:""}
  };
}

async function waitForGoogle(timeoutMs=15000) {
  const started=Date.now();
  while(!(window.google?.accounts?.oauth2)) {
    if(Date.now()-started>timeoutMs) throw new Error("No se pudo cargar el inicio de sesión de Google. Revisa internet y vuelve a abrir la aplicación.");
    await new Promise(r=>setTimeout(r,150));
  }
}
async function initializeAuth() {
  els.redirectUriText.textContent=getAuthorizedOrigin();
  if (!config.clientId) {
    showLogin();
    els.loginHelp.textContent="Cuenta Google configurada: paulus.iuris@gmail.com. Falta colocar el Client ID de Google Cloud.";
    return;
  }
  try {
    await waitForGoogle();
    tokenClient=google.accounts.oauth2.initTokenClient({
      client_id:config.clientId,
      scope:GOOGLE_SCOPE,
      hint:config.preferredEmail||undefined,
      callback:handleTokenResponse,
      error_callback:(error)=>{ console.error(error); toast("No se pudo completar el inicio de sesión con Google.","error"); }
    });
    showLogin();
    els.loginHelp.textContent=`Cuenta autorizada: ${config.preferredEmail}.`;
  } catch(error) {
    console.error(error);
    showLogin();
    els.loginHelp.textContent=friendlyError(error);
  }
}
function showLogin() { els.loginScreen.style.display="grid"; }
function hideLogin() { els.loginScreen.style.display="none"; }
async function login() {
  if(!config.clientId){openSetup();return;}
  if(!tokenClient){await initializeAuth(); if(!tokenClient)return;}
  tokenClient.requestAccessToken({prompt:"select_account"});
}
async function handleTokenResponse(response) {
  if(response?.error){toast(response.error_description||response.error,"error");return;}
  accessToken=response.access_token||"";
  if(!accessToken){toast("Google no devolvió un permiso de acceso.","error");return;}
  try {
    const profileResponse=await fetch("https://www.googleapis.com/oauth2/v3/userinfo",{headers:{Authorization:`Bearer ${accessToken}`}});
    if(!profileResponse.ok) throw new Error("No se pudo comprobar la cuenta de Google.");
    account=await profileResponse.json();
    if(config.preferredEmail && account.email && account.email.toLowerCase()!==config.preferredEmail.toLowerCase()) {
      const detectedEmail=account.email;
      google.accounts.oauth2.revoke(accessToken,()=>{});
      accessToken="";
      account=null;
      throw new Error(`Se abrió una cuenta distinta (${detectedEmail}). Ingresa con ${config.preferredEmail}.`);
    }
    await enterApp();
  } catch(error) {
    console.error(error);
    showLogin();
    toast(friendlyError(error),"error");
  }
}
async function logout() {
  const token=accessToken;
  accessToken=""; account=null; rootItem=null; clearInterval(autoRefreshTimer);
  if(token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token,()=>{});
  showLogin(); setConnection("offline","Sin conexión");
}
function friendlyError(error) {
  const msg=error?.message||String(error||"Error desconocido");
  if(/origin|redirect_uri_mismatch|Not a valid origin/i.test(msg)) return "La dirección de esta aplicación no está registrada como origen autorizado en Google Cloud.";
  if(/insufficient|permission|forbidden|403/i.test(msg)) return "Falta autorizar el acceso a Google Drive o la API de Google Drive no está habilitada.";
  if(/network|fetch|Failed to fetch/i.test(msg)) return "No hay conexión con Google. Revisa internet.";
  if(/401|invalid_token|unauthenticated/i.test(msg)) return "La sesión venció. Cierra sesión e ingresa nuevamente.";
  return msg.length>220?`${msg.slice(0,220)}…`:msg;
}
async function googleFetch(url, options={}, attempt=0) {
  if(!accessToken) throw new Error("No existe una sesión activa con Google.");
  const headers=new Headers(options.headers||{});
  headers.set("Authorization",`Bearer ${accessToken}`);
  if(options.body && typeof options.body==="string" && !headers.has("Content-Type")) headers.set("Content-Type","application/json; charset=UTF-8");
  const response=await fetch(url,{...options,headers});
  if((response.status===429||response.status>=500)&&attempt<3){const wait=Number(response.headers.get("Retry-After")||2)*(attempt+1)*1000;await new Promise(r=>setTimeout(r,wait));return googleFetch(url,options,attempt+1);}
  if(response.status===401){accessToken="";throw new Error("La sesión de Google venció. Ingresa nuevamente.");}
  if(!response.ok){let detail="";try{const data=await response.json();detail=data.error?.message||data.error_description||"";}catch{}throw new Error(detail||`Google Drive respondió ${response.status}.`);}
  if(response.status===204)return null;
  const ct=response.headers.get("content-type")||"";
  return ct.includes("application/json")?response.json():response;
}
async function driveList(q, extra={}) {
  const params=new URLSearchParams({
    q,
    spaces:"drive",
    pageSize:"1000",
    orderBy:extra.orderBy||"folder,name",
    fields:"nextPageToken,files(id,name,mimeType,size,webViewLink,webContentLink,modifiedTime,createdTime,parents,trashed)"
  });
  let pageToken=""; const values=[];
  do {
    if(pageToken)params.set("pageToken",pageToken);else params.delete("pageToken");
    const data=await googleFetch(`${DRIVE_API}/files?${params.toString()}`);
    values.push(...(data.files||[]).map(normalizeFile));
    pageToken=data.nextPageToken||"";
  } while(pageToken);
  return values;
}
async function ensureRootFolder() {
  const q=`name = '${escapeQuery(config.rootFolder)}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`;
  const found=await driveList(q);
  if(found.length){rootItem=found[0];return;}
  const created=await googleFetch(`${DRIVE_API}/files?fields=id,name,mimeType,webViewLink,modifiedTime,createdTime,parents`,{
    method:"POST",
    body:JSON.stringify({name:config.rootFolder,mimeType:FOLDER_MIME,parents:["root"]})
  });
  rootItem=normalizeFile(created);
  toast(`Se creó la carpeta central ${rootItem.name}.`);
}
async function listChildren(itemId) {
  return driveList(`'${escapeQuery(itemId)}' in parents and trashed = false`);
}
function invalidateRepositoryIndex() {
  repositoryIndex = [];
  repositoryIndexUpdatedAt = 0;
  repositoryIndexGeneration++;
}
function isRepositoryIndexFresh() {
  return repositoryIndex.length > 0 && Date.now() - repositoryIndexUpdatedAt < SEARCH_INDEX_TTL_MS;
}
function buildItemPath(item, byId) {
  const names=[item.name];
  let parentId=item.parents?.[0]||"";
  let insideRoot=false;
  let guard=0;
  while(parentId && guard++<100){
    if(parentId===rootItem.id){insideRoot=true;break;}
    const parent=byId.get(parentId);
    if(!parent)break;
    names.unshift(parent.name);
    parentId=parent.parents?.[0]||"";
  }
  return insideRoot?names.join(" / "):"";
}
async function buildRepositoryIndex() {
  // Una sola consulta paginada a Mi unidad es mucho más rápida que abrir carpeta por carpeta.
  const all=await driveList("trashed = false",{orderBy:"folder,name"});
  const byId=new Map(all.map(item=>[item.id,item]));
  const indexed=[];
  for(const item of all){
    if(item.id===rootItem.id)continue;
    const searchPath=buildItemPath(item,byId);
    if(!searchPath)continue;
    const parts=searchPath.split(" / ");
    const searchLocation=parts.length>1?parts.slice(0,-1).join(" › "):"Repositorio central";
    const normalizedName=normalizeSearchText(item.name);
    const searchText=normalizeSearchText(searchPath);
    indexed.push({
      ...item,
      searchPath,
      searchLocation,
      searchText,
      normalizedName,
      nameWords:normalizedName.split(" ").filter(Boolean),
      pathWords:searchText.split(" ").filter(Boolean)
    });
  }
  return indexed;
}
async function getRepositoryIndex({force=false}={}) {
  if(!force&&isRepositoryIndexFresh())return repositoryIndex;
  if(repositoryIndexPromise)return repositoryIndexPromise;
  const generation=repositoryIndexGeneration;
  repositoryIndexPromise=buildRepositoryIndex()
    .then(items=>{
      if(generation===repositoryIndexGeneration){
        repositoryIndex=items;
        repositoryIndexUpdatedAt=Date.now();
      }
      return items;
    })
    .finally(()=>{repositoryIndexPromise=null;});
  return repositoryIndexPromise;
}
function warmRepositoryIndex() {
  setTimeout(()=>getRepositoryIndex().catch(error=>console.warn("No se pudo preparar el índice de búsqueda",error)),1200);
}
function cancelSearchInteraction() {
  clearTimeout(searchTimer);
  searchRunId++;
  loading=false;
  els.loading.hidden=true;
}
function tokenStartsInWords(token, words) {
  return words.some(word=>word.startsWith(token));
}
function getSearchMatchInfo(item, normalizedQuery, tokens) {
  const ownText=item.normalizedName||normalizeSearchText(item.name);
  const fullText=item.searchText||ownText;
  const ownWords=item.nameWords||ownText.split(" ").filter(Boolean);
  const pathWords=item.pathWords||fullText.split(" ").filter(Boolean);
  const compactOwn=ownText.replace(/\s+/g,"");
  const compactQuery=normalizedQuery.replace(/\s+/g,"");

  // Búsqueda predictiva: cada término escrito debe ser el inicio de una
  // palabra o número del nombre. Ej.: LI -> LIQUIDACIONES; 15 -> 1599.
  const ownPrefix=tokens.every(token=>tokenStartsInWords(token,ownWords));
  const pathPrefix=tokens.every(token=>tokenStartsInWords(token,pathWords));

  // Para consultas de 3 o más caracteres conservamos una coincidencia
  // secundaria por contenido, útil para razones sociales o nombres largos.
  const allowContains=normalizedQuery.replace(/\s+/g,"").length>=3;
  const ownContains=allowContains&&tokens.every(token=>ownText.includes(token));
  const pathContains=allowContains&&tokens.every(token=>fullText.includes(token));

  if(!ownPrefix&&!ownContains&&!pathPrefix&&!pathContains)return null;

  // Una carpeta solo aparece cuando coincide por su propio nombre. Así se
  // evitan resultados genéricos como PDF, ANEXOS o ESCANEOS por la ruta.
  const ownMatch=ownPrefix||ownContains;
  if(!ownMatch&&item.folder)return null;

  let score=20;
  let matchType="path";

  if(ownText===normalizedQuery||compactOwn===compactQuery){score=0;matchType="exact";}
  else if(ownText.startsWith(normalizedQuery)||compactOwn.startsWith(compactQuery)){score=1;matchType="name-start";}
  else if(ownPrefix&&item.folder){score=2;matchType="word-start";}
  else if(ownPrefix){score=3;matchType="word-start";}
  else if(ownContains&&item.folder){score=4;matchType="name-contains";}
  else if(ownContains){score=5;matchType="name-contains";}
  else if(pathPrefix){score=6;matchType="path-start";}
  else {score=7;matchType="path-contains";}

  const depth=(item.searchPath||item.name||"").split(" / ").length;
  return {item:{...item,searchMatchType:matchType},score,depth};
}
async function scopedSearch(query) {
  const all=await getRepositoryIndex();
  const normalized=normalizeSearchText(query);
  const tokens=normalized.split(" ").filter(Boolean);
  if(!tokens.length||normalized.replace(/\s+/g,"").length<SEARCH_MIN_CHARS)return [];

  return all
    .map(item=>getSearchMatchInfo(item,normalized,tokens))
    .filter(Boolean)
    .sort((a,b)=>
      a.score-b.score||
      a.depth-b.depth||
      (a.item.folder===b.item.folder?0:a.item.folder?-1:1)||
      a.item.name.localeCompare(b.item.name,"es",{numeric:true,sensitivity:"base"})
    )
    .map(result=>result.item);
}

async function enterApp() {
  hideLogin(); setConnection("sync","Conectando");
  const initial=(account?.name||account?.email||"P").trim().charAt(0).toUpperCase();
  els.accountBtn.textContent=initial||"P";
  try { await ensureRootFolder(); await loadDashboard(); setConnection("online","Sincronizado"); startAutoRefresh(); warmRepositoryIndex(); }
  catch(error) { console.error(error); setConnection("offline","Sin conexión"); showNotice(friendlyError(error),"error"); renderCacheFallback(); }
}
async function loadDashboard(silent=false) {
  if(silent&&(loading||silentRefreshing))return;
  if(!silent){cancelSearchInteraction();}
  if(silent)silentRefreshing=true;else showLoading(true);
  if(!silent)showNotice("");
  currentView="dashboard";currentFolder=null;updateViewHeader();
  try {
    const children=await listChildren(rootItem.id);
    rootFolders=children.filter(i=>i.folder).sort((a,b)=>a.name.localeCompare(b.name,"es",{numeric:true}));
    currentItems=rootFolders;cacheState();renderItems(rootFolders);updateStats(rootFolders,children.filter(i=>!i.folder).length);renderBreadcrumb();setConnection("online","Sincronizado");
  } catch(error) {
    setConnection("offline","Sin conexión");
    if(!silent){showNotice(friendlyError(error),"error");renderCacheFallback();}
  } finally {
    if(silent)silentRefreshing=false;else showLoading(false);
  }
}
function renderCacheFallback(){const cache=readCache();if(cache?.rootFolders?.length){rootFolders=cache.rootFolders;currentItems=rootFolders;renderItems(rootFolders);showNotice(`Mostrando el último índice guardado (${formatDate(cache.savedAt)}). Los documentos requieren conexión para abrirse.`);}else{els.emptyState.hidden=false;}showLoading(false);}
async function openFolder(item,silent=false) {
  if(silent&&(loading||silentRefreshing))return;
  if(!silent){cancelSearchInteraction();}
  if(silent)silentRefreshing=true;else showLoading(true);
  currentFolder=item;currentView="folder";updateViewHeader();
  try { const items=await listChildren(item.id);currentItems=items;renderItems(items);updateStats(rootFolders,items.filter(i=>!i.folder).length);renderBreadcrumb();setConnection("online","Sincronizado"); }
  catch(error){if(!silent)showNotice(friendlyError(error),"error");}
  finally{if(silent)silentRefreshing=false;else showLoading(false);}
}
async function performSearch() {
  const runId=++searchRunId;
  const query=els.searchInput.value.trim();
  const normalizedQuery=normalizeSearchText(query);
  if(!query){
    showNotice("");
    showLoading(false);
    if(currentFolder)return openFolder(currentFolder,false);
    return loadDashboard(false);
  }
  if(normalizedQuery.replace(/\s+/g,"").length<SEARCH_MIN_CHARS){
    cancelSearchInteraction();
    showNotice(`Escribe al menos ${SEARCH_MIN_CHARS} caracteres para buscar en todo el repositorio.`);
    return;
  }
  showLoading(true);showNotice("");currentView="search";updateViewHeader();
  try {
    let matches=await scopedSearch(query);
    if(runId!==searchRunId)return;
    matches=applyTypeFilter(matches);
    const total=matches.length;
    const items=matches.slice(0,SEARCH_RESULT_LIMIT);
    currentItems=items;
    renderItems(items,true);
    updateStats(rootFolders,items.filter(i=>!i.folder).length);
    renderBreadcrumb();
    if(total===0)showNotice(`No se encontraron carpetas ni documentos que empiecen con “${query}”. Prueba con otro inicio o escribe más caracteres.`);
    else if(total>items.length)showNotice(`Se encontraron ${total.toLocaleString("es-PE")} coincidencias. Se muestran las primeras ${items.length.toLocaleString("es-PE")}; escribe más caracteres para afinar la búsqueda.`);
    setConnection("online","Sincronizado");
  }
  catch(error){if(runId===searchRunId)showNotice(friendlyError(error),"error");}
  finally{if(runId===searchRunId)showLoading(false);}
}
function applyTypeFilter(items){const values=els.typeFilter.value.split(",").filter(Boolean);if(!values.length)return items;return items.filter(i=>currentView==="search"?!i.folder&&values.includes(extension(i.name)):i.folder||values.includes(extension(i.name)));}
async function loadRecent(){showLoading(true);currentView="recent";currentFolder=null;updateViewHeader();try{const all=await getRepositoryIndex();const files=all.filter(i=>!i.folder).sort((a,b)=>new Date(b.lastModifiedDateTime)-new Date(a.lastModifiedDateTime)).slice(0,100);currentItems=files;renderItems(applyTypeFilter(files),true);updateStats(rootFolders,files.length);renderBreadcrumb();setConnection("online","Sincronizado");}catch(e){showNotice(friendlyError(e),"error");}finally{showLoading(false);}}
function loadFavorites(){currentView="favorites";currentFolder=null;updateViewHeader();const fav=getFavorites();const cached=readCache()?.rootFolders||rootFolders;const items=cached.filter(i=>fav.has(i.id));currentItems=items;renderItems(items);updateStats(rootFolders,items.length);renderBreadcrumb();}
function loadTrash(){currentView="trash";currentFolder=null;updateViewHeader();els.content.innerHTML=`<article class="folder-card"><div class="card-top"><div class="item-icon">♲</div><div class="item-info"><h3>Papelera de Google Drive</h3><p>Los elementos eliminados desde este sistema pueden recuperarse desde la papelera de Google Drive.</p></div></div><div class="card-actions"><button class="btn btn-primary" id="openTrashWeb">Abrir papelera</button></div></article>`;els.emptyState.hidden=true;$("openTrashWeb").onclick=()=>window.open("https://drive.google.com/drive/trash","_blank","noopener");renderBreadcrumb();}
function updateViewHeader(){const map={dashboard:["Expedientes de trabajo","Carpetas centrales disponibles en todos tus dispositivos."],folder:[currentFolder?.name||"Carpeta","Documentos y subcarpetas del expediente."],search:["Resultados de búsqueda","Coincidencias en el repositorio central."],recent:["Documentos recientes","Últimos archivos modificados en todos los expedientes."],favorites:["Expedientes favoritos","Accesos marcados en este dispositivo."],trash:["Papelera","Recuperación de documentos eliminados."]};[els.viewTitle.textContent,els.viewSubtitle.textContent]=map[currentView]||map.dashboard;document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===currentView));}
function updateStats(folders,files){els.statFolders.textContent=folders?.length??"—";els.statFiles.textContent=files??"—";els.statSync.textContent=new Intl.DateTimeFormat("es-PE",{hour:"2-digit",minute:"2-digit"}).format(new Date());}
function renderBreadcrumb(){if(currentView==="folder"&&currentFolder){els.breadcrumb.hidden=false;els.breadcrumb.innerHTML=`<button data-root>Expedientes</button><span>›</span><b>${esc(currentFolder.name)}</b>`;els.breadcrumb.querySelector("[data-root]").onclick=loadDashboard;}else{els.breadcrumb.hidden=true;els.breadcrumb.innerHTML="";}}
function renderItems(items,flat=false){
  const filtered=applyTypeFilter(items);els.content.innerHTML="";els.emptyState.hidden=filtered.length>0;if(!filtered.length)return;
  const favs=getFavorites();
  for(const item of filtered){
    const isFolder=!!item.folder, parsed=isFolder?parseExpediente(item.name):null, [cls,label]=iconClass(item), editor=editorInfo(item), macro=isMacroOffice(item);
    const card=document.createElement("article");card.className=isFolder?"folder-card":"file-card";
    const actions=isFolder
      ? '<button class="btn btn-secondary open-item">Abrir expediente</button>'
      : editor
        ? `<button class="btn btn-secondary open-item">Ver</button><button class="btn btn-primary edit-item">✎ ${esc(editor.label)}</button>`
        : '<button class="btn btn-secondary open-item">Abrir</button><button class="btn btn-ghost download-item">Descargar</button>';
    const editBadge=editor?'<span class="edit-badge">Edición directa</span>':macro?'<span class="macro-badge">Conserva macros</span>':'';
    card.innerHTML=`<div class="card-top"><div class="item-icon ${cls}">${label}</div><div class="item-info">${isFolder?`<span class="order-chip">${esc(parsed.order)}</span><h3>${esc(parsed.company)}</h3><p>${esc(item.name)}</p>`:`<h3>${esc(item.name)}</h3><p>${flat?esc(item.searchLocation||"Repositorio central"):"Documento del expediente"}</p>`}</div><button class="more-btn" aria-label="Más acciones">⋮</button></div><div class="card-meta"><span>${isFolder?"Carpeta sincronizada":formatBytes(item.size)}</span><span>Modificado: ${formatDate(item.lastModifiedDateTime)}</span>${editBadge}${favs.has(item.id)?"<span>★ Favorito</span>":""}</div><div class="card-actions">${actions}</div>`;
    card.querySelector(".open-item").onclick=()=>isFolder?openFolder(item):openItem(item);
    card.querySelector(".edit-item")?.addEventListener("click",()=>openInGoogleEditor(item));
    card.querySelector(".more-btn").onclick=()=>openItemActions(item);
    card.querySelector(".download-item")?.addEventListener("click",()=>downloadItem(item));
    els.content.append(card);
  }
}
function openItem(item){if(!navigator.onLine){toast("Este documento necesita conexión o estar disponible sin conexión en Google Drive.","error");return;}window.open(item.webUrl,"_blank","noopener");}
function downloadItem(item){if(item.mimeType?.startsWith("application/vnd.google-apps.")){window.open(item.webUrl,"_blank","noopener");return;}window.open(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(item.id)}`,"_blank","noopener");}

function openItemActions(item){
  const favs=getFavorites(),isFav=favs.has(item.id),editor=editorInfo(item),macro=isMacroOffice(item);
  openModal(els.actionModal);els.actionTitle.textContent=item.name;
  els.actionBody.innerHTML=`<div class="context-menu"><button data-act="open">↗ ${item.folder?"Abrir carpeta":"Ver documento"}</button>${editor?`<button data-act="edit">✎ ${esc(editor.label)}</button>`:macro?'<button data-act="macro">ⓘ Cómo editar sin perder macros</button>':''}${!item.folder?'<button data-act="download">⇩ Descargar</button>':''}<button data-act="rename">✎ Cambiar nombre</button><button data-act="move">⇄ Mover</button><button data-act="favorite">${isFav?"☆ Quitar de favoritos":"★ Agregar a favoritos"}</button><button data-act="delete" style="color:var(--danger)">♲ Enviar a la papelera</button></div>`;
  els.actionFooter.innerHTML="";
  els.actionBody.querySelector('[data-act="open"]').onclick=()=>{closeModals();item.folder?openFolder(item):openItem(item)};
  els.actionBody.querySelector('[data-act="edit"]')?.addEventListener("click",()=>{closeModals();openInGoogleEditor(item);});
  els.actionBody.querySelector('[data-act="macro"]')?.addEventListener("click",()=>{closeModals();toast("Para conservar las macros, abre este archivo desde Google Drive para ordenadores en la laptop y edítalo con Microsoft Office.","error");});
  els.actionBody.querySelector('[data-act="download"]')?.addEventListener("click",()=>{closeModals();downloadItem(item);});
  els.actionBody.querySelector('[data-act="rename"]').onclick=()=>showRename(item);
  els.actionBody.querySelector('[data-act="move"]').onclick=()=>showMove(item);
  els.actionBody.querySelector('[data-act="favorite"]').onclick=()=>{isFav?favs.delete(item.id):favs.add(item.id);setFavorites(favs);closeModals();toast(isFav?"Se quitó de favoritos.":"Se agregó a favoritos.");renderItems(currentItems,currentView==="search"||currentView==="recent");};
  els.actionBody.querySelector('[data-act="delete"]').onclick=()=>showDelete(item);
}
function showRename(item){els.actionTitle.textContent="Cambiar nombre";els.actionBody.innerHTML=`<label>Nuevo nombre<input id="renameInput" value="${esc(item.name)}"></label>`;els.actionFooter.innerHTML=`<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" id="confirmRename">Guardar</button>`;els.actionFooter.querySelector("[data-cancel]").onclick=closeModals;$("confirmRename").onclick=async()=>{const name=$("renameInput").value.trim();if(!name)return;try{await googleFetch(`${DRIVE_API}/files/${encodeURIComponent(item.id)}?fields=id,name`,{method:"PATCH",body:JSON.stringify({name})});closeModals();toast("Nombre actualizado.");invalidateRepositoryIndex();await refreshCurrent();}catch(e){toast(friendlyError(e),"error");}};}
function showMove(item){const destinations=rootFolders.filter(f=>f.id!==item.id);els.actionTitle.textContent="Mover elemento";els.actionBody.innerHTML=`<label>Carpeta de destino<select id="moveDestination">${destinations.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></label><p class="form-note">El movimiento se sincronizará automáticamente en todos tus dispositivos.</p>`;els.actionFooter.innerHTML=`<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" id="confirmMove">Mover</button>`;els.actionFooter.querySelector("[data-cancel]").onclick=closeModals;$("confirmMove").onclick=async()=>{const id=$("moveDestination").value;if(!id)return;try{let oldParent=item.parents?.[0]||item.parentReference?.id||"";if(!oldParent){const data=await googleFetch(`${DRIVE_API}/files/${encodeURIComponent(item.id)}?fields=parents`);oldParent=data.parents?.[0]||"";}const params=new URLSearchParams({addParents:id,fields:"id,parents"});if(oldParent)params.set("removeParents",oldParent);await googleFetch(`${DRIVE_API}/files/${encodeURIComponent(item.id)}?${params.toString()}`,{method:"PATCH",body:JSON.stringify({})});closeModals();toast("Elemento movido.");invalidateRepositoryIndex();await refreshCurrent();}catch(e){toast(friendlyError(e),"error");}};}
function showDelete(item){els.actionTitle.textContent="Enviar a la papelera";els.actionBody.innerHTML=`<p>¿Deseas eliminar <b>${esc(item.name)}</b>?</p><p class="form-note">Google Drive lo enviará a la papelera, desde donde podrá recuperarse.</p>`;els.actionFooter.innerHTML=`<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-danger" id="confirmDelete">Eliminar</button>`;els.actionFooter.querySelector("[data-cancel]").onclick=closeModals;$("confirmDelete").onclick=async()=>{try{await googleFetch(`${DRIVE_API}/files/${encodeURIComponent(item.id)}?fields=id,trashed`,{method:"PATCH",body:JSON.stringify({trashed:true})});closeModals();toast("Elemento enviado a la papelera.");invalidateRepositoryIndex();await refreshCurrent();}catch(e){toast(friendlyError(e),"error");}};}

function showNewFolder(){openModal(els.actionModal);els.actionTitle.textContent="Nueva carpeta";els.actionBody.innerHTML=`<label>Nombre de la carpeta<input id="newFolderName" placeholder="Ej.: 2200-2026_EMPRESA S.A.C."></label>`;els.actionFooter.innerHTML=`<button class="btn btn-ghost" data-cancel>Cancelar</button><button class="btn btn-primary" id="confirmFolder">Crear</button>`;els.actionFooter.querySelector("[data-cancel]").onclick=closeModals;$("confirmFolder").onclick=async()=>{const name=$("newFolderName").value.trim();if(!name)return;const parent=currentFolder||rootItem;try{await googleFetch(`${DRIVE_API}/files?fields=id,name,mimeType,webViewLink,modifiedTime,createdTime,parents`,{method:"POST",body:JSON.stringify({name,mimeType:FOLDER_MIME,parents:[parent.id]})});closeModals();toast("Carpeta creada.");invalidateRepositoryIndex();await refreshCurrent();}catch(e){toast(friendlyError(e),"error");}};}
async function handleUpload(files){if(!files?.length)return;const parent=currentFolder||rootItem;openModal(els.actionModal);els.actionTitle.textContent="Subiendo documentos";els.actionBody.innerHTML=`<div class="file-list">${[...files].map((f,i)=>`<div class="file-row"><div><b>${esc(f.name)}</b><small>${formatBytes(f.size)}</small></div><span id="upStatus${i}">Pendiente</span></div>`).join("")}</div><div class="progress" style="margin-top:14px"><span id="uploadProgress"></span></div>`;els.actionFooter.innerHTML=`<button class="btn btn-ghost" id="hideUpload">Continuar en segundo plano</button>`;$("hideUpload").onclick=closeModals;let completed=0;for(let i=0;i<files.length;i++){const file=files[i],status=$("upStatus"+i);try{status.textContent="Subiendo…";await uploadFile(parent.id,file,p=>{const overall=((completed+p)/files.length)*100;const bar=$("uploadProgress");if(bar)bar.style.width=`${overall}%`;});status.textContent="Listo";}catch(e){status.textContent="Error";status.style.color="var(--danger)";toast(`${file.name}: ${friendlyError(e)}`,"error");}completed++;const bar=$("uploadProgress");if(bar)bar.style.width=`${completed/files.length*100}%`;}toast("Carga finalizada.");setTimeout(closeModals,700);els.fileInput.value="";invalidateRepositoryIndex();await refreshCurrent();}
async function uploadFile(parentId,file,onProgress){
  if(!accessToken)throw new Error("No existe una sesión activa con Google.");
  const sessionResponse=await fetch(`${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink,webContentLink,modifiedTime,createdTime,parents`,{
    method:"POST",
    headers:{Authorization:`Bearer ${accessToken}`,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Type":file.type||"application/octet-stream","X-Upload-Content-Length":String(file.size)},
    body:JSON.stringify({name:file.name,parents:[parentId]})
  });
  if(!sessionResponse.ok){let detail="";try{detail=(await sessionResponse.json()).error?.message||"";}catch{}throw new Error(detail||`No se pudo iniciar la carga (${sessionResponse.status}).`);}
  const sessionUrl=sessionResponse.headers.get("Location");
  if(!sessionUrl)throw new Error("Google Drive no devolvió la dirección de carga.");
  const chunkSize=8*1024*1024; let start=0;
  while(start<file.size){
    const end=Math.min(start+chunkSize,file.size); const chunk=file.slice(start,end);
    const response=await fetch(sessionUrl,{method:"PUT",headers:{"Content-Length":String(end-start),"Content-Range":`bytes ${start}-${end-1}/${file.size}`},body:chunk});
    if(response.status!==308&&!response.ok){let detail="";try{detail=(await response.json()).error?.message||"";}catch{}throw new Error(detail||`Error de carga ${response.status}.`);}
    start=end; onProgress(start/file.size);
  }
}

function openSetup(){els.clientIdInput.value=config.clientId||"";els.rootFolderInput.value=config.rootFolder||"EXPEDIENTES_SUNAFIL";if(els.preferredEmailInput)els.preferredEmailInput.value=config.preferredEmail||"paulus.iuris@gmail.com";els.redirectUriText.textContent=getAuthorizedOrigin();openModal(els.setupModal);}
function openModal(modal){els.modalBackdrop.hidden=false;modal.hidden=false;}
function closeModals(){els.modalBackdrop.hidden=true;els.setupModal.hidden=true;els.actionModal.hidden=true;}
async function refreshCurrent({silent=false}={}){
  if(!accessToken){showLogin();return;}
  if(currentView==="folder"&&currentFolder)return openFolder(currentFolder,silent);
  if(silent&&(currentView!=="dashboard"&&currentView!=="folder"))return;
  if(currentView==="recent")return loadRecent();
  if(currentView==="favorites")return loadFavorites();
  if(currentView==="search")return performSearch();
  return loadDashboard(silent);
}
function navigate(view){cancelSearchInteraction();els.searchInput.value="";if(view==="dashboard")loadDashboard();else if(view==="recent")loadRecent();else if(view==="favorites")loadFavorites();else if(view==="trash")loadTrash();}
function startAutoRefresh(){clearInterval(autoRefreshTimer);autoRefreshTimer=setInterval(()=>{if(document.visibilityState==="visible"&&navigator.onLine&&!loading&&!silentRefreshing&&accessToken&&(currentView==="dashboard"||currentView==="folder"))refreshCurrent({silent:true});},AUTO_REFRESH_MS);}

els.loginBtn.onclick=login;els.openSetupBtn.onclick=openSetup;els.settingsBtn.onclick=openSetup;els.mobileSettingsBtn.onclick=openSetup;els.logoutBtn.onclick=logout;els.refreshBtn.onclick=()=>{invalidateRepositoryIndex();refreshCurrent({silent:false});};els.accountBtn.onclick=()=>{toast(account?.email||account?.name||"Sesión Google activa");};
els.saveSetupBtn.onclick=()=>{const clientId=els.clientIdInput.value.trim(),rootFolder=els.rootFolderInput.value.trim()||"EXPEDIENTES_SUNAFIL",preferredEmail=(els.preferredEmailInput?.value||"paulus.iuris@gmail.com").trim();if(!/^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(clientId)){toast("El Client ID de Google debe terminar en .apps.googleusercontent.com.","error");return;}if(!/^\S+@\S+\.\S+$/.test(preferredEmail)){toast("Escribe un correo de Google válido.","error");return;}saveConfig({clientId,rootFolder,preferredEmail});closeModals();location.reload();};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=closeModals);els.modalBackdrop.onclick=closeModals;
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>navigate(b.dataset.view));
els.searchInput.addEventListener("input",()=>{
  clearTimeout(searchTimer);
  if(!els.searchInput.value.trim()){
    cancelSearchInteraction();
    performSearch();
    return;
  }
  searchTimer=setTimeout(performSearch,SEARCH_DEBOUNCE_MS);
});
els.clearSearchBtn.onclick=()=>{
  els.searchInput.value="";
  cancelSearchInteraction();
  showNotice("");
  if(currentFolder)openFolder(currentFolder,false);
  else loadDashboard(false);
};
els.typeFilter.onchange=()=>{if(els.searchInput.value.trim())performSearch();else renderItems(currentItems,currentView==="recent"||currentView==="search");};
els.uploadBtn.onclick=()=>els.fileInput.click();els.mobileUploadBtn.onclick=()=>els.fileInput.click();els.fileInput.onchange=()=>handleUpload(els.fileInput.files);els.newFolderBtn.onclick=showNewFolder;
window.addEventListener("online",()=>{setConnection("sync","Actualizando");if(accessToken)refreshCurrent();});window.addEventListener("offline",()=>setConnection("offline","Sin conexión"));
window.addEventListener("error",e=>console.error("Error global",e.error||e.message));
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(console.warn);

initializeAuth();
