const E_A = '__ASSETS__/', E_U = '__AUDIO__/';
const G_MAGIC = new Uint8Array([71, 65, 73, 85, 83, 86, 80, 49]);

let currentPack = null, currentFmt = null;
// 定义 ECodec 供主线程重打包使用（因为 Worker 传过来的对象会丢失方法）
const E_DEF_UNSAFE = [0x00, 0x0d, 0x3c, 0x3d];
for (let i = 0; i < 0x20; i++) E_DEF_UNSAFE.push(0x80 + i);

class ECodec {
    constructor(esc, base, unsafe) {
        this.esc = (esc != null) ? esc : 0x3d;
        this.base = (base != null) ? base : 0x40;
        this.unsafe = Array.from(unsafe || E_DEF_UNSAFE);
        this.rev = new Map();
        for (let i = 0; i < this.unsafe.length; i++) {
            this.rev.set(this.unsafe[i], this.base + i);
        }
    }
    encode(raw) {
        const out = [];
        for (let i = 0; i < raw.length; i++) {
            const b = raw[i];
            if (this.rev.has(b)) {
                out.push(this.esc);
                out.push(this.rev.get(b));
            } else {
                out.push(b);
            }
        }
        return new Uint8Array(out);
    }
}
let injectFiles = [];
let selectedPaths = new Set();

const encodeUtf8 = (s) => new TextEncoder().encode(s);
const decodeUtf8 = (b) => new TextDecoder('utf-8').decode(b);

// binary string <-> bytes
function bytesToBinaryString(bytes) {
    let s = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    return s;
}

// 初始化 Worker
const workerBlob = new Blob([window.WORKER_CODE], { type: 'application/javascript' });
const workerUrl = URL.createObjectURL(workerBlob);
let parserWorker = new Worker(workerUrl);

parserWorker.onmessage = (e) => {
    if (e.data.type === 'log') {
        log(e.data.msg);
        return;
    }

    const { status, pack, fmt, message } = e.data;
    if (status === 'ok') {
        // 还原 Set
        if (pack.assets && pack.assets.deleted) pack.assets.deleted = new Set(pack.assets.deleted);
        if (pack.audio && pack.audio.deleted) {
            for (const k in pack.audio.deleted) pack.audio.deleted[k] = new Set(pack.audio.deleted[k]);
        }

        // 恢复 codec 的原型和方法
        if (pack.codec) {
            pack.codec = new ECodec(pack.codec.esc, pack.codec.base, pack.codec.unsafe);
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
        if (!a) return null;
        if (a.new[sub]) return a.new[sub];
        if (a.deleted.has(sub)) return null;
        if (a.dirty[sub]) return a.dirty[sub];
        const r = a.ranges[sub];
        return r ? a.blob.slice(r[0], r[0] + r[1]) : null;
    }
    if (p.startsWith(E_U)) {
        const rest = p.slice(E_U.length);
        const slash = rest.indexOf('/');
        if (slash < 0) return null;
        const lbl = rest.slice(0, slash);
        const sub = rest.slice(slash + 1);
        const a = currentPack.audio;
        if (!a || !a.ranges[lbl]) return null;
        if (a.new[lbl] && a.new[lbl][sub]) return a.new[lbl][sub];
        if (a.deleted[lbl] && a.deleted[lbl].has(sub)) return null;
        if (a.dirty[lbl] && a.dirty[lbl][sub]) return a.dirty[lbl][sub];
        const r = a.ranges[lbl][sub];
        return r ? a.blobs[lbl].slice(r[0], r[0] + r[1]) : null;
    }
    return currentPack.res[p];
}

function writeFile(p, data) {
    if (!currentPack) return;
    if (currentFmt === 'gaius') {
        if (p in currentPack.index) {
            const old = currentPack.index[p];
            // 简单追加策略（与 Python 一致）
            const newData = new Uint8Array(currentPack.data.length + data.length);
            newData.set(currentPack.data, 0);
            newData.set(data, currentPack.data.length);
            currentPack.index[p] = [currentPack.data.length, data.length];
            currentPack.data = newData;
        } else {
            const newData = new Uint8Array(currentPack.data.length + data.length);
            newData.set(currentPack.data, 0);
            newData.set(data, currentPack.data.length);
            currentPack.index[p] = [currentPack.data.length, data.length];
            currentPack.data = newData;
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
        const rest = p.slice(E_U.length);
        const slash = rest.indexOf('/');
        const lbl = rest.slice(0, slash), sub = rest.slice(slash + 1);
        if (!currentPack.audio.dirty[lbl]) currentPack.audio.dirty[lbl] = {};
        if (!currentPack.audio.deleted[lbl]) currentPack.audio.deleted[lbl] = new Set();
        if (!currentPack.audio.new[lbl]) currentPack.audio.new[lbl] = {};
        if (!currentPack.audio.order[lbl]) currentPack.audio.order[lbl] = [];
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
    if (p.startsWith(E_A)) {
        const sub = p.slice(E_A.length);
        currentPack.assets.deleted.add(sub);
        delete currentPack.assets.dirty[sub];
        return;
    }
    if (p.startsWith(E_U)) {
        const rest = p.slice(E_U.length);
        const slash = rest.indexOf('/');
        const lbl = rest.slice(0, slash), sub = rest.slice(slash + 1);
        if (!currentPack.audio.deleted[lbl]) currentPack.audio.deleted[lbl] = new Set();
        currentPack.audio.deleted[lbl].add(sub);
        if (currentPack.audio.dirty[lbl]) delete currentPack.audio.dirty[lbl][sub];
        return;
    }
    delete currentPack.res[p];
}

/* ============ 操作按钮 ============ */
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
        renderTree();
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
    for (const p of pArray) deleteFileByPath(p);
    selectedPaths.clear();
    renderTree();
    updateActionButtons();
    log(`[Deleted] ${pArray.length} file(s)`);
}

/* ============ 导出 ============ */
function exportSelected() {
    if (selectedPaths.size === 0) return;
    const pArray = Array.from(selectedPaths);
    if (pArray.length === 1) {
        const d = readFile(pArray[0]);
        if (!d) return;
        downloadBlob(new Blob([d]), pArray[0].split('/').pop());
    } else {
        // 多选打包成 gzip
        const zipData = {};
        for (const p of pArray) {
            const d = readFile(p);
            if (d) zipData[p] = Array.from(d);
        }
        const zipped = pako.gzip(JSON.stringify(zipData));
        downloadBlob(new Blob([zipped]), 'export_selected.gz');
    }
}

function exportAll() {
    const zipData = {};
    for (const p of getPaths()) {
        const d = readFile(p);
        if (d) zipData[p] = Array.from(d);
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
    const total = new Uint8Array(12 + idxBytes.length + currentPack.data.length);
    total.set(header, 0);
    total.set(idxBytes, 12);
    total.set(currentPack.data, 12 + idxBytes.length);
    downloadBlob(new Blob([pako.gzip(total)]), 'export_raw.gz');
}

/* ============ 注入面板 ============ */
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

/* ============ 下载 ============ */
function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ============ Gaius 重打包 ============ */
function rebuildGaiusHtml() {
    const idx = JSON.stringify(currentPack.index).replace(/ /g, '');
    const idxBytes = encodeUtf8(idx);
    const header = new Uint8Array(12);
    header.set(G_MAGIC, 0);
    new DataView(header.buffer).setUint32(8, idxBytes.length, true);
    const raw = new Uint8Array(12 + idxBytes.length + currentPack.data.length);
    raw.set(header, 0);
    raw.set(idxBytes, 12);
    raw.set(currentPack.data, 12 + idxBytes.length);
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
            ['Gaius Client</strong> \\| independent browser software', 'Gaius 客户端</strong> | 独立浏览器软件'],
            ['HTML runtime \\| local storage enabled', 'HTML 运行时 | 本地存储已启用'],
            ['Retry startup', '重试启动'], ['Show diagnostics', '显示诊断'],
            ['Hide diagnostics', '隐藏诊断'], ['BROWSER CLIENT', '浏览器客户端'],
            ['Starting Gaius Client 26\\.3\\.\\.\\.', '正在启动 Gaius 客户端 26.3...'],
            ['"Loading persistent browser storage\\.\\.\\."', '"正在加载浏览器持久化存储..."']
        ];
        for (const [k, v] of reps) html = html.replace(new RegExp(k, 'g'), v);
    }
    return html;
}

/* ============ Eagler 重打包 ============ */
function eaglerSum(data) {
    let s1 = 0, s2 = 0;
    for (let i = 0; i < data.length; i++) {
        s1 = (s1 + data[i]) >>> 0;
        s2 = (s2 + s1) >>> 0;
    }
    return ((s1 & 0xFFFF) ^ ((s2 << 16) >>> 0)) >>> 0;
}

// 重建 assets / audio 的 idx/bin（原地更新 res 里的项）
function rebuildEaglerRes() {
    const res = currentPack.res;
    const a = currentPack.assets;
    if (a) {
        // 判断是否有修改
        const modified = Object.keys(a.dirty).length > 0 || a.deleted.size > 0 || Object.keys(a.new).length > 0;
        if (modified) {
            const manifests = {}; const ranges = {}; const parts = [];
            let off = 0;
            const paths = new Set(Object.keys(a.ranges));
            for (const p of a.order) paths.add(p);
            // 保持原顺序 + 新增的
            const ordered = [];
            for (const p of a.order) if (!a.deleted.has(p) || a.dirty[p] || a.new[p]) ordered.push(p);
            for (const p of Object.keys(a.new)) if (!ordered.includes(p)) ordered.push(p);
            for (const p of ordered) {
                const d = readFile(E_A + p);
                if (!d) continue;
                parts.push(d);
                ranges[p] = [off, d.length];
                off += d.length;
                manifests[p] = './' + p;
            }
            const buf = new Uint8Array(off);
            off = 0;
            for (const p of parts) { buf.set(p, off); off += p.length; }
            const idxJson = JSON.stringify({ manifest: { assets: manifests }, ranges });
            res['assets/assets.idx'] = pako.gzip(encodeUtf8(idxJson));
            res['assets/assets.bin'] = pako.gzip(buf);
        }
    }

    const au = currentPack.audio;
    if (au) {
        for (const lbl of Object.keys(au.ranges)) {
            const modified = Object.keys(au.dirty[lbl] || {}).length > 0
                || (au.deleted[lbl] && au.deleted[lbl].size > 0)
                || Object.keys(au.new[lbl] || {}).length > 0;
            if (!modified) continue;

            const manifests = {}; const ranges = {}; const parts = [];
            let off = 0;
            const ordered = [];
            for (const p of au.order[lbl]) {
                if (au.deleted[lbl] && au.deleted[lbl].has(p) && !au.dirty[lbl][p] && !au.new[lbl][p]) continue;
                ordered.push(p);
            }
            for (const p of Object.keys(au.new[lbl] || {})) if (!ordered.includes(p)) ordered.push(p);
            for (const p of ordered) {
                const d = readFile(E_U + lbl + '/' + p);
                if (!d) continue;
                parts.push(d);
                ranges[p] = [off, d.length];
                off += d.length;
                manifests[p] = './' + p;
            }
            const buf = new Uint8Array(off);
            off = 0;
            for (const p of parts) { buf.set(p, off); off += p.length; }
            const idxJson = JSON.stringify({ manifest: manifests, ranges });
            const iname = au.names[lbl].idx, bname = au.names[lbl].bin;
            res[iname] = pako.gzip(encodeUtf8(idxJson));
            res[bname] = pako.gzip(buf);
        }
    }
    return res;
}

// 更新 meta 里的 size/stored/sha256（sha256 用 crypto.subtle，file:// 下可能不可用，降级跳过）
async function updateEaglerMeta() {
    const meta = currentPack.meta;
    const res = currentPack.res;

    async function sha256Hex(bytes) {
        if (!self.crypto || !self.crypto.subtle) return '';
        try {
            const buf = await self.crypto.subtle.digest('SHA-256', bytes);
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        } catch (e) { return ''; }
    }

    if (meta.resources) {
        for (const [p, r] of Object.entries(meta.resources)) {
            if (!res[p]) continue;
            let plain = res[p];
            if (r.encoding === 'gzip') {
                try { plain = pako.inflate(res[p]); } catch (e) { plain = res[p]; }
            }
            r.size = plain.length;
            r.stored = res[p].length;
            const h = await sha256Hex(plain);
            if (h) r.sha256 = h;
        }
    }
}

// 把 head（utf-8 编码）里的 meta / build script 替换成新 JSON
function fixEaglerHead(headBytes) {
    // headBytes: Uint8Array（utf-8 编码的 head 文本）
    // 但 head 里还有 0x80-0x9F 的 byte 吗？通常 head 是纯 ASCII 结构，安全
    let headStr = decodeUtf8(headBytes);

    function replaceScript(headText, idAttr, obj) {
        if (!obj) return headText;
        const jsonStr = JSON.stringify(obj).replace(/<\//g, '<\\/');
        const newScript = `<script ${idAttr} type="application/json">${jsonStr}</script>`;
        const re = new RegExp(`<script\\s+${idAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>[\\s\\S]*?</script>`);
        return headText.replace(re, newScript);
    }

    headStr = replaceScript(headStr, 'id="eagler26-offline-meta"', currentPack.meta);
    if (currentPack.build) {
        headStr = replaceScript(headStr, 'id="eagler26-build"', currentPack.build);
    }
    return encodeUtf8(headStr);
}

/* ============ 保存 ============ */
async function savePack() {
    if (!currentPack) return;
    try {
        const name = document.getElementById('outputPath').value || ('modified_' + Date.now() + '.html');

        if (currentFmt === 'gaius') {
            // Gaius 注入
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

            const html = rebuildGaiusHtml();
            downloadBlob(new Blob([encodeUtf8(html)], { type: 'text/html' }), name);
            log(`[✓] ${t('repackSuccess')}`);
            return;
        }

        // ============ Eagler 重打包（分两段：head utf-8 + chunk 原始字节） ============
        log('[i] 重打包 Eagler26...');

        // 1. 先重建 idx/bin（如有修改）
        rebuildEaglerRes();

        // 2. 更新 meta
        log('[i] 更新 meta...');
        await updateEaglerMeta();

        // 3. 输出 head（utf-8 编码）
        const headStr = currentPack.head;  // binary string（已包含原始字节）
        // head 走 utf-8 编码（head 是纯文本结构），但它里面如果混有原始 0x80-0x9F 的 ASCII 区域文本，utf-8 编码后语义不变
        const headBytes = encodeUtf8(headStr);
        const fixedHead = fixEaglerHead(headBytes);

        // 4. 输出 chunks
        const parts = [];
        parts.push(fixedHead);

        const E_CHUNK = 8 * 1024 * 1024;
        const CHUNK_OPEN = '<script type="application/x-eagler26-chunk"';
        const TAKE = '<script>__eaglerOffline.take()</script>\n';

        const res = currentPack.res;
        // 保持顺序：先按 original order，再补新增
        const orderSet = new Set(Object.keys(res));
        const ordered = [];
        for (const p of currentPack.resOrder || []) {
            if (orderSet.has(p)) ordered.push(p);
        }
        for (const p of orderSet) if (!ordered.includes(p)) ordered.push(p);

        let chunkCount = 0;
        for (const p of ordered) {
            const raw = res[p];
            if (!raw) continue;
            let off = 0;
            while (off < raw.length) {
                const piece = raw.subarray(off, Math.min(off + E_CHUNK, raw.length));
                const sum = eaglerSum(piece);
                const tagStr = `${CHUNK_OPEN} data-r="${p}" data-len="${piece.length}" data-sum="${sum}">`;
                parts.push(encodeUtf8(tagStr));
                // 【关键】chunk 内容走 codec.encode 得到原始字节（windows-1252 语义），直接写
                const encoded = currentPack.codec.encode(piece);
                parts.push(encoded);
                parts.push(encodeUtf8('</script>' + TAKE));
                off += piece.length;
                chunkCount++;
            }
        }

        // 5. tail（utf-8 编码）
        parts.push(encodeUtf8(currentPack.tail));

        // 6. 合并所有 parts
        let total = 0;
        for (const p of parts) total += p.length;
        const out = new Uint8Array(total);
        let off = 0;
        for (const p of parts) { out.set(p, off); off += p.length; }

        downloadBlob(new Blob([out], { type: 'text/html' }), name);
        log(`[✓] ${t('repackSuccess')} (${chunkCount} chunks, ${(total / 1024 / 1024).toFixed(2)} MB)`);
    } catch (e) {
        log(`[X] Error: ${e.message}`);
        console.error(e);
        console.error(e.stack);
    }
}

/* ============ 事件绑定 ============ */
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