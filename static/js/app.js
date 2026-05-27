// SeoTime Bot - Frontend
const socket = io();
let accountCount = 0;
const MAX_ACCOUNTS = 20;

// ─── Account Management ───────────────────────────────────────────────────────
function addAccountRow(email = '', password = '', sessions = 1) {
    if (accountCount >= MAX_ACCOUNTS) return;
    accountCount++;
    updateAccountCount();

    const container = document.getElementById('accounts_container');
    const row = document.createElement('div');
    row.className = 'account-row';
    row.dataset.index = accountCount - 1;
    row.innerHTML = `
        <span class="num">${accountCount}</span>
        <input type="text" placeholder="Email / Login" class="acc-email" value="${email}">
        <input type="password" placeholder="Senha" class="acc-password" value="${password}">
        <input type="number" value="${sessions}" min="1" max="15" class="acc-sessions" title="Sessões simultâneas">
        <span class="label-sess">sess.</span>
        <button class="btn-remove" onclick="removeAccount(this)" title="Remover conta">✕</button>
    `;
    container.appendChild(row);
}

function addAccount() {
    addAccountRow();
}

function removeAccount(btn) {
    const row = btn.closest('.account-row');
    const container = document.getElementById('accounts_container');
    if (container.children.length <= 1) return;
    row.remove();
    accountCount--;
    updateAccountCount();
    // Re-number
    const rows = container.querySelectorAll('.account-row');
    rows.forEach((r, i) => {
        r.querySelector('.num').textContent = i + 1;
        r.dataset.index = i;
    });
}

function updateAccountCount() {
    document.getElementById('account_count').textContent = accountCount;
    document.getElementById('add_count').textContent = accountCount;
}

function getAccounts() {
    const accounts = [];
    const rows = document.querySelectorAll('.account-row');
    rows.forEach((row, index) => {
        const email = row.querySelector('.acc-email').value.trim();
        const password = row.querySelector('.acc-password').value.trim();
        const sessions = parseInt(row.querySelector('.acc-sessions').value) || 1;
        if (email && password) {
            accounts.push({ index, email, password, googleEmail: email, sessions });
        }
    });
    return accounts;
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function startAll() {
    const accounts = getAccounts();
    if (accounts.length === 0) {
        addLog('⚠ Adicione pelo menos uma conta com email e senha.', 'error');
        return;
    }
    const useProxy = document.getElementById('proxy_enabled').checked;
    socket.emit('start_all', { accounts, useProxy });
    document.getElementById('btn_start').disabled = true;
    document.getElementById('btn_start').style.opacity = '0.5';
}

function stopAll() {
    socket.emit('stop_all');
    document.getElementById('btn_start').disabled = false;
    document.getElementById('btn_start').style.opacity = '1';
    document.getElementById('sessions_table').innerHTML = '<tr class="empty-row"><td colspan="9">Nenhuma sessão ativa</td></tr>';
}

// ─── Logging ──────────────────────────────────────────────────────────────────
function addLog(message, type = '') {
    const logBox = document.getElementById('log_box');
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + type;
    // If message already has timestamp, use as-is
    if (message.startsWith('[')) {
        entry.textContent = message;
    } else {
        const time = new Date().toLocaleTimeString('pt-BR');
        entry.textContent = `[${time}] ${message}`;
    }
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;

    // Keep max 300 entries
    while (logBox.children.length > 300) {
        logBox.removeChild(logBox.firstChild);
    }
}

// ─── Socket Events ────────────────────────────────────────────────────────────
socket.on('log', (msg) => {
    let type = '';
    if (msg.includes('✓') || msg.includes('concluída') || msg.includes('Login OK')) type = 'success';
    else if (msg.includes('✗') || msg.includes('Erro') || msg.includes('falhou')) type = 'error';
    else if (msg.includes('Iniciando') || msg.includes('⏳') || msg.includes('aguardando')) type = 'warning';
    else if (msg.includes('Conectado') || msg.includes('Fazendo')) type = 'info';
    addLog(msg, type);
});

socket.on('status_update', (data) => {
    const dot = document.getElementById('status_dot');
    const text = document.getElementById('status_text');
    text.textContent = data.status;
    if (data.status === 'ONLINE') {
        dot.classList.add('online');
        document.getElementById('btn_start').disabled = true;
        document.getElementById('btn_start').style.opacity = '0.5';
    } else {
        dot.classList.remove('online');
        document.getElementById('btn_start').disabled = false;
        document.getElementById('btn_start').style.opacity = '1';
    }
});

socket.on('stats_update', (data) => {
    document.getElementById('stat_earned').textContent = data.earned + ' ₽';
    document.getElementById('stat_views').textContent = data.views;
    document.getElementById('stat_sessions').textContent = data.activeSessions;
});

socket.on('session_update', (data) => {
    const tbody = document.getElementById('sessions_table');
    const emptyRow = tbody.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    let row = document.getElementById('session_' + data.id);
    if (!row) {
        row = document.createElement('tr');
        row.id = 'session_' + data.id;
        tbody.appendChild(row);
    }

    const statusColor = data.status === 'viewing' ? 'var(--success)' :
                        data.status === 'error' || data.status === 'stopped' ? 'var(--danger)' :
                        data.status === 'waiting' || data.status === 'rate_limited' ? 'var(--warning)' :
                        data.status === 'logged_in' ? 'var(--success)' : 'var(--text-secondary)';

    row.innerHTML = `
        <td>${data.email}</td>
        <td>${data.accountIndex + 1}</td>
        <td>${data.deviceInfo}</td>
        <td>${data.ip}</td>
        <td style="color: ${statusColor}">${data.status}</td>
        <td>${data.views}</td>
        <td>${data.earned} ₽</td>
        <td class="balance">${data.balance || '0.0000'} ₽</td>
        <td title="${data.currentSite}">${data.currentSite}</td>
    `;
});

socket.on('sessions_clear', () => {
    document.getElementById('sessions_table').innerHTML = '<tr class="empty-row"><td colspan="9">Nenhuma sessão ativa</td></tr>';
});

socket.on('online_users', (users) => {
    document.getElementById('online_count').textContent = users.length;
    const tbody = document.getElementById('online_table');
    if (users.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhum usuário online</td></tr>';
        return;
    }
    tbody.innerHTML = users.map(u => `
        <tr>
            <td>${u.index}</td>
            <td>${u.email}</td>
            <td>${u.sessions}</td>
            <td>${u.views}</td>
            <td>${u.earned} ₽</td>
            <td>${u.since}</td>
        </tr>
    `).join('');
});

// ─── Saved Accounts (auto-fill from server persistence) ──────────────────────
socket.on('saved_accounts', (data) => {
    const emails = Object.keys(data);
    if (emails.length === 0 && accountCount === 0) {
        // No saved accounts, add one empty row
        addAccountRow();
        return;
    }
    if (emails.length > 0 && accountCount === 0) {
        // Fill from saved data
        const container = document.getElementById('accounts_container');
        container.innerHTML = '';
        accountCount = 0;
        for (const email of emails) {
            const info = data[email];
            addAccountRow(info.email, info.password, info.sessions || 1);
        }
    }
});

socket.on('connect', () => {
    addLog('Conectado ao servidor.', 'info');
});

socket.on('disconnect', () => {
    addLog('Desconectado do servidor. (Bots continuam rodando no servidor)', 'error');
    document.getElementById('status_dot').classList.remove('online');
    document.getElementById('status_text').textContent = 'DESCONECTADO';
});

// ─── Initialize ──────────────────────────────────────────────────────────────
// Don't add empty row on load - wait for saved_accounts event
