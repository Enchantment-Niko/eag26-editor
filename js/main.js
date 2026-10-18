const E_A = '__ASSETS__/', E_U = '__AUDIO__/';
const G_MAGIC = new Uint8Array([71, 65, 73, 85, 83, 86, 80, 49]);

let currentPack = null, currentFmt = null;
let injectFiles = [];
let selectedPaths = new Set();

// 使用全局注入的 Worker 代码
const workerBlob = new Blob([window.WORKER_CODE], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(workerBlob);
let parserWorker = new Worker(workerUrl);

const encodeUtf8 = (s) => new TextEncoder().encode(s);
const decodeUtf8 = (b) => new TextDecoder('utf-8').decode(b);

parserWorker.onmessage = (e) => {
    if (e.data.type === 'log') {
        log(e.data.msg);
        return;
    }
    
    const { status, pack, fmt, message } = e.data;
    if (status === 'ok') {
        if (pack.assets && pack.assets.deleted) pack.assets.deleted = new Set(pack.assets.deleted);
        if (pack.audio && pack.audio.deleted) {
            for (const k in pack.audio.deleted) pack.audio.deleted[k] = new Set(pack.audio.deleted[k]);
        }
        
        currentPack = pack;
        currentFmt = fmt;

        if (currentFmt === 'eagler') {
            log(t('foundEagler'));
            document.getElementById('injectPanel').style.display = 'none';
        } else {
            log(t('foundGaius'));
            document.getElementById('injectPanel').style.display = 'block';
        }

        document.getElementById('editorPanel').style.display = 'flex';
        document.getElementById('btnSaveAs').disabled = false;
        document.getElementById('btnExportRaw').style.display = currentFmt === 'gaius' ? 'inline-flex' : 'none';
        document.getElementById('fileStats').innerText = currentFmt === 'eagler' ? t('formatEagler') : t('formatGaius');
        
        selectedPaths.clear();
        renderTree();
        updateActionButtons();
    } else {
        log(`[X] ${t('unpackError')}: ${message}`);
        clearFile();
    }
};

// 这里继续接上上一版的 async function handleFile 等所有的逻辑代码
async function handleFile(file) {
    document.getElementById('dropText').style.display = 'none';
    document.getElementById('fileInfo').style.display = 'flex';
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('btnSaveAs').disabled = true;

    log(`${t('loading')} ${file.name}`);
    document.getElementById('fileStats').innerText = "解析中... / Parsing...";
    document.getElementById('editorPanel').style.display = 'none';

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    parserWorker.postMessage({ action: 'load', fileData: bytes }, [buffer]);
}

function clearFile(e) {
    if (e) e.stopPropagation();
    currentPack = null;
    document.getElementById('editorPanel').style.display = 'none';
    document.getElementById('btnSaveAs').disabled = true;
    document.getElementById('fileInput').value = '';
    document.getElementById('dropText').style.display = 'block';
    document.getElementById('fileInfo').style.display = 'none';
    document.getElementById('fileName').textContent = '';
    document.getElementById('treeList').innerHTML = '';
    document.getElementById('fileStats').innerText = t('notLoaded');
    selectedPaths.clear();
    allRenderedItems = [];
}

function getPaths() {
    if (!currentPack) return [];
    if (currentFmt === 'gaius') return Object.keys(currentPack.index);
    const ps = new Set(Object.keys(currentPack.res));
    if (currentPack.assets) currentPack.assets.order.forEach(p => ps.add(E_A + p));
    if (currentPack.audio) {
        for (const [lbl, ord] of Object.entries(currentPack.audio.order)) {
            ord.forEach(p => ps.add(E_U + lbl + '/' + p));
        }
    }
    return Array.from(ps).sort();
}

function readFile(p) {
    if (!currentPack) return null;
    if (currentFmt === 'gaius') {
        const r = currentPack.index[p];
        if (!r) return null;
        return currentPack.data.slice(r[0], r[0] + r[1]);
    }
    if (p.startsWith(E_A)) {
        const sub = p.slice(E_A.length), a = currentPack.assets;
        if (a.new[sub]) return a.new[sub];
        if (a.deleted.has(sub)) return null;
        if (a.dirty[sub]) return a.dirty[sub];
        const r = a.ranges[sub];
        return r ? a.blob.slice(r[0], r[0] + r[1]) : null;
    }
    if (p.startsWith(E_U)) {
        const [lbl, sub] = p.slice(E_U.length).split('/', 2);
        const a = currentPack.audio;
        if (!a.ranges[lbl]) return null;
        if (a.new[lbl][sub]) return a.new[lbl][sub];
        if (a.deleted[lbl].has(sub)) return null;
        if (a.dirty[lbl][sub]) return a.dirty[lbl][sub];
        const r = a.ranges[lbl][sub];
        return r ? a.blobs[lbl].slice(r[0], r[0] + r[1]) : null;
    }
    return currentPack.res[p];
}

function writeFile(p, data) {
    if (!currentPack) return;
    if (currentFmt === 'gaius') {
        if (p in currentPack.index) {
            currentPack.data = new Uint8Array([...currentPack.data, ...data]);
            currentPack.index[p] = [currentPack.data.length - data.length, data.length];
        } else {
            currentPack.data = new Uint8Array([...currentPack.data, ...data]);
            currentPack.index[p] = [currentPack.data.length - data.length, data.length];
        }
        return;
    }
    if (p.startsWith(E_A)) {
        const sub = p.slice(E_A.length);
        currentPack.assets.dirty[sub] = data;
        currentPack.assets.deleted.delete(sub);
        if (!currentPack.assets.order.includes(sub)) currentPack.assets.order.push(sub);
        return;
    }
    if (p.startsWith(E_U)) {
        const [lbl, sub] = p.slice(E_U.length).split('/', 2);
        currentPack.audio.dirty[lbl][sub] = data;
        currentPack.audio.deleted[lbl].delete(sub);
        if (!currentPack.audio.order[lbl].includes(sub)) currentPack.audio.order[lbl].push(sub);
        return;
    }
    currentPack.res[p] = data;
}

function deleteFileByPath(p) {
    if (!currentPack) return;
    if (currentFmt === 'gaius') { delete currentPack.index[p]; return; }
    if (p.startsWith(E_A)) { currentPack.assets.deleted.add(p.slice(E_A.length)); return; }
    if (p.startsWith(E_U)) {
        const [lbl, sub] = p.slice(E_U.length).split('/', 2);
        currentPack.audio.deleted[lbl].add(sub);
        return;
    }
    delete currentPack.res[p];
}

function addFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
        if (!e.target.files.length) return;
        const file = e.target.files[0];
        const data = new Uint8Array(await file.arrayBuffer());
        const path = await promptModal('Pack Path:', file.name);
        if (!path) return;
        writeFile(path, data);
        renderTree();
        log(`[Added] ${path}`);
    };
    input.click();
}

function replaceFile() {
    if (selectedPaths.size !== 1) return;
    const p = Array.from(selectedPaths)[0];
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
        if (!e.target.files.length) return;
        const file = e.target.files[0];
        const data = new Uint8Array(await file.arrayBuffer());
        writeFile(p, data);
        log(`[Replaced] ${p}`);
    };
    input.click();
}

async function renameFile() {
    if (selectedPaths.size !== 1) return;
    const p = Array.from(selectedPaths)[0];
    const n = await promptModal('New Path:', p);
    if (!n || n === p) return;
    const d = readFile(p);
    if (!d) return;
    writeFile(n, d);
    deleteFileByPath(p);
    
    selectedPaths.clear();
    selectedPaths.add(n);
    
    renderTree();
    updateActionButtons();
    log(`[Renamed] ${p} -> ${n}`);
}

async function deleteFile() {
    if (selectedPaths.size === 0) return;
    const pArray = Array.from(selectedPaths);
    if (!(await confirmModal(t('deleteConfirm'), pArray.join('\n')))) return;
    for (const p of pArray) {
        deleteFileByPath(p);
    }
    selectedPaths.clear();
    renderTree();
    updateActionButtons();
    log(`[Deleted] ${pArray.length} file(s)`);
}

function exportSelected() {
    if (selectedPaths.size === 0) return;
    const pArray = Array.from(selectedPaths);
    if (pArray.length === 1) {
        const d = readFile(pArray[0]);
        if (!d) return;
        downloadBlob(new Blob([d]), pArray[0].split('/').pop());
    } else {
        const zipData = {};
        for (const p of pArray) {
            const d = readFile(p);
            if (d) zipData[p.split('/').pop()] = d;
        }
        const zipped = pako.gzip(JSON.stringify(zipData));
        downloadBlob(new Blob([zipped]), 'export_selected.gz');
    }
}

function exportAll() {
    const zipData = {};
    for (const p of getPaths()) {
        let out = p;
        if (currentFmt === 'eagler') {
            if (out.startsWith(E_A)) out = 'assets/' + out.slice(E_A.length);
            if (out.startsWith(E_U)) out = 'audio/' + out.slice(E_U.length);
        }
        const d = readFile(p);
        if (d) zipData[out] = d;
    }
    const zipped = pako.gzip(JSON.stringify(zipData));
    downloadBlob(new Blob([zipped]), 'export_all.gz');
}

function exportRaw() {
    if (!currentPack || currentFmt !== 'gaius') return;
    const idx = JSON.stringify(currentPack.index).replace(/ /g, '');
    const idxBytes = encodeUtf8(idx);
    const header = new Uint8Array(12);
    header.set(G_MAGIC, 0);
    new DataView(header.buffer).setUint32(8, idxBytes.length, true);
    const raw = new Uint8Array([...header, ...idxBytes, ...currentPack.data]);
    downloadBlob(new Blob([pako.gzip(raw)]), 'export_raw.gz');
}

function injAdd() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = (e) => {
        for (const f of e.target.files) injectFiles.push(f);
        renderInject();
    };
    input.click();
}
function injRm() { injectFiles = []; renderInject(); }
function injClear() { injectFiles = []; renderInject(); }
function renderInject() {
    const ul = document.getElementById('injectList');
    ul.innerHTML = '';
    injectFiles.forEach((f) => {
        const li = document.createElement('li');
        li.textContent = f.name + ' <- ' + f.size + ' bytes';
        li.style.padding = '4px 0';
        ul.appendChild(li);
    });
}

function rebuildGaiusHtml() {
    const idx = JSON.stringify(currentPack.index).replace(/ /g, '');
    const idxBytes = encodeUtf8(idx);
    const header = new Uint8Array(12);
    header.set(G_MAGIC, 0);
    new DataView(header.buffer).setUint32(8, idxBytes.length, true);
    const raw = new Uint8Array([...header, ...idxBytes, ...currentPack.data]);
    const gz = pako.gzip(raw);
    
    let binary = '';
    for (let i = 0; i < gz.length; i++) binary += String.fromCharCode(gz[i]);
    const b64 = btoa(binary);
    
    const chunks = b64.match(/.{1,8388608}/g) || [];
    const newArr = '[\n' + chunks.map(c => `  "${c}"`).join(',\n') + '\n]';
    let html = currentPack.html.slice(0, currentPack.found.open) + newArr + currentPack.html.slice(currentPack.found.close + 1);
    
    if (document.getElementById('optLocalize').checked) {
        const reps = [
            ['"ONLINE SESSION"', '"在线会话"'], ['"PORTABLE HTML"', '"便携 HTML"'],
            ['"BROWSER CLIENT"', '"浏览器客户端"'], ['VERSION (\\d+\\.\\d+\\.\\d+)', '版本 $1'],
            ['Gaius Client</strong> | independent browser software', 'Gaius 客户端</strong> | 独立浏览器软件'],
            ['HTML runtime | local storage enabled', 'HTML 运行时 | 本地存储已启用'],
            ['Retry startup', '重试启动'], ['Show diagnostics', '显示诊断'],
            ['Hide diagnostics', '隐藏诊断'], ['BROWSER CLIENT', '浏览器客户端'],
            ['Starting Gaius Client 26.3...', '正在启动 Gaius 客户端 26.3...'],
            ['"Loading persistent browser storage..."', '"正在加载浏览器持久化存储..."']
        ];
        for (const [k, v] of reps) html = html.replace(new RegExp(k, 'g'), v);
    }
    return html;
}

function rebuildEaglerHtml() {
    const res = { ...currentPack.res };
    if (currentPack.assets) {
        const a = currentPack.assets;
        const manifests = {}; const ranges = {}; const parts = [];
        let off = 0;
        for (const p of a.order) {
            if (a.deleted.has(p)) continue;
            const d = readFile(E_A + p); if (!d) continue;
            parts.push(d); ranges[p] = [off, d.length]; off += d.length;
            manifests[p] = './' + p;
        }
        const buf = new Uint8Array(off); off = 0;
        for (const p of parts) { buf.set(p, off); off += p.length; }
        res['assets/assets.idx'] = pako.gzip(encodeUtf8(JSON.stringify({ manifest: { assets: manifests }, ranges })));
        res['assets/assets.bin'] = pako.gzip(buf);
    }
    if (currentPack.audio) {
        for (const lbl of Object.keys(currentPack.audio.ranges)) {
            const a = currentPack.audio;
            const manifests = {}; const ranges = {}; const parts = [];
            let off = 0;
            for (const p of a.order[lbl]) {
                if (a.deleted[lbl].has(p)) continue;
                const d = readFile(E_U + lbl + '/' + p); if (!d) continue;
                parts.push(d); ranges[p] = [off, d.length]; off += d.length;
                manifests[p] = './' + p;
            }
            const buf = new Uint8Array(off); off = 0;
            for (const p of parts) { buf.set(p, off); off += p.length; }
            const iname = a.names[lbl].idx, bname = a.names[lbl].bin;
            res[iname] = pako.gzip(encodeUtf8(JSON.stringify({ manifest: manifests, ranges })));
            res[bname] = pako.gzip(buf);
        }
    }
    const meta = currentPack.meta;
    if (meta.resources) {
        for (const [p, r] of Object.entries(meta.resources)) {
            if (!res[p]) continue;
            const plain = r.encoding === 'gzip' ? pako.inflate(res[p]) : res[p];
            r.size = plain.length; r.stored = res[p].length; r.sha256 = ''; 
        }
    }
    const html = currentPack.html;
    const m = html.match(/id="eagler26-offline-meta"[^>]*>(.*?)<\/script>/s);
    if (!m) return html;
    const newMeta = `<script id="eagler26-offline-meta" type="application/json">${JSON.stringify(meta).replace(/<\//g, '<\\/')}</script>`;
    let newHtml = html.slice(0, m.index) + newMeta + html.slice(m.index + m[0].length);
    const chunksOut = [];
    for (const [p, d] of Object.entries(res)) {
        let off = 0;
        while (off < d.length) {
            const piece = d.slice(off, off + 8388608);
            const enc = currentPack.codec.encode(piece);
            let str = '';
            for (let i = 0; i < enc.length; i++) str += String.fromCharCode(enc[i]);
            chunksOut.push(`<script type="application/x-eagler26-chunk" data-r="${p}" data-len="${piece.length}" data-sum="${eaglerSum(piece)}">${str}</script>\n<script>__eaglerOffline.take()</script>`);
            off += piece.length;
        }
    }
    const startIdx = newHtml.indexOf('<script type="application/x-eagler26-chunk"');
    let endIdx = newHtml.lastIndexOf('</script>');
    if (startIdx !== -1 && endIdx !== -1) {
        newHtml = newHtml.slice(0, startIdx) + chunksOut.join('\n') + newHtml.slice(endIdx + 9);
    }
    return newHtml;
}

async function savePack() {
    if (!currentPack) return;
    try {
        let outHtml = '';
        if (currentFmt === 'gaius') {
            const injectPayload = [];
            if (injectFiles.length > 0) {
                const prefix = document.getElementById('injectPrefix').value.trim() || '/gaius/';
                for (const f of injectFiles) {
                    if (!f._data) {
                        const buf = await f.arrayBuffer();
                        f._data = new Uint8Array(buf);
                    }
                    let b64 = '';
                    for (let i = 0; i < f._data.length; i++) b64 += String.fromCharCode(f._data[i]);
                    injectPayload.push({ path: f.name, data: btoa(b64) });
                }
                
                const injectScript = `<script>(function(){const F=${JSON.stringify(injectPayload)},P="${prefix}";function b(s){const i=atob(s),a=new Uint8Array(i.length);for(let j=0;j<i.length;j++)a[j]=i.charCodeAt(j);return a}async function w(){for(const e of F){const p=P+e.path,d=b(e.data);if(window.__gaiusFsPutBytes){window.__gaiusFsPutBytes(p,d);continue}const r=indexedDB.open(window.__gaiusStorageDatabaseName||"gaius-fs-v2-26.3");r.onsuccess=()=>{const db=r.result;const t=db.transaction("files","readwrite");t.objectStore("files").put({path:p,value:d,updatedAt:Date.now()});t.oncomplete=()=>db.close()}}}if(document.readyState==="complete")setTimeout(w,2000);else window.addEventListener("load",()=>setTimeout(w,2000))})();</script>`;
                
                const idx = currentPack.html.lastIndexOf('</body>');
                currentPack.html = idx >= 0 ? currentPack.html.slice(0, idx) + injectScript + currentPack.html.slice(idx) : currentPack.html + injectScript;
            }
            
            outHtml = rebuildGaiusHtml();
        } else {
            outHtml = rebuildEaglerHtml();
        }
        
        const name = document.getElementById('outputPath').value || ('modified_' + Date.now() + '.html');
        downloadBlob(new Blob([encodeUtf8(outHtml)], { type: 'text/html' }), name);
        log(`[✓] ${t('repackSuccess')}`);
    } catch (e) {
        log(`[X] Error: ${e.message}`);
        console.error(e);
    }
}

// 事件绑定
document.getElementById('dropZone').onclick = () => document.getElementById('fileInput').click();
document.getElementById('fileInput').onchange = (e) => {
    if (!e.target.files.length) return;
    if (e.target.files.length > 1) {
        log('[X] Please select only one file / 请只选择一个文件');
        e.target.value = '';
        return;
    }
    const file = e.target.files[0];
    file.arrayBuffer().then(buf => {
        const data = new Uint8Array(buf);
        file._data = data;
        handleFile(file);
    });
};
document.getElementById('dropZone').ondragover = (e) => { e.preventDefault(); e.currentTarget.classList.add('dragover'); };
document.getElementById('dropZone').ondragleave = (e) => { e.currentTarget.classList.remove('dragover'); };
document.getElementById('dropZone').ondrop = (e) => {
    e.preventDefault(); e.currentTarget.classList.remove('dragover');
    if (e.dataTransfer.files.length) {
        if (e.dataTransfer.files.length > 1) {
            log('[X] Please drop only one file / 请只拖拽一个文件');
            return;
        }
        const file = e.dataTransfer.files[0];
        file.arrayBuffer().then(buf => {
            const data = new Uint8Array(buf);
            file._data = data;
            handleFile(file);
        });
    }
};
document.getElementById('searchInput').oninput = filterTree;

setLanguage('zh');
log(t('started'));
log(t('autoDetect'));