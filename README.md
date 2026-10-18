# eag26-editor (Web 版)

**在线体验：[https://enchantment-niko.github.io/eag26-editor/](https://enchantment-niko.github.io/eag26-editor/)**

浏览、修改、重打包 [Gaius](https://github.com/TypeThe0ry/Gaius) 与 GoldHQ 单文件 HTML 中的嵌入式资源。

## Languages / 语言

简体中文 | [English](README_en.md)

## 简介

`eag26-editor` 是一个纯前端工具，用于编辑**单文件 HTML 客户端**（如 Minecraft 客户端）中嵌入的资源。它**自动识别**以下两种格式：

- **Gaius WebGL2 Minecraft** —— 解析 `embedded.vanilla` 数组 + `GAIUSVP1` 容器
- **GoldHQ** —— 解析 `application/x-eagler26-chunk` 分片 + 自定义转义 + Fletcher 校验

你可以像操作普通资源包一样**浏览、修改、注入**资源，并可选对启动器文本进行汉化。

### ✨ Web 版特色
- **免安装**：直接在浏览器中打开网页即可使用，无需配置任何环境。
- **安全并发**：采用 Blob Worker 架构，大文件解包和重打包在后台线程运行，UI 永不卡顿。
- **单文件架构**：借助 `pako.js` 直接在内存中处理 Gzip 与 Base64，零服务器成本。
- **无损二进制处理**：彻底攻克 Eagler26 的 `windows-1252` 编码黑洞，原生保留每一个字节。
- **Eagler26 二级资源**：完全支持 `assets.idx` + `assets.bin`、`audio/*.idx` + `*.bin` 的虚拟目录解析与重打包。

## 前置准备

**本工具不附带客户端 HTML。** 你需要自行获取对应的单文件 HTML：

- **GoldHQ 客户端**: https://client.goldhq.net/
- **Gaius Releases 构建**: https://github.com/TypeThe0ry/Gaius/releases

下载后得到一个 `.html` 文件，直接拖拽到网页中的虚线框，或点击打开即可。

**如果客户端更新、格式变化，工具可能失效**。遇到问题请在 [Issues](https://github.com/Enchantment-Niko/eag26-editor/issues) 反馈新版 HTML 的 `eagler26-offline-meta`（Eagler26）或 `embedded.vanilla`（Gaius）内容。

---

## 功能介绍

### 自动识别

打开文件时自动嗅探格式：

| 格式 | 识别特征 |
|---|---|
| Gaius | `embedded.vanilla` 数组 / `GAIUSVP1` magic |
| GoldHQ | `application/x-eagler26-chunk` / `eagler26-offline-meta` |

无需手动选择，打开即用。

---

### Gaius 格式

#### 解析
- 从 Gaius 单文件 HTML 中提取 `embedded.vanilla` 的 base64 分片
- 拼接、Gzip 解压、解析 `GAIUSVP1` 容器
- 读取 JSON 索引与数据区

#### 写回
- 写回 HTML：重建 `GAIUSVP1` → Gzip → Base64 分片 → 替换 `vanilla` 数组
- 支持导出裸包

#### 启动器汉化
- 覆盖初始状态、进度文案、状态文案、错误提示、外壳 UI、按钮文案
- 仅对 HTML 输出生效；在“选项”中勾选即可。

---

### GoldHQ 格式

#### 解析
- 扫描 `<script type="application/x-eagler26-chunk" data-r="..." data-len="..." data-sum="...">`
- 按字节无损提取，并使用原生 `Uint8Array` 进行转义处理（`ESC` 转义 + `unsafe` 表），**彻底解决浏览器 UTF-8 解码导致的字节损坏问题**。
- 每片用 **Fletcher 变种校验**（逐字节，自然溢出 2^32，最后 `(s1 & 0xffff) ^ (s2 << 16)`）
- 按 HTML 中的出现顺序拼接多片
- 解析 `eagler26-offline-meta` 与 `eagler26-build` 两个清单

#### 一级资源
所有顶层 chunk，包括：
- `boot-screen.js`、`browser-*.js`、`client.js`
- `wasm/*.wasm`、`*.wasm-runtime.js`
- `assets/assets.idx`、`assets/assets.bin`
- `audio/*.idx`、`*.bin`

#### 二级资源（虚拟目录）
| 虚拟前缀 | 内容 |
|---|---|
| `__ASSETS__/...` | `assets.idx` + `assets.bin` 展开后的 21500+ 个 MC 资源（纹理、模型、语言、字体等） |
| `__AUDIO__/sfx/...` | `audio/sfx-*.idx` + `*.bin` 展开的音效 |
| `__AUDIO__/music/...` | 背景音乐 |
| `__AUDIO__/records/...` | 唱片 |
| `__AUDIO__/sfx-opt/...` | 优化版音效 |

**这些虚拟目录只是 UI 里的组织方式，写回时仍按原格式重打包，不改变最终结构。**

#### 写回
- 重建 `assets.idx` / `assets.bin`（如果二级被改动）
- 重建 `audio/*.idx` / `*.bin`
- 自动更新 `eagler26-offline-meta.resources` 里每个资源的 `size` / `stored` / `sha256`
- 自动更新 `eagler26-build` 清单
- 重写每个 chunk 的 `data-len` / `data-sum`
- 按原始顺序写回，保留 `__eaglerOffline.take()` 脚本和 `<script>` 结构

---

## 使用方法

### 典型流程

#### 改 Gaius 资源
1. 打开网站，拖入已下载的 Gaius 客户端单 HTML 构建。
2. 左侧展开到 `assets/minecraft/textures/...`。
3. 选中目标 PNG，点 `导出选中...` 到本地。
4. 用画图 / PS / Aseprite 修改。
5. 点 `替换...` 选回修改好的文件。
6. 在顶部“文件”处填好输出文件名，点 `保存并重打包`。

#### 改一张 MC 纹理（GoldHQ）
1. 拖入已下载的 GoldHQ 客户端单 HTML。
2. 左侧展开 `__ASSETS__/assets/minecraft/textures/...`。
3. 选中目标 PNG，点 `导出选中...`。
4. 修改后，点 `替换...`。
5. 点 `保存并重打包`，浏览器会自动下载新的 HTML。

#### 改音效（GoldHQ）
1. 展开 `__AUDIO__/sfx-opt/...`，选中 OGG 文件。
2. `导出选中...` → 编辑 → `替换...`。
3. `保存并重打包`。

#### 加中文字体（GoldHQ）
1. 从正版 MC jar 提取 `unifont.zip` / `unifont_jp.zip`。
2. 点 `添加...`，路径填：
   ```
   __ASSETS__/assets/minecraft/font/unifont.zip
   __ASSETS__/assets/minecraft/font/unifont_jp.zip
   ```
3. 编辑 `__ASSETS__/assets/minecraft/font/include/unifont.json`，内容改为：
   ```json
   {
     "providers": [
       { "type": "unihex", "file": "minecraft:font/unifont_jp.zip" },
       { "type": "unihex", "file": "minecraft:font/unifont.zip" }
     ]
   }
   ```
4. `保存并重打包`。

---

## 支持格式

| 格式 | 读 | 写 |
|---|---|---|
| Gaius 单文件 HTML（`embedded.vanilla`） | ✅ | ✅ |
| `GAIUSVP1` 裸包 | ❌ | ❌ (网页版暂不支持裸包导入，仅支持 HTML) |
| GoldHQ 单文件 HTML（`x-eagler26-chunk`） | ✅ | ✅ |

---

## 技术细节

### 为什么 Web 版处理二进制如此特殊？
浏览器的 `TextDecoder('utf-8')` 会主动将 `0x80-0x9F` 的非法字节替换为 `U+FFFD`，这在 Eagler26 格式中是致命的数据损坏。本项目使用了专门的 **字节流提取法（`String.fromCharCode` + `charCodeAt & 0xFF`）**，确保 `windows-1252` 的每一个字节都原样保留。

### 校验与生成
- 打包时分为两段合并：**Head/Tail 以 UTF-8 编码**，**Chunk 数据以原始字节直接写入**，最终通过 `Uint8Array` 合并生成 `Blob` 下载。

---

## 注意事项

- **本工具不附带客户端 HTML**，请自行从官方渠道下载。
- 修改前请备份原 HTML。
- **GoldHQ 客户端要求 chunk 顺序与 `take()` 脚本严格对应**，本工具已按原顺序保留。
- **不要用会改变 HTML 编码的编辑器打开输出文件**（Eagler26 依赖 windows-1252）。
- **中文字体**：Eagler26 默认不带 unifont，需要自己加。
- **WASM 字符串**：本工具不处理，需反编译 WASM 单独改。
- **内存限制**：如果重打包的 HTML 体积过大（如超过 1GB），浏览器可能会内存溢出（OOM）。目前版本在桌面端主流浏览器（Chrome/Edge）测试通过。

---

## 许可
本项目使用 **GPL-3.0** 许可证。详见 [LICENSE](LICENSE)。

## 版权声明
Copyright (C) 2026 eag26-editor contributors

## 开发说明
本项目的部分代码与文档由 **DeepSeek AI** 辅助开发。所有 AI 生成内容均经过人工审查、修改与验证。最终代码与文档的正确性、安全性及合规性由项目维护者负责。

---

## 相关链接
- 在线工具: https://enchantment-niko.github.io/eag26-editor/
- 仓库地址: https://github.com/Enchantment-Niko/eag26-editor
- GNU GPL v3: https://www.gnu.org/licenses/gpl-3.0.html
- Gaius 仓库: https://github.com/TypeThe0ry/Gaius
- GoldHQ 客户端: https://client.goldhq.net/
