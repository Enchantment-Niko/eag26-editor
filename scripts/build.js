const fs = require('fs');
const pako = require('pako');

async function fetchBuffer(url) {
    console.log(`下载中: ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`下载失败: ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
}

async function getGaius263Url() {
    console.log('正在查询 Gaius 最新 26.3 链接...');
    const res = await fetch('https://api.github.com/repos/TypeThe0ry/Gaius/releases', {
        headers: { 'User-Agent': 'Node.js' }
    });
    if (!res.ok) throw new Error(`获取 Release 失败: ${res.statusText}`);
    
    const releases = await res.json();
    for (const release of releases) {
        const asset = release.assets.find(a => 
            a.name.includes('26.3') && a.name.endsWith('.html') && !a.name.endsWith('.gz')
        );
        if (asset) {
            console.log(`[Gaius] 匹配到: ${asset.name}`);
            return asset.browser_download_url;
        }
    }
    throw new Error('未找到 Gaius 26.3 的 HTML 文件！');
}

function unpackGaius(fileBuffer) {
    const html = fileBuffer.toString('latin1');
    const keyPos = html.indexOf('"vanilla":[') !== -1 ? html.indexOf('"vanilla":[') : html.indexOf('vanilla:[');
    if (keyPos === -1) throw new Error("找不到 vanilla 数组");

    const open = html.indexOf('[', keyPos);
    let depth = 0, close = -1;
    for (let i = open; i < html.length; i++) {
        if (html[i] === '[') depth++;
        if (html[i] === ']') {
            depth--;
            if (depth === 0) { close = i; break; }
        }
    }

    const body = html.substring(open + 1, close);
    const matches = body.match(/"([^"]*)"/g) || [];
    const buffers = matches.map(m => Buffer.from(m.slice(1, -1), 'base64'));
    const combined = Buffer.concat(buffers);

    const inflated = pako.inflate(combined);
    
    // 【修复 1】将 Uint8Array 转换为 Buffer，以便使用 readUInt32LE
    const inflatedBuf = Buffer.from(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    
    const idxLen = inflatedBuf.readUInt32LE(8);
    const index = JSON.parse(new TextDecoder('utf-8').decode(inflatedBuf.subarray(12, 12 + idxLen)));
    const data = inflatedBuf.subarray(12 + idxLen);

    return { html, index, data, openPos: open, closePos: close };
}

function repackGaius(pack) {
    const idxBytes = Buffer.from(new TextEncoder().encode(JSON.stringify(pack.index).replace(/ /g, '')));
    const header = Buffer.alloc(12);
    header.write('GAIUSVP1', 0);
    header.writeUInt32LE(idxBytes.length, 8);
    
    const raw = Buffer.concat([header, idxBytes, pack.data]);
    
    // 【修复 2】pako.gzip 返回的是 Uint8Array，Node 的 Buffer.concat 需要 Buffer，转换一下
    const gz = Buffer.from(pako.gzip(raw));
    
    const chunks = [];
    const CHUNK_SIZE = 8388608;
    for (let i = 0; i < gz.length; i += CHUNK_SIZE) {
        chunks.push(gz.subarray(i, i + CHUNK_SIZE).toString('base64'));
    }
    
    const newArr = '[\n' + chunks.map(c => `  "${c}"`).join(',\n') + '\n]';
    return Buffer.from(pack.html.substring(0, pack.openPos) + newArr + pack.html.substring(pack.closePos + 1), 'latin1');
}

async function main() {
    console.log('\n--- 1. 准备汉化数据 ---');
    const zhJsonUrl = 'https://assets.mcasset.cloud/26.3/assets/minecraft/lang/zh_cn.json';
    const zhBuffer = await fetchBuffer(zhJsonUrl);
    let zhObj = JSON.parse(zhBuffer.toString('utf-8'));
    
    zhObj["menu.modded"] = "（由 Github@Enchantment-Niko 汉化）";
    zhObj["options.languageAccuracyWarning"] = "（语言翻译不一定 100% 准确，由 Github@Enchantment-Niko 逆向 & 汉化）";
    zhObj["language.name"] = "简体中文";
    zhObj["language.code"] = "zh_cn";
    
    const zhJsonBuffer = Buffer.from(JSON.stringify(zhObj), 'utf-8');

    console.log('\n--- 2. 处理 Gaius 26.3 ---');
    const gaiusUrl = await getGaius263Url();
    const gaiusBuffer = await fetchBuffer(gaiusUrl);
    const gaiusPack = unpackGaius(gaiusBuffer);
    
    let foundGaius = false;
    for (const p in gaiusPack.index) {
        if (p.endsWith('en_us.json')) {
            console.log(`[Gaius] 替换文件: ${p}`);
            gaiusPack.index[p] = [gaiusPack.data.length, zhJsonBuffer.length];
            gaiusPack.data = Buffer.concat([gaiusPack.data, zhJsonBuffer]);
            foundGaius = true;
            break;
        }
    }
    if (!foundGaius) throw new Error('Gaius 未找到 en_us.json');

    const outGaius = repackGaius(gaiusPack);
    fs.writeFileSync('./Gaius-26.3-CN.html', outGaius);
    console.log('✅ 生成文件: Gaius-26.3-CN.html');
}

main().catch(err => {
    console.error('❌ 构建失败:', err);
    process.exit(1);
});