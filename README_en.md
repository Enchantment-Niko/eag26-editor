# eag26-editor (Web Edition)

**Try it online: [https://enchantment-niko.github.io/eag26-editor/](https://enchantment-niko.github.io/eag26-editor/)**

A tool to browse, modify, and repack resources inside single-file HTML Minecraft builds (e.g., Gaius, GoldHQ).

> ⚠️ **Important Notice regarding Gaius**
> Due to a DMCA takedown notice, the original Gaius repository and its Releases have been disabled and removed by GitHub. This tool is purely a local resource parser. **It does NOT host, include, or distribute any game clients or copyright-infringing HTML files.** If you have obtained an HTML file through other means, this tool can still parse and modify it.

## Languages / 语言

[简体中文](README.md) | English

## Introduction

`eag26-editor` is a pure front-end tool designed to edit embedded resources in **single-file HTML clients**. It **automatically detects** the following two formats:

- **Gaius WebGL2 Minecraft** -- Parses the `embedded.vanilla` array + `GAIUSVP1` container.
- **GoldHQ** -- Parses `application/x-eagler26-chunk` slices + custom escaping + Fletcher checksum.

You can **browse, modify, and inject** resources just like a standard resource pack, with an optional localization feature for the launcher text.

### ✨ Web Edition Features
- **No Installation**: Run directly in your browser. No environment setup required.
- **Blob Worker Architecture**: Unpacking and repacking heavy files are handled in a background thread, keeping the UI smooth.
- **Zero Server Cost**: Everything (Gzip, Base64, parsing) happens in memory via `pako.js`.
- **Lossless Binary Handling**: Solves the notorious `windows-1252` encoding trap in Eagler26, preserving every byte natively.
- **Eagler26 Secondary Resources**: Fully supports virtual directories like `__ASSETS__/` and `__AUDIO__/`.

## Prerequisites

**This tool does NOT include the client HTML.** You need to download the single-file HTML yourself:

- **GoldHQ Client**: https://client.goldhq.net/
- **Gaius Builds**: Please obtain them through your legally owned backups, mirrors, or community channels.

Once downloaded, simply drag and drop the `.html` file into the web page.

**Note**: If the client updates and the internal format changes, the tool may break. If you encounter issues, please open an [Issue](https://github.com/Enchantment-Niko/eag26-editor/issues) with the new `eagler26-offline-meta` or `embedded.vanilla` content.

---

## Supported Formats

| Format | Read | Write |
|---|---|---|
| Gaius Single-file HTML (`embedded.vanilla`) | Yes | Yes |
| `GAIUSVP1` Raw Pack | No | No (Web edition focuses on HTML) |
| GoldHQ Single-file HTML (`x-eagler26-chunk`) | Yes | Yes |

---

## Usage

### Typical Workflows

#### Modifying Gaius Resources
1. Open the website and drop your Gaius HTML.
2. Expand `assets/minecraft/textures/...` on the left.
3. Select a PNG and click **Export Selected...**.
4. Modify the image locally.
5. Click **Replace...** and choose your modified file.
6. Enter the output name and click **Save and Repack**.

#### Modifying an MC Texture (GoldHQ)
1. Drop your GoldHQ HTML.
2. Expand `__ASSETS__/assets/minecraft/textures/...`.
3. Select a PNG, click **Export Selected...**.
4. Modify it, click **Replace...**.
5. Click **Save and Repack**.

#### Modifying Sound Effects (GoldHQ)
1. Expand `__AUDIO__/sfx-opt/...`.
2. Export, edit, replace, and save.

#### Adding Chinese Fonts (GoldHQ)
1. Extract `unifont.zip` from the vanilla MC jar.
2. Click **Add...**, enter path `__ASSETS__/assets/minecraft/font/unifont.zip`.
3. Edit `__ASSETS__/assets/minecraft/font/include/unifont.json`:
   ```json
   {
     "providers": [
       { "type": "unihex", "file": "minecraft:font/unifont.zip" }
     ]
   }
   ```
4. Repack.

---

## Technical Details

### Why is binary handling tricky on the Web?
Browsers' `TextDecoder('utf-8')` replaces invalid bytes (`0x80-0x9F`) with `U+FFFD`, which breaks Eagler26 formats. This project uses a **lossless byte stream extraction** (`String.fromCharCode` + `charCodeAt & 0xFF`) to preserve every raw byte.

### Repacking Strategy
The output is split into two parts: **Head/Tail** (encoded as UTF-8) and **Chunk Data** (raw bytes, representing `windows-1252`). They are merged into a `Uint8Array` and downloaded as a `Blob`.

---

## Important Notes

- **This tool does NOT include the client HTML.** Please download it from official channels or legal sources.
- Backup your original HTML.
- **GoldHQ requires chunk order to strictly match the `take()` script.** This tool preserves it.
- **Do not open the output file with editors that change HTML encoding.**
- **Memory limits**: Repacking files over 1GB might cause an Out-Of-Memory (OOM) error in the browser. Tested on desktop Chrome/Edge.
- **WASM Strings**: This tool does not process them.

---

## License
This project is licensed under **GPL-3.0**.

## Disclaimer & Copyright

1. **Unofficial Tool**: This project (`eag26-editor`) is an open-source third-party resource editor. It is **not affiliated with, endorsed by, or sponsored by** Mojang Studios, Microsoft, the Gaius developers, or the GoldHQ developers.
2. **No Copyrighted Content**: This project **does NOT contain** any Minecraft game code, resource files (such as textures or sounds), or pre-built single-file clients (e.g., `Gaius-*.html`, `Eagler26-*.html`). This tool is solely for processing files obtained by the user.
3. **Compliant Use**: Please ensure you only use this tool on files you **legally own**. The developers of this tool assume no liability for any copyright disputes or legal consequences arising from the use of this tool.
4. **Trademarks**: Minecraft is a registered trademark of Microsoft Corporation. All related trademarks and copyrights belong to their respective owners.

## Development Notes
Parts of the code and documentation for this project were assisted by **DeepSeek AI**.

---

## Related Links
- Live App: https://enchantment-niko.github.io/eag26-editor/
- Repository: https://github.com/Enchantment-Niko/eag26-editor
- GNU GPL v3: https://www.gnu.org/licenses/gpl-3.0.html
- GoldHQ Client: https://client.goldhq.net/