let allRenderedItems = [];

function renderTree() {
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

let searchTimeout = null;
function filterTree() {
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
            const kw = document.getElementById('searchInput').value.toLowerCase().trim();
            for (const item of allRenderedItems) {
                if (!kw || item.path.includes(kw)) {
                    item.el.style.display = 'flex';
                } else {
                    item.el.style.display = 'none';
                }
            }
        });
    }, 100);
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
                <mdui-button variant="text" class="btn-cancel">${t('btnCancel') || 'Cancel'}</mdui-button>
                <mdui-button variant="text" class="btn-ok">${t('btnOk') || 'OK'}</mdui-button>
            </div>
        `;
        document.body.appendChild(dialog);
        dialog.open = true;
        const input = dialog.querySelector('.prompt-input');
        dialog.querySelector('.btn-cancel').onclick = () => { dialog.open = false; setTimeout(() => dialog.remove(), 300); resolve(null); };
        dialog.querySelector('.btn-ok').onclick = () => { const val = input.value.trim(); dialog.open = false; setTimeout(() => dialog.remove(), 300); resolve(val); };
    });
}

function confirmModal(title, textList) {
    return new Promise((resolve) => {
        const dialog = document.createElement('mdui-dialog');
        dialog.setAttribute('close-on-overlay-click', '');
        dialog.innerHTML = `
            <div slot="headline">${title}</div>
            <div slot="content" style="max-height: 60vh; overflow: hidden; display: flex; flex-direction: column; width: 100%;">
                <div class="dialog-content-box" style="overflow-y: auto; flex: 1;">${textList.replace(/\n/g, '<br>')}</div>
            </div>
            <mdui-button slot="action" variant="text" class="btn-cancel">${t('btnCancel') || 'Cancel'}</mdui-button>
            <mdui-button slot="action" variant="tonal" class="btn-ok">${t('btnConfirm') || 'Confirm'}</mdui-button>
        `;
        document.body.appendChild(dialog);
        dialog.open = true;
        dialog.querySelector('.btn-cancel').onclick = () => { dialog.open = false; setTimeout(() => dialog.remove(), 300); resolve(false); };
        dialog.querySelector('.btn-ok').onclick = () => { dialog.open = false; setTimeout(() => dialog.remove(), 300); resolve(true); };
    });
}

function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
}