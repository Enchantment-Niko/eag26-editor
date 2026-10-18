const E_A = '__ASSETS__/', E_U = '__AUDIO__/';
const G_MAGIC = new Uint8Array([71, 65, 73, 85, 83, 86, 80, 49]);

let currentPack = null, currentFmt = null;
let injectFiles = [];
let selectedPaths = new Set();

const encodeUtf8 = (s) => new TextEncoder().encode(s);
const decodeUtf8 = (b) => new TextDecoder('utf-8').decode(b);

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
        if (pack.assets && pack.assets.deleted) pack.assets.deleted = new Set(pack.assets.deleted);
        if (pack.audio && pack.audio.deleted) {
            for (const k in pack.audio.deleted) pack.audio.deleted[k] = new Set(pack.audio.deleted[k]);
        }
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
    document.getElementById('fileStats').innerText = "Parsing...";
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

function injRm() {
    const boxes = document.querySelectorAll('.inj-check');
    const newFiles = [];
    let idx = 0;
    for (const box of boxes) {
        if (!box.checked) newFiles.push(injectFiles[idx]);
        idx++;
    }
    injectFiles = newFiles;
    renderInject();
}

function injClear() {
    injectFiles = [];
    renderInject();
}

function renderInject() {
    const ul = document.getElementById('injectList');
    ul.innerHTML = '';
    injectFiles.forEach((f, index) => {
        const li = document.createElement('li');
        li.style.padding = '4px 0';
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.gap = '8px';
        
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.className = 'inj-check';
        
        const span = document.createElement('span');
        span.textContent = f.name + ' <- ' + f.size + ' bytes';
        
        li.appendChild(chk);
        li.appendChild(span);
        ul.appendChild(li);
    });
}

function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function eaglerSum(data) {
    let s1 = 0, s2 = 0;
    for (let i = 0; i < data.length; i++) {
        s1 = (s1 + data[i]) >>> 0;
        s2 = (s2 + s1) >>> 0;
    }
    return ((s1 & 0xFFFF) ^ ((s2 << 16) >>> 0)) >>> 0;
}

function rebuildEaglerRes() {
    const res = currentPack.res;
    const a = currentPack.assets;
    if (a) {
        const modified = Object.keys(a.dirty).length > 0 || a.deleted.size > 0 || Object.keys(a.new).length > 0;
        if (modified) {
            const manifests = {}; const ranges = {}; const parts = [];
            let off = 0;
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

function fixEaglerHead(headBytes) {
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

async function savePack() {
    if (!currentPack) return;
    try {
        const name = document.getElementById('outputPath').value || ('modified_' + Date.now() + '.html');

        if (currentFmt === 'gaius') {
            log('[i] Repacking Gaius...');
            
            // 1. 构建原始数据并压缩
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

            // 2. 切成原版规定的 8388608 字节（原版 Python 的切法）
            const CHUNK_SIZE = 8388608; 
            const chunks = [];
            
            for (let i = 0; i < gz.length; i += CHUNK_SIZE) {
                const chunkBytes = gz.subarray(i, Math.min(i + CHUNK_SIZE, gz.length));
                
                // 【核心修复】用二进制转字符串，再转 base64，只对这一个块转
                let binary = '';
                const INNER_CHUNK = 0x8000;
                for (let j = 0; j < chunkBytes.length; j += INNER_CHUNK) {
                    const sub = chunkBytes.subarray(j, Math.min(j + INNER_CHUNK, chunkBytes.length));
                    binary += String.fromCharCode.apply(null, sub);
                }
                
                // 转换并强制清理可能混入的异常符号
                let b64 = btoa(binary);
                chunks.push(b64);
            }

            // 3. 校验生成的 Base64 是否合法
            log(`[i] 正在执行 Base64 合法性测试...`);
            let allValid = true;
            for (let i = 0; i < chunks.length; i++) {
                try {
                    atob(chunks[i]);
                    log(`  - 块 ${i} 测试通过 (长度: ${chunks[i].length})`);
                } catch (e) {
                    allValid = false;
                    log(`  - [X] 块 ${i} 测试失败！`);
                    log(`     后缀: ...${chunks[i].substring(chunks[i].length - 30)}`);
                }
            }

            if (!allValid) throw new Error("Base64 合法性测试未通过！");

            // 4. 拼装格式
            let newArr = '[\n' + chunks.map(c => `  "${c}"`).join(',\n') + '\n]';

            // 5. 文本替换与输出
            const beforeStr = currentPack.htmlBin.substring(0, currentPack.found.open);
            const afterStr = currentPack.htmlBin.substring(currentPack.found.close + 1);
            const finalHtml = beforeStr + newArr + afterStr;

            const outBytes = new Uint8Array(finalHtml.length);
            for (let i = 0; i < finalHtml.length; i++) {
                outBytes[i] = finalHtml.charCodeAt(i) & 0xFF;
            }

            downloadBlob(new Blob([outBytes], { type: 'text/html' }), name);
            log(`[✓] ${t('repackSuccess')}`);
            return;
        }

        // --- Eagler26 保持不变 ---
        log('[i] Repacking Eagler26...');
        rebuildEaglerRes();

        log('[i] Updating meta...');
        await updateEaglerMeta();

        const headStr = currentPack.head;
        const headBytes = encodeUtf8(headStr);
        const fixedHead = fixEaglerHead(headBytes);

        const parts = [];
        parts.push(fixedHead);

        const E_CHUNK = 8 * 1024 * 1024;
        const CHUNK_OPEN = '<script type="application/x-eagler26-chunk"';
        const TAKE = '<script>__eaglerOffline.take()</script>\n';

        const res = currentPack.res;
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
                const encoded = currentPack.codec.encode(piece);
                parts.push(encoded);
                parts.push(encodeUtf8('</script>' + TAKE));
                off += piece.length;
                chunkCount++;
            }
        }

        parts.push(encodeUtf8(currentPack.tail));

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
    }
}

document.getElementById('dropZone').onclick = () => {
    if (currentPack) return;
    document.getElementById('fileInput').click();
};

document.getElementById('fileInput').onchange = (e) => {
    if (!e.target.files.length) return;
    if (e.target.files.length > 1) {
        log('[X] Please select only one file');
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
    if (currentPack) return;
    if (e.dataTransfer.files.length) {
        if (e.dataTransfer.files.length > 1) {
            log('[X] Please drop only one file');
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