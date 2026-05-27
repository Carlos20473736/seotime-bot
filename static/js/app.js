// SeoTime Bot - Frontend
const socket = io();
let accountCount = 1;
const MAX_ACCOUNTS = 20;
const sessionsData = {};

// ─── Account Management ───────────────────────────────────────────────────────
function addAccount() {
    if (accountCount >= MAX_ACCOUNTS) return;
    accountCount++;
    updateAccountCount();

    const container = document.getElementById('accounts_container');
    const row = document.createElement('div');
    row.className = 'account-row';
    row.dataset.index = accountCount - 1;
    row.innerHTML = `
        <span class="num">${accountCount}</span>
        <input type="text" placeholder="Email / Login" class="acc-email">
        <input type="password" placeholder="Senha" class="acc-password">
        <input type="number" value="1" min="1" max="15" class="acc-sessions" title="Sessões simultâneas">
        <span class="label-sess">sess.</span>
        <button class="btn-remove" onclick="removeAccount(this)" title="Remover conta">✕</button>
    `;
    container.appendChild(row);
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
    document.getElementById('sessions_table').innerHTML = '<tr class="empty-row"><td colspan="8">Nenhuma sessão ativa</td></tr>';
}

// ─── Logging ──────────────────────────────────────────────────────────────────
function addLog(message, type = '') {
    const logBox = document.getElementById('log_box');
    const entry = document.createElement('div');
    entry.className = 'log-entry ' + type;
    const time = new Date().toLocaleTimeString('pt-BR');
    entry.textContent = `[${time}] ${message}`;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;

    // Keep max 200 entries
    while (logBox.children.length > 200) {
        logBox.removeChild(logBox.firstChild);
    }
}

// ─── Socket Events ────────────────────────────────────────────────────────────
socket.on('log', (msg) => {
    let type = '';
    if (msg.includes('✓') || msg.includes('concluída')) type = 'success';
    else if (msg.includes('✗') || msg.includes('Erro') || msg.includes('falhou')) type = 'error';
    else if (msg.includes('Iniciando') || msg.includes('Login')) type = 'info';
    addLog(msg, type);
});

socket.on('status_update', (data) => {
    const dot = document.getElementById('status_dot');
    const text = document.getElementById('status_text');
    text.textContent = data.status;
    if (data.status === 'ONLINE') {
        dot.classList.add('online');
    } else {
        dot.classList.remove('online');
    }
});

socket.on('stats_update', (data) => {
    document.getElementById('stat_earned').textContent = data.earned + ' ₽';
    document.getElementById('stat_views').textContent = data.views;
    document.getElementById('stat_sessions').textContent = data.activeSessions;
});

socket.on('session_update', (data) => {
    const tbody = document.getElementById('sessions_table');
    // Remove empty row
    const emptyRow = tbody.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    // Update or create row
    let row = document.getElementById('session_' + data.id);
    if (!row) {
        row = document.createElement('tr');
        row.id = 'session_' + data.id;
        tbody.appendChild(row);
    }

    const statusColor = data.status === 'viewing' ? 'var(--success)' :
                        data.status === 'error' ? 'var(--danger)' :
                        data.status === 'waiting' ? 'var(--warning)' : 'var(--text-secondary)';

    row.innerHTML = `
        <td>${data.email}</td>
        <td>${data.accountIndex + 1}</td>
        <td>${data.deviceInfo}</td>
        <td>${data.ip}</td>
        <td style="color: ${statusColor}">${data.status}</td>
        <td>${data.views}</td>
        <td>${data.earned} ₽</td>
        <td title="${data.currentSite}">${data.currentSite}</td>
    `;
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

socket.on('connect', () => {
    addLog('Conectado ao servidor.', 'info');
});

socket.on('disconnect', () => {
    addLog('Desconectado do servidor.', 'error');
    document.getElementById('status_dot').classList.remove('online');
    document.getElementById('status_text').textContent = 'OFFLINE';
});
