window.WORKER_CODE = `
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
    while (clean.length % 4 !== 0) { clean += '='; }
    try { return atob(clean); } catch (e) { return ""; }
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

async function handleGaius(bytes) {
    wLog('开始提取 vanilla 数组...');
    const html = decodeUtf8(bytes);
    const found = extractVanilla(html);
    if (!found) throw new Error("Vanilla array not found in HTML.");
    
    let binary = '';
    for (const c of found.chunks) binary += safeAtob(c);
    
    const raw = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) raw[i] = binary.charCodeAt(i);

    wLog('正在执行 Gzip 解压...');
    let dec;
    try { dec = pako.inflate(raw); } catch (e) { throw new Error("Gzip failed."); }
    
    const idxLen = new DataView(dec.buffer).getUint32(8, true);
    const index = JSON.parse(decodeUtf8(dec.slice(12, 12 + idxLen)));
    const data = dec.slice(12 + idxLen);
    wLog('Gaius 包解析完成。');
    return { format: 'gaius', index, data, html, found };
}

async function handleEagler(bytes) {
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
    wLog('正在合并 Chunk 数据并解码...');
    
    // 核心修复：不再用 reduce 算死大小，而是先组合成字符串或 Blob 规避巨量内存分配
    for (const [p, arr] of Object.entries(byPath)) {
        // 单独解码每一块
        const decodedChunks = arr.map(chunk => codec.decode(chunk));
        // 计算总大小
        let totalSize = 0;
        for (const c of decodedChunks) totalSize += c.length;
        // 分配并填入
        const raw = new Uint8Array(totalSize);
        let off = 0;
        for (const c of decodedChunks) {
            raw.set(c, off);
            off += c.length;
        }
        res[p] = raw;
    }

    wLog('正在解析 assets 与 audio 索引...');
    const assets = { ranges: {}, blob: new Uint8Array(), dirty: {}, deleted: new Set(), new: {}, order: [] };
    
    // 优先确保 assets 被解析
    if (res['assets/assets.idx'] && res['assets/assets.bin']) {
        try {
            assets.ranges = JSON.parse(decodeUtf8(pako.inflate(res['assets/assets.idx']))).ranges;
            assets.blob = pako.inflate(res['assets/assets.bin']);
            assets.order = Object.keys(assets.ranges);
            wLog('assets.idx 与 assets.bin 解析成功，共计 ' + assets.order.length + ' 个文件');
        } catch(e) {
            wLog('assets 解析失败: ' + e.message);
        }
    } else {
        wLog('警告: 找不到 assets.idx 或 assets.bin，可能不是标准的 GoldHQ 文件结构');
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
                wLog('audio ' + lbl + ' 解析成功，共计 ' + audio.order[lbl].length + ' 个文件');
            } catch(e) {}
        }
    }
    
    wLog('Eagler26 包解析完成。');
    return { format: 'eagler', meta, codec, res, html, assets, audio };
}

self.onmessage = async (e) => {
    try {
        const { action, fileData } = e.data;
        if (action === 'load') {
            wLog('收到文件数据，开始自动识别格式...');
            const head = decodeUtf8(fileData.slice(0, 1024 * 1024));
            let pack, fmt;
            if (head.includes('x-eagler26-chunk') || head.includes('eagler26-offline-meta')) {
                pack = await handleEagler(fileData);
                fmt = 'eagler';
            } else if (head.includes('GAIUSVP1') || head.includes('vanilla')) {
                pack = await handleGaius(fileData);
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