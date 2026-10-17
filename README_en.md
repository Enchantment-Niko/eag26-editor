# eagler26-editor

A tool to browse, modify, and repack resources inside [Gaius](https://github.com/TypeThe0ry/Gaius) and GoldHQ single-file HTML Minecraft builds.

## Languages / 语言

[简体中文](README.md) | English

## Introduction

`eagler26-editor` is a Python-based tool for editing embedded resources in **single-file HTML clients**. It **automatically detects** the following two formats:

- **Gaius WebGL2 Minecraft** -- Parses the `embedded.vanilla` array + `GAIUSVP1` container.
- **GoldHQ** -- Parses `application/x-eagler26-chunk` slices + custom escaping + Fletcher checksum.

You can **browse, modify, and inject** resources just like a standard resource pack, with an optional localization feature for the launcher text.

### Features

- Pure Python standard library implementation (no third-party dependencies).
- Auto-format detection. Open and use instantly.
- GUI + Multithreading for smooth loading and saving.
- Supports single-file level Add / Replace / Rename / Delete.
- Supports exporting single files, all files, or raw packs.
- **Eagler26 Extra Support**: Handles secondary resources like `assets.idx` + `assets.bin`, and `audio/*.idx` + `*.bin`.
- Optional launcher text localization (Gaius HTML).

## Prerequisites

**This tool does NOT include the client HTML.** You need to download the corresponding single-file HTML yourself:

- **GoldHQ Client**: https://client.goldhq.net/
- **Gaius Releases**: https://github.com/TypeThe0ry/Gaius/releases

Once downloaded, you will get an `.html` file. **Use it directly as the input.**

**Note**: If the client updates and the internal format changes, the tool may break. If you encounter issues, please provide the new `eagler26-offline-meta` (Eagler26) or `embedded.vanilla` (Gaius) content.

---

## Supported Formats

| Format | Read | Write |
|---|---|---|
| Gaius 26.3 Single-file HTML (`embedded.vanilla`) | Yes | Yes |
| `GAIUSVP1` Raw Pack (`.gz` / `.pack`) | Yes | Yes |
| GoldHQ Single-file HTML (`x-eagler26-chunk`) | Yes | Yes |

---

## Usage

### Launch

```bash
python eagler26-editor.py
```

### Typical Workflows

#### Modifying Gaius Resources

1. Click **Open...**, select the downloaded Gaius client single HTML build.
2. Expand `assets/minecraft/textures/...` on the left.
3. Select the target PNG.
4. Click **Export Selected...** to save it locally.
5. Modify the image using Paint, PS, Aseprite, etc.
6. Click **Replace...**.
7. Fill in the new path in the **Output** field.
8. Click **Save and Repack**.

#### Enabling Launcher Localization (Gaius)

1. Check the **Launcher Localization (Gaius HTML only)** box.
2. Click **Save and Repack**.
3. The output HTML's boot text will be localized.

#### Modifying an MC Texture (GoldHQ)

1. Click **Open...**, select the downloaded GoldHQ client single HTML build.
2. Expand `__ASSETS__/assets/minecraft/textures/...` on the left.
3. Select the target PNG.
4. Click **Export Selected...** to save it locally.
5. Modify the image using Paint, PS, Aseprite, etc.
6. Click **Replace...**, and choose the modified PNG.
7. Click **Save and Repack**.
8. Open the output HTML in your browser.

#### Modifying Sound Effects (GoldHQ)

1. Expand `__AUDIO__/sfx-opt/...`.
2. Select the target OGG file.
3. Click **Export Selected...** -> Edit -> Click **Replace...**.
4. Click **Save and Repack**.

#### Adding Chinese Fonts (GoldHQ)

1. Extract `unifont.zip` / `unifont_jp.zip` from the vanilla MC jar.
2. Click **Add File...**, and fill in the path:
   ```
   __ASSETS__/assets/minecraft/font/unifont.zip
   __ASSETS__/assets/minecraft/font/unifont_jp.zip
   ```
3. Edit `__ASSETS__/assets/minecraft/font/include/unifont.json`, changing the content to:
   ```json
   {
     "providers": [
       {
         "type": "unihex",
         "file": "minecraft:font/unifont_jp.zip"
       },
       {
         "type": "unihex",
         "file": "minecraft:font/unifont.zip"
       }
     ]
   }
   ```
4. Click **Save and Repack**.

#### Adding New Files (Both Formats)

1. Click **Add File...**.
2. Select the local file.
3. Enter the in-pack path in the popup (**GoldHQ uses the `__ASSETS__/...` prefix**).
4. Click **Save and Repack**.

#### Exporting Backup Only

1. Click **Export All...**.
2. Select an empty directory.
3. You will get the complete resource tree (**GoldHQ will have `__ASSETS__/` and `__AUDIO__/` prefixes**).

---

## Technical Details

### Gaius

- `embedded.vanilla` = base64 slice array.
- Concatenate -> gunzip -> `GAIUSVP1` container.
- Container = `MAGIC (8B)` + `index_len (4B)` + `JSON Index` + `Data Region`.
- Index = `{ path: [offset, length] }`.

### GoldHQ

- Each resource = several `<script type="application/x-eagler26-chunk">` tags.
- Chunk attributes: `data-r` (path), `data-len` (decoded length), `data-sum` (Fletcher checksum).
- **Encoding**: Raw bytes are written as `windows-1252`. The 36 bytes in the `unsafe` table (`0x00`, `0x0D`, `0x3C`, `0x3D`, `0x80`-`0x9F`) are escaped using `ESC` + `(BASE + index)`.
- **Checksum**: Byte-by-byte `s1 = (s1+c) & 0xFFFFFFFF; s2 = (s2+s1) & 0xFFFFFFFF`, final `sum = (s1 & 0xffff) ^ (s2 << 16)`.
- **Meta**: `eagler26-offline-meta` contains `encoding` (esc/base/unsafe), `resources` (for client validation), and `build` (packaging info).
- **Secondary**: `assets.idx` + `assets.bin` is "JSON index + data concatenation", `manifest.assets` + `ranges`; `audio/*.idx` + `*.bin` follows the same logic.

---

## Dependencies

- Python 3.8+
- Standard library only: `tkinter`, `gzip`, `json`, `base64`, `struct`, `re`, `os`, `sys`, `hashlib`, `threading`, `queue`, `binascii`, `traceback`.

---

## Important Notes

- **This tool does NOT include the client HTML.** Please download from the corresponding official channels.
- Please backup the original HTML before modifying.
- Do not use the same name for input and output HTML to avoid overwriting.
- **The GoldHQ client requires the chunk order to strictly correspond with the `take()` script. This tool preserves the original order.**
- **The `eagler26-offline-meta.resources` and `eagler26-build` in GoldHQ will be synchronized and updated**, otherwise the client will report an `incomplete` error on startup.
- **Do not open the output file with editors that change HTML encoding** (Eagler26 relies on windows-1252).
- **Gaius only reads top-level resources**; **Eagler26 additionally supports `__ASSETS__/` and `__AUDIO__/` secondary resources**.
- **Chinese Fonts**: Eagler26 does not include unifont by default, you need to add it yourself (see "Adding Chinese Fonts" above).
- **Strings in WASM**: This tool does not process them; you need to decompile the WASM separately to modify them.
- **The format may change after client updates**. If the tool breaks, please provide feedback on the new manifest.

---

## License

This project is licensed under **GPL-3.0**. See [LICENSE](LICENSE) for details.

## Copyright Notice

Copyright (C) 2026 gaius-eagler26-res-editor contributors

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see <https://www.gnu.org/licenses/>.

## Development Notes

Parts of the code and documentation for this project were assisted by **DeepSeek AI**.

All AI-generated content has been reviewed, modified, and verified manually. The correctness, security, and compliance of the final code and documentation are the responsibility of the project maintainers.

---

## Related Links

- GNU GPL v3: https://www.gnu.org/licenses/gpl-3.0.html
- Gaius Repository: https://github.com/TypeThe0ry/Gaius
- GoldHQ Client: https://client.goldhq.net/
