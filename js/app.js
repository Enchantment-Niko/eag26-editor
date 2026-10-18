const G_MAGIC = new Uint8Array([71, 65, 73, 85, 83, 86, 80, 49]);
const G_KEYS = ['"vanilla":[', "'vanilla':[", 'vanilla:[', '"vanilla": [', "'vanilla': [", 'vanilla: [', '"vanilla" :[', '"vanilla" : [', 'vanilla\t:[', 'vanilla\t: ['];
const E_DEF_UNSAFE = [0x00, 0x0d, 0x3c, 0x3d, ...Array.from({length: 0x20}, (_, i) => 0x80 + i)];
const E_A = '__ASSETS__/', E_U = '__AUDIO__/';

let currentPack = null, currentFmt = null;
let injectFiles = [];
let selectedPaths = new Set();
let allRenderedItems = [];

const workerScript = `
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js');
    
    const G_MAGIC = new Uint8Array([71, 65, 73, 85, 83, 86, 80, 49]);
    const G_KEYS = ['"vanilla":[', "'vanilla':[", 'vanilla:[', '"vanilla": [', "'vanilla': [", 'vanilla: [', '"vanilla" :[', '"vanilla" : [', 'vanilla\\t:[', 'vanilla\\t: ['];
    const E_DEF_UNSAFE = [0x00, 0x0d, 0x3c, 0x3d, ...Array.from({length: 0x20}, (_, i) => 0x80 + i)];
    const E_A = '__ASSETS__/', E_U = '__AUDIO__/';

    function wLog(msg) { self.postMessage({ type: 'log', msg: '[Worker] ' + msg }); }

    function safeAtob(base64) {
        let clean = "";
        for (let i = 0; i < base64.length; i++) {
            const c = base64.charCodeAt(i);
            if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 61) {
                clean += base64[i];
            }
        }
        while (clean.length % 4 !== 0) {
            clean += '=';
        }
        try {
            return atob(clean);
        } catch (e) {
            const b64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
            let buffer = 0, bits = 0;
            const output = new Uint8Array(Math.floor(clean.length * 3 / 4));
            let outIdx = 0;
            for (let i = 0; i < clean.length; i++) {
                if (clean[i] === '=') break;
                const idx = b64chars.indexOf(clean[i]);
                if (idx === -1) continue;
                buffer = (buffer << 6) | idx;
                bits += 6;
                if (bits >= 8) {
                    bits -= 8;
                    output[outIdx++] = (buffer >> bits) & 0xFF;
                }
            }
            return new TextDecoder().decode(output.slice(0, outIdx));
        }
    }

    const decodeUtf8 = (b) => new TextDecoder('utf-8').decode(b);
    const encodeUtf8 = (s) => new TextEncoder().encode(s);

    class ECodec {
        constructor(esc=0x3d, base=0x40, unsafe=E_DEF_UNSAFE) {
            this.esc = esc; this.base = base; this.unsafe = unsafe;
            this.rev = new Map(); this.unsafe.forEach((b, i) => this.rev.set(b, base + i));
        }
        decode(raw) {
            if (!raw.includes(this.esc)) return raw;
            const out = []; let i = 0;
            while (i < raw.length) {
                const j = raw.indexOf(this.esc, i);
                if (j === -1) { out.push(...raw.subarray(i)); break; }
                out.push(...raw.subarray(i, j));
                if (j + 1 >= raw.length) break;
                const k = raw[j + 1] - this.base;
                out.push((k >= 0 && k < this.unsafe.length) ? this.unsafe[k] : raw[j + 1]);
                i = j + 2;
            }
            return new Uint8Array(out);
        }
        encode(data) {
            const out = [];
            for (const b of data) {
                if (this.rev.has(b)) out.push(this.esc, this.rev.get(b));
                else out.push(b);
            }
            return new Uint8Array(out);
        }
    }

    function eaglerSum(data) {
        let s1 = 0, s2 = 0;
        for (let i = 0; i < data.length; i++) {
            s1 = (s1 + data[i]) & 0xFFFFFFFF;
            s2 = (s2 + s1) & 0xFFFFFFFF;
        }
        return ((s1 & 0xFFFF) ^ ((s2 << 16) & 0xFFFFFFFF)) >>> 0;
    }

    function findBracket(text, openPos) {
        let depth = 0, inStr = false, escape = false;
        for (let i = openPos; i < text.length; i++) {
            const c = text[i];
            if (inStr) {
                if (escape) escape = false;
                else if (c === '\\\\') escape = true;
                else if (c === '"') inStr = false;
            } else {
                if (c === '"') inStr = true;
                else if (c === '[') depth++;
                else if (c === ']') { depth--; if (depth === 0) return i; }
            }
        }
        return -1;
    }

    function extractVanilla(html) {
        for (const key of G_KEYS) {
            const pos = html.indexOf(key);
            if (pos === -1) continue;
            const open = html.indexOf('[', pos);
            const close = findBracket(html, open);
            if (close === -1) continue;
            const body = html.substring(open + 1, close);
            const chunks = [...body.matchAll(/"([^"]*)"/g)].map(m => m[1]);
            return { chunks, open, close };
        }
        return null;
    }

    function handleGaius(bytes) {
        wLog('开始提取 vanilla 数组...');
        const html = decodeUtf8(bytes);
        const found = extractVanilla(html);
        if (!found) throw new Error("Vanilla array not found in HTML.");
        wLog('提取完成，正在执行 Base64 解码...');
        
        let binary = '';
        for (const c of found.chunks) binary += safeAtob(c);
        
        const raw = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            raw[i] = binary.charCodeAt(i);
        }

        wLog('解码完成，正在执行 Gzip 解压 (pako)...');
        let dec;
        try {
            dec = pako.inflate(raw);
        } catch (e) {
            throw new Error("Gzip decompression failed. The extracted data is invalid or corrupted.");
        }

        if (dec.length < 12 || !dec.slice(0, 8).every((v, i) => v === G_MAGIC[i])) {
            throw new Error("Invalid GAIUSVP1 magic. The file format is not recognized.");
        }
        wLog('解压成功，正在解析文件索引...');
        
        const idxLen = new DataView(dec.buffer).getUint32(8, true);
        const index = JSON.parse(decodeUtf8(dec.slice(12, 12 + idxLen)));
        const data = dec.slice(12 + idxLen);
        wLog('Gaius 包解析完成。');
        return { format: 'gaius', index, data, html, found };
    }

    function handleEagler(bytes) {
        wLog('开始解析 Eagler26 HTML...');
        const html = decodeUtf8(bytes);
        const metaMatch = html.match(/id="eagler26-offline-meta"[^>]*>(.*?)<\\/script>/s);
        if (!metaMatch) throw new Error("Eagler26 meta not found");
        const meta = JSON.parse(metaMatch[1]);
        const enc = meta.encoding || {};
        const codec = new ECodec(enc.escape ?? 0x3d, enc.base ?? 0x40, enc.unsafe ?? E_DEF_UNSAFE);
        
        const res = {};
        const pat = /<script type="application\\/x-eagler26-chunk"([^>]*)>(.*?)<\\/script>/gs;
        let m;
        const byPath = {};
        while ((m = pat.exec(html)) !== null) {
            const r = m[1].match(/data-r="([^"]+)"/);
            if (r) {
                const path = r[1];
                if (!byPath[path]) byPath[path] = [];
                byPath[path].push(new TextEncoder().encode(m[2]));
            }
        }
        wLog('正在合并 Chunk 数据...');
        for (const [p, arr] of Object.entries(byPath)) {
            const raw = new Uint8Array(arr.reduce((a, b) => a + b.length, 0));
            let off = 0;
            for (const b of arr) { raw.set(b, off); off += b.length; }
            res[p] = codec.decode(raw);
        }

        wLog('正在解析 assets 与 audio 索引...');
        const assets = { ranges: {}, blob: new Uint8Array(), dirty: {}, deleted: new Set(), new: {}, order: [] };
        if (res['assets/assets.idx'] && res['assets/assets.bin']) {
            try {
                assets.ranges = JSON.parse(decodeUtf8(pako.inflate(res['assets/assets.idx']))).ranges;
                assets.blob = pako.inflate(res['assets/assets.bin']);
                assets.order = Object.keys(assets.ranges);
            } catch(e) {}
        }

        const audio = { ranges: {}, blobs: {}, dirty: {}, deleted: {}, new: {}, order: {}, names: {} };
        const groups = [
            ['sfx', 'audio/sfx-original.idx', 'audio/sfx-original.bin'],
            ['music', 'audio/music-original.idx', 'audio/music-original.bin'],
            ['records', 'audio/records-original.idx', 'audio/records-original.bin'],
            ['sfx-opt', 'audio/sfx-optimized.idx', 'audio/sfx-optimized.bin']
        ];
        for (const [lbl, iname, bname] of groups) {
            if (res[iname] && res[bname]) {
                try {
                    let idx = res[iname];
                    try { idx = pako.inflate(idx); } catch(e) {}
                    const parsed = JSON.parse(decodeUtf8(idx));
                    audio.ranges[lbl] = parsed.ranges || parsed;
                    if (Object.keys(audio.ranges[lbl]).length === 0) continue;
                    try { audio.blobs[lbl] = pako.inflate(res[bname]); } catch(e) { audio.blobs[lbl] = res[bname]; }
                    audio.order[lbl] = Object.keys(audio.ranges[lbl]);
                    audio.names[lbl] = { idx: iname, bin: bname };
                } catch(e) {}
            }
        }
        wLog('Eagler26 包解析完成。');
        return { format: 'eagler', meta, codec, res, html, assets, audio };
    }

    self.onmessage = (e) => {
        try {
            const { action, fileData } = e.data;
            if (action === 'load') {
                wLog('收到文件数据，开始自动识别格式...');
                const head = decodeUtf8(fileData.slice(0, 1024 * 1024));
                let pack, fmt;
                if (head.includes('x-eagler26-chunk') || head.includes('eagler26-offline-meta')) {
                    pack = handleEagler(fileData);
                    fmt = 'eagler';
                } else if (head.includes('GAIUSVP1') || head.includes('vanilla')) {
                    pack = handleGaius(fileData);
                    fmt = 'gaius';
                } else {
                    throw new Error("Unrecognized format");
                }
                
                if (pack.assets && pack.assets.deleted) pack.assets.deleted = Array.from(pack.assets.deleted);
                if (pack.audio && pack.audio.deleted) {
                    for (const k in pack.audio.deleted) pack.audio.deleted[k] = Array.from(pack.audio.deleted[k]);
                }
                
                self.postMessage({ status: 'ok', pack, fmt });
            }
        } catch (err) {
            wLog('解析发生错误: ' + err.message);
            self.postMessage({ status: 'error', message: err.message });
        }
    };
`;

const workerBlob = new Blob([workerScript], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(workerBlob);
let parserWorker = new Worker(workerUrl);

// 主线程这里补上 encodeUtf8，供打包使用
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
        initTreeDOM();
        updateActionButtons();
    } else {
        log(`[X] ${t('unpackError')}: ${message}`);
        clearFile();
    }
};

function log(msg) {
    const time = new Date().toLocaleTimeString();
    const lb = document.getElementById('logBox');
    lb.innerText += `[${time}] ${msg}\n`;
    lb.scrollTop = lb.scrollHeight;
    console.log(`[LOG] ${msg}`);
}

function clearLog() { document.getElementById('logBox').innerText = ''; }
function copyLog() { navigator.clipboard.writeText(document.getElementById('logBox').innerText); }
function exportLog() { downloadBlob(new Blob([document.getElementById('logBox').innerText]), 'log.txt'); }

function promptModal(title, defaultValue) {
    return new Promise((resolve) => {
        const dialog = document.createElement('mdui-dialog');
        dialog.innerHTML = `
            <div slot="headline">${title}</div>
            <div slot="content">
                <mdui-text-field class="prompt-input" value="${defaultValue}" variant="outlined" style="width: 100%; margin-top: 8px;"></mdui-text-field>
            </div>
            <div slot="actions">
                <mdui-button variant="text" class="btn-cancel">Cancel</mdui-button>
                <mdui-button variant="text" class="btn-ok">OK</mdui-button>
            </div>
        `;
        document.body.appendChild(dialog);
        dialog.open = true;
        const input = dialog.querySelector('.prompt-input');
        dialog.querySelector('.btn-cancel').onclick = () => { dialog.open = false; setTimeout(() => dialog.remove(), 300); resolve(null); };
        dialog.querySelector('.btn-ok').onclick = () => { const val = input.value.trim(); dialog.open = false; setTimeout(() => dialog.remove(), 300); resolve(val); };
    });
}

// 严格参考 MDUI 文档实现，使用 slot="action" 和全新的 Dialog 结构
function confirmModal(title, textList) {
    return new Promise((resolve) => {
        const dialog = document.createElement('mdui-dialog');
        dialog.setAttribute('close-on-overlay-click', '');
        dialog.innerHTML = `
            <div slot="headline">${title}</div>
            <div slot="content" style="max-height: 60vh; overflow: hidden; display: flex; flex-direction: column; width: 100%;">
                <div class="dialog-content-box" style="overflow-y: auto; flex: 1;">${textList.replace(/\n/g, '<br>')}</div>
            </div>
            <mdui-button slot="action" variant="text" class="btn-cancel">Cancel</mdui-button>
            <mdui-button slot="action" variant="tonal" class="btn-ok">Delete</mdui-button>
        `;
        document.body.appendChild(dialog);
        dialog.open = true;
        dialog.querySelector('.btn-cancel').onclick = () => { dialog.open = false; setTimeout(() => dialog.remove(), 300); resolve(false); };
        dialog.querySelector('.btn-ok').onclick = () => { dialog.open = false; setTimeout(() => dialog.remove(), 300); resolve(true); };
    });
}

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

function initTreeDOM() {
    const list = document.getElementById('treeList');
    list.innerHTML = '';
    allRenderedItems = [];
    
    const paths = getPaths();
    
    for (const p of paths) {
        const li = document.createElement('div');
        li.className = 'perf-item';
        li.setAttribute('data-path', p.toLowerCase());
        if (selectedPaths.has(p)) li.classList.add('active');
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = selectedPaths.has(p);
        
        const span = document.createElement('span');
        span.className = 'path-text';
        span.textContent = p;
        
        li.appendChild(chk);
        li.appendChild(span);
        
        li.onclick = () => { 
            const isNowSelected = !selectedPaths.has(p);
            if (isNowSelected) {
                selectedPaths.add(p);
                li.classList.add('active');
                chk.checked = true;
            } else {
                selectedPaths.delete(p);
                li.classList.remove('active');
                chk.checked = false;
            }
            updateActionButtons();
        };
        
        list.appendChild(li);
        allRenderedItems.push({ el: li, path: p.toLowerCase() });
    }
    
    filterTree();
}

// 优化后的防抖搜索，极大缓解卡顿
let searchTimeout = null;
function filterTree() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
            const kw = document.getElementById('searchInput').value.toLowerCase().trim();
            let count = 0;
            for (const item of allRenderedItems) {
                if (!kw || item.path.includes(kw)) {
                    item.el.style.display = 'flex';
                    count++;
                } else {
                    item.el.style.display = 'none';
                }
            }
        });
    }, 100); // 100ms 防抖
}

function updateActionButtons() {
    const len = selectedPaths.size;
    const isSingle = len === 1;
    
    document.getElementById('iconBtnReplace').disabled = !isSingle;
    document.getElementById('iconBtnRename').disabled = !isSingle;
    document.getElementById('iconBtnDelete').disabled = len === 0;
    document.getElementById('iconBtnExport').disabled = len === 0;
    
    document.getElementById('btnReplace').disabled = !isSingle;
    document.getElementById('btnRename').disabled = !isSingle;
    document.getElementById('btnDelete').disabled = len === 0;
    document.getElementById('btnExpSel').disabled = len === 0;
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
        initTreeDOM();
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
    
    initTreeDOM();
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
    initTreeDOM();
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

function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
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