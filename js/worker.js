window.WORKER_CODE = "(" + function () {
    "use strict";
    
    importScripts('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js');
    
    var G_MAGIC = new Uint8Array([71, 65, 73, 85, 83, 86, 80, 49]);
    var G_KEYS = ['"vanilla":[', "'vanilla':[", 'vanilla:[', '"vanilla": [', "'vanilla': [", 'vanilla: [', '"vanilla" :[', '"vanilla" : [', 'vanilla\\t:[', 'vanilla\\t: ['];
    var E_DEF_UNSAFE = [0x00, 0x0d, 0x3c, 0x3d];
    for (var _i = 0; _i < 0x20; _i++) E_DEF_UNSAFE.push(0x80 + _i);
    var E_A = '__ASSETS__/', E_U = '__AUDIO__/';
    
    function wLog(msg) { self.postMessage({ type: 'log', msg: '[Worker] ' + msg }); }
    
    /* ============ 字节流工具 ============ */
    function bytesToBinaryString(bytes) {
        var s = '';
        var CHUNK = 0x8000;
        for (var i = 0; i < bytes.length; i += CHUNK) {
            var end = Math.min(i + CHUNK, bytes.length);
            var sub = bytes.subarray(i, end);
            s += String.fromCharCode.apply(null, sub);
        }
        return s;
    }
    
    function binaryStringToBytes(str) {
        var out = new Uint8Array(str.length);
        for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
        return out;
    }
    
    function decodeUtf8(b) { return new TextDecoder('utf-8').decode(b); }
    function encodeUtf8(s) { return new TextEncoder().encode(s); }
    
    function safeAtob(base64) {
        var clean = "";
        for (var i = 0; i < base64.length; i++) {
            var c = base64.charCodeAt(i);
            if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47 || c === 61) {
                clean += base64[i];
            }
        }
        while (clean.length % 4 !== 0) clean += '=';
        try { return atob(clean); } catch (e) { return ""; }
    }
    
    function tryInflate(data) {
        if (!data || data.length < 2) return data;
        if (data[0] === 0x1f && data[1] === 0x8b) {
            try { return pako.inflate(data); }
            catch (e) {
                wLog('gzip 解压失败，按明文处理: ' + (e.message || e));
                return data;
            }
        }
        return data;
    }
    
    /* ============ ECodec ============ */
    function ECodec(esc, base, unsafe) {
        this.esc = (esc != null) ? esc : 0x3d;
        this.base = (base != null) ? base : 0x40;
        this.unsafe = Array.from(unsafe || E_DEF_UNSAFE);
        this.rev = new Map();
        for (var i = 0; i < this.unsafe.length; i++) {
            this.rev.set(this.unsafe[i], this.base + i);
        }
    }
    
    ECodec.prototype.decode = function (raw) {
        var hasEsc = false;
        for (var i = 0; i < raw.length; i++) {
            if (raw[i] === this.esc) { hasEsc = true; break; }
        }
        if (!hasEsc) return raw;
        
        var parts = [];
        var i = 0;
        while (i < raw.length) {
            var j = i;
            while (j < raw.length && raw[j] !== this.esc) j++;
            if (j > i) parts.push(raw.subarray(i, j));
            if (j + 1 >= raw.length) break;
            var k = raw[j + 1] - this.base;
            var b = (k >= 0 && k < this.unsafe.length) ? this.unsafe[k] : raw[j + 1];
            parts.push(new Uint8Array([b]));
            i = j + 2;
        }
        var total = 0;
        for (var p = 0; p < parts.length; p++) total += parts[p].length;
        var out = new Uint8Array(total);
        var off = 0;
        for (var q = 0; q < parts.length; q++) { out.set(parts[q], off); off += parts[q].length; }
        return out;
    };
    
    ECodec.prototype.encode = function (raw) {
        var out = [];
        for (var i = 0; i < raw.length; i++) {
            var b = raw[i];
            if (this.rev.has(b)) {
                out.push(this.esc);
                out.push(this.rev.get(b));
            } else {
                out.push(b);
            }
        }
        return new Uint8Array(out);
    };
    
    /* ============ Gaius 解析 ============ */
    function handleGaius(bytes) {
        wLog('开始提取 vanilla 数组...');
        var html = decodeUtf8(bytes);
        var found = null;
        for (var ki = 0; ki < G_KEYS.length; ki++) {
            var key = G_KEYS[ki];
            var pos = html.indexOf(key);
            if (pos === -1) continue;
            var depth = 0, open = html.indexOf('[', pos), close = -1, inStr = false, esc = false;
            for (var i = open; i < html.length; i++) {
                var c = html[i];
                if (inStr) {
                    if (esc) esc = false;
                    else if (c === '\\') esc = true;
                    else if (c === '"') inStr = false;
                } else {
                    if (c === '"') inStr = true;
                    else if (c === '[') depth++;
                    else if (c === ']') { depth--; if (depth === 0) { close = i; break; } }
                }
            }
            if (close !== -1) {
                var body = html.substring(open + 1, close);
                var matches = body.match(/"([^"]*)"/g) || [];
                var chunks = matches.map(function (m) { return m.slice(1, -1); });
                found = { chunks: chunks, open: open, close: close };
                break;
            }
        }
        if (!found) throw new Error("Vanilla array not found.");
        
        wLog('提取完成，正在执行 Base64 解码...');
        var binary = '';
        for (var ci = 0; ci < found.chunks.length; ci++) binary += safeAtob(found.chunks[ci]);
        var raw = new Uint8Array(binary.length);
        for (var bi = 0; bi < binary.length; bi++) raw[bi] = binary.charCodeAt(bi);
        
        wLog('解码完成，正在执行 Gzip 解压 (pako)...');
        var dec = pako.inflate(raw);
        var idxLen = new DataView(dec.buffer, dec.byteOffset, dec.byteLength).getUint32(8, true);
        var index = JSON.parse(decodeUtf8(dec.slice(12, 12 + idxLen)));
        var data = dec.slice(12 + idxLen);
        wLog('Gaius 包解析完成。');
        return { format: 'gaius', index: index, data: data, html: html, found: found };
    }
    
    /* ============ Eagler 解析 ============ */
    function handleEagler(bytes) {
        wLog('开始解析 Eagler26 HTML（字节流模式）...');
        
        var htmlBin = bytesToBinaryString(bytes);
        
        var metaMatch = htmlBin.match(/id="eagler26-offline-meta"[^>]*>([\s\S]*?)<\/script>/);
        if (!metaMatch) throw new Error("Eagler26 meta not found");
        var meta = JSON.parse(metaMatch[1]);
        var enc = meta.encoding || {};
        var codec = new ECodec(enc.escape, enc.base, enc.unsafe);
        
        wLog('正在扫描 Chunk 边界...');
        var re = /<script type="application\/x-eagler26-chunk"([^>]*)>([\s\S]*?)<\/script>/g;
        var m;
        var spans = [];
        while ((m = re.exec(htmlBin)) !== null) {
            var r = m[1].match(/data-r="([^"]+)"/);
            if (!r) continue;
            spans.push({
                start: m.index,
                end: m.index + m[0].length,
                path: r[1],
                body: m[2]
            });
        }
        
        var head = '', tail = '';
        if (spans.length > 0) {
            head = htmlBin.substring(0, spans[0].start);
            var last = spans[spans.length - 1].end;
            var TAKE_RE = /^\s*<script>\s*__?eaglerOffline\.take\(\)\s*<\/script>/;
            while (true) {
                var sub = htmlBin.substring(last);
                var tm = TAKE_RE.exec(sub);
                if (tm) {
                    last += tm[0].length;
                    if (htmlBin[last] === '\n') last++;
                } else break;
            }
            tail = htmlBin.substring(last);
        } else {
            head = htmlBin;
        }
        
        wLog('正在合并 Chunk 数据...');
        var byPath = {};
        var seenOrder = [];
        for (var si = 0; si < spans.length; si++) {
            var sp = spans[si];
            if (!byPath[sp.path]) { byPath[sp.path] = []; seenOrder.push(sp.path); }
            byPath[sp.path].push(sp.body);
        }
        
        var res = {};
        var count = 0;
        for (var pi = 0; pi < seenOrder.length; pi++) {
            var p = seenOrder[pi];
            var bodies = byPath[p];
            var decoded = bodies.map(function (b) { return codec.decode(binaryStringToBytes(b)); });
            var total = 0;
            for (var di = 0; di < decoded.length; di++) total += decoded[di].length;
            var merged = new Uint8Array(total);
            var off = 0;
            for (var dj = 0; dj < decoded.length; dj++) { merged.set(decoded[dj], off); off += decoded[dj].length; }
            res[p] = merged;
            
            count++;
            if (count % Math.max(1, Math.floor(seenOrder.length / 10)) === 0 || count === seenOrder.length) {
                wLog('合并进度: ' + count + '/' + seenOrder.length);
            }
        }
        
        wLog('正在解析 assets 与 audio 索引...');
        var assets = { ranges: {}, blob: new Uint8Array(), dirty: {}, deleted: new Set(), new: {}, order: [] };
        if (res['assets/assets.idx'] && res['assets/assets.bin']) {
            try {
                wLog('准备解析 assets.idx...');
                var rawIdx = res['assets/assets.idx'];
                wLog('assets.idx 合并后长度: ' + rawIdx.length);
                wLog('assets.idx 头8字节: ' + Array.from(rawIdx.slice(0, 8)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(' '));
                
                var idxData = tryInflate(rawIdx);
                var idxStr = decodeUtf8(idxData).replace(/^\uFEFF/, '');
                
                var start = idxStr.indexOf('{');
                var end = idxStr.lastIndexOf('}');
                if (start !== -1 && end !== -1 && end > start) {
                    var parsed = JSON.parse(idxStr.substring(start, end + 1));
                    assets.ranges = parsed.ranges || parsed;
                    assets.order = Object.keys(assets.ranges);
                    
                    wLog('准备解析 assets.bin...');
                    var binData = tryInflate(res['assets/assets.bin']);
                    assets.blob = binData;
                    wLog('成功解出 ' + assets.order.length + ' 个 assets 文件');
                } else {
                    wLog('警告: assets.idx 中找不到 JSON 对象');
                }
            } catch (e) {
                wLog('解析 assets 失败: ' + (e.message || e));
            }
        }
        
        var audio = { ranges: {}, blobs: {}, dirty: {}, deleted: {}, new: {}, order: {}, names: {} };
        var groups = [
            ['sfx', 'audio/sfx-original.idx', 'audio/sfx-original.bin'],
            ['music', 'audio/music-original.idx', 'audio/music-original.bin'],
            ['records', 'audio/records-original.idx', 'audio/records-original.bin'],
            ['sfx-opt', 'audio/sfx-optimized.idx', 'audio/sfx-optimized.bin']
        ];
        for (var gi = 0; gi < groups.length; gi++) {
            var lbl = groups[gi][0], iname = groups[gi][1], bname = groups[gi][2];
            if (res[iname] && res[bname]) {
                try {
                    wLog('准备解析 ' + lbl + ' 的 idx...');
                    var rawIdx2 = res[iname];
                    wLog(lbl + '.idx 头8字节: ' + Array.from(rawIdx2.slice(0, 8)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(' '));
                    
                    var idxData2 = tryInflate(rawIdx2);
                    var idxStr2 = decodeUtf8(idxData2).replace(/^\uFEFF/, '');
                    
                    var start2 = idxStr2.indexOf('{');
                    var end2 = idxStr2.lastIndexOf('}');
                    if (start2 === -1 || end2 === -1 || end2 <= start2) continue;
                    
                    var parsed2 = JSON.parse(idxStr2.substring(start2, end2 + 1));
                    var ranges2 = parsed2.ranges || parsed2;
                    if (!ranges2 || Object.keys(ranges2).length === 0) continue;
                    
                    audio.ranges[lbl] = ranges2;
                    audio.order[lbl] = Object.keys(ranges2);
                    audio.dirty[lbl] = {};
                    audio.deleted[lbl] = new Set();
                    audio.new[lbl] = {};
                    audio.names[lbl] = { idx: iname, bin: bname };
                    
                    var binData2 = tryInflate(res[bname]);
                    audio.blobs[lbl] = binData2;
                    
                    wLog('成功解出 ' + audio.order[lbl].length + ' 个 ' + lbl + ' 音频文件');
                } catch (e) {
                    wLog('解析 ' + lbl + ' 失败: ' + (e.message || e));
                }
            }
        }
        
        wLog('Eagler26 包解析完成。');
        
        return {
            format: 'eagler',
            meta: meta,
            codec: codec,
            res: res,
            resOrder: seenOrder,
            htmlBin: htmlBin,
            head: head,
            tail: tail,
            assets: assets,
            audio: audio
        };
    }
    
    /* ============ Worker 入口 ============ */
    self.onmessage = function (e) {
        try {
            var action = e.data.action, fileData = e.data.fileData;
            if (action === 'load') {
                wLog('收到文件数据，开始自动识别格式...');
                var headBytes = fileData.slice(0, Math.min(fileData.length, 1024 * 1024));
                var headStr = decodeUtf8(headBytes);
                var pack, fmt;
                if (headStr.indexOf('x-eagler26-chunk') !== -1 || headStr.indexOf('eagler26-offline-meta') !== -1) {
                    pack = handleEagler(fileData);
                    fmt = 'eagler';
                } else if (headStr.indexOf('GAIUSVP1') !== -1 || headStr.indexOf('vanilla') !== -1) {
                    pack = handleGaius(fileData);
                    fmt = 'gaius';
                } else {
                    throw new Error("Unrecognized format");
                }
                
                if (pack.assets && pack.assets.deleted) pack.assets.deleted = Array.from(pack.assets.deleted);
                if (pack.audio && pack.audio.deleted) {
                    for (var k in pack.audio.deleted) {
                        if (pack.audio.deleted[k] instanceof Set) {
                            pack.audio.deleted[k] = Array.from(pack.audio.deleted[k]);
                        }
                    }
                }
                
                var transferSet = new Set();
                if (pack.data && pack.data.buffer) transferSet.add(pack.data.buffer);
                if (pack.assets && pack.assets.blob && pack.assets.blob.buffer) transferSet.add(pack.assets.blob.buffer);
                if (pack.audio && pack.audio.blobs) {
                    for (var bk in pack.audio.blobs) {
                        if (pack.audio.blobs[bk] && pack.audio.blobs[bk].buffer) transferSet.add(pack.audio.blobs[bk].buffer);
                    }
                }
                if (pack.res) {
                    for (var rk in pack.res) {
                        if (pack.res[rk] && pack.res[rk].buffer) transferSet.add(pack.res[rk].buffer);
                    }
                }
                
                var transfer = Array.from(transferSet);
                self.postMessage({ status: 'ok', pack: pack, fmt: fmt }, transfer);
            }
        } catch (err) {
            wLog('解析发生错误: ' + (err.message || err));
            self.postMessage({ status: 'error', message: err.message || err });
        }
    };
}.toString() + ")();";