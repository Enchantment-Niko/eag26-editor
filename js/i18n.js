const I18N = {
    zh: {
        appTitle: "Gaius / Eagler26 编辑器 (在线版)",
        grp1: "1. 文件", grp2: "2. 选项", grp3: "3. 包信息", grp4: "4. 资源列表", grp5: "5. 预览", grp6: "6. 操作", grp7: "7. IndexedDB 注入 (仅 Gaius HTML 生效)", grp8: "8. 日志",
        dropText: "点击或拖拽文件到此处", optLocalize: "启动器汉化 (仅 Gaius HTML 生效)", notLoaded: "(未加载)",
        btnSave: "保存并重打包 (Ctrl+S)", btnSaveAs: "另存为...",
        btnAdd: "添加...", btnReplace: "替换...", btnRename: "重命名...", btnDelete: "删除",
        btnExpSel: "导出选中...", btnExpAll: "导出全部...", btnExpRaw: "导出裸包...",
        btnInjAdd: "添加文件...", btnInjRm: "移除选中", btnInjClear: "清空",
        btnLogClear: "清除", btnLogCopy: "复制", btnLogExp: "导出",
        loading: "加载中...", error: "错误", formatEagler: "格式: Eagler26", formatGaius: "格式: Gaius",
        started: "启动 | Web 版本", autoDetect: "自动识别: Gaius HTML / GAIUSVP1 / Eagler26 单文件",
        foundEagler: "识别为 Eagler26 文件，正在解包...", foundGaius: "识别为 Gaius 文件，正在提取...",
        unpackError: "解包失败", repackSuccess: "重打包成功，准备下载", deleteConfirm: "确认删除以下文件？\n\n",
        placeholderFilter: "过滤...", labelOutputName: "输出文件名", labelInjectPrefix: "目标前缀",
        msgZh: "已切换至简体中文", msgEn: "Switched to English", undo: "撤销",
        tooltipReplace: "替换", tooltipRename: "重命名", tooltipDelete: "删除", tooltipExport: "导出"
    },
    en: {
        appTitle: "Gaius / Eagler26 Editor (Online Version)",
        grp1: "1. File", grp2: "2. Options", grp3: "3. Pack Info", grp4: "4. Resource List", grp5: "5. Preview", grp6: "6. Operations", grp7: "7. IndexedDB Inject (Gaius only)", grp8: "8. Log",
        dropText: "Click or drag file here", optLocalize: "Launcher Localization (Gaius only)", notLoaded: "(Not Loaded)",
        btnSave: "Save and Repack (Ctrl+S)", btnSaveAs: "Save As...",
        btnAdd: "Add...", btnReplace: "Replace...", btnRename: "Rename...", btnDelete: "Delete",
        btnExpSel: "Export Selected...", btnExpAll: "Export All...", btnExpRaw: "Export Raw Pack...",
        btnInjAdd: "Add File...", btnInjRm: "Remove", btnInjClear: "Clear",
        btnLogClear: "Clear", btnLogCopy: "Copy", btnLogExp: "Export",
        loading: "Loading...", error: "Error", formatEagler: "Format: Eagler26", formatGaius: "Format: Gaius",
        started: "Started | Web Version", autoDetect: "Auto-detect: Gaius HTML / GAIUSVP1 / Eagler26",
        foundEagler: "Eagler26 detected, unpacking...", foundGaius: "Gaius detected, extracting...",
        unpackError: "Unpack failed", repackSuccess: "Repack success, preparing download", deleteConfirm: "Confirm delete?\n\n",
        placeholderFilter: "Filter...", labelOutputName: "Output Filename", labelInjectPrefix: "Target Prefix",
        msgZh: "已切换至简体中文", msgEn: "Switched to English", undo: "Undo",
        tooltipReplace: "Replace", tooltipRename: "Rename", tooltipDelete: "Delete", tooltipExport: "Export"
    }
};

let currentLang = 'zh';
function t(key) { return I18N[currentLang][key] || key; }

function toggleLang() {
    const prevLang = currentLang;
    currentLang = currentLang === 'zh' ? 'en' : 'zh';
    setLanguage(currentLang);
    
    if (typeof mdui !== 'undefined') {
        mdui.snackbar({
            message: currentLang === 'zh' ? t('msgZh') : t('msgEn'),
            action: t('undo'),
            onActionClick: () => {
                setLanguage(prevLang);
            }
        });
    }
}

function setLanguage(lang) {
    if (lang !== 'zh' && lang !== 'en') return;
    currentLang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) el.textContent = t(key);
    });

    document.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
        const key = el.getAttribute('data-i18n-tooltip');
        if (key) el.setAttribute('content', t(key));
    });

    const updateMduiInput = (id, labelKey, placeholderKey) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (labelKey) el.label = t(labelKey);
        if (placeholderKey) el.placeholder = t(placeholderKey);
        if (el.requestUpdate) el.requestUpdate();
        if (el.updateComplete) el.updateComplete.then(() => {
            if (el.shadowRoot) {
                const lbl = el.shadowRoot.querySelector('.mdui-text-field__label');
                if (lbl && labelKey) lbl.textContent = t(labelKey);
                const inp = el.shadowRoot.querySelector('input');
                if (inp && placeholderKey) inp.placeholder = t(placeholderKey);
            }
        });
    };

    updateMduiInput('outputPath', 'labelOutputName');
    updateMduiInput('injectPrefix', 'labelInjectPrefix');
    updateMduiInput('searchInput', null, 'placeholderFilter');

    if (window.currentPack && typeof renderTree === 'function') renderTree();
}