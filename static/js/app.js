const socket = io();

// ─── Account Management ──────────────────────────────────────────────────────
let accountCount = 0;

function addAccount(email = '', password = '', sessions = 1, googleEmail = '') {
    if (accountCount >= 20) return;
    accountCount++;
    document.getElementById('account_count').textContent = accountCount;
    document.getElementById('add_count').textContent = accountCount;

    const container = document.getElementById('accounts_container');
    const row = document.createElement('div');
    row.className = 'account-row';
    row.id = `account_row_${accountCount}`;
    row.innerHTML = `
        <input type="email" placeholder="Email" value="${email}" class="acc-email">
        <input type="password" placeholder="Senha" value="${password}" class="acc-pass">
        <input type="number" placeholder="Sessões" value="${sessions}" min="1" max="5" class="acc-sessions">
        <button class="btn btn-remove" onclick="removeAccount(this)">✕</button>
    `;
    container.appendChild(row);
}

function removeAccount(btn) {
    const row = btn.parentElement;
    row.remove();
    accountCount--;
    document.getElementById('account_count').textContent = accountCount;
    document.getElementById('add_count').textContent = accountCount;
}

// ─── Proxy Toggle ────────────────────────────────────────────────────────────
function toggleProxyFields() {
    const enabled = document.getElementById('proxy_enabled').checked;
    document.getElementById('proxy_fields').style.display = enabled ? 'block' : 'none';
}

function getProxyConfig() {
    const enabled = document.getElementById('proxy_enabled').checked;
    if (!enabled) return null;
    return {
        enabled: true,
        login: document.getElementById('proxy_login').value.trim(),
        password: document.getElementById('proxy_password').value.trim(),
        host: document.getElementById('proxy_host').value.trim() || 'gw.dataimpulse.com',
        port: parseInt(document.getElementById('proxy_port').value) || 823,
        country: document.getElementById('proxy_country').value.trim() || 'br',
    };
}

function setProxyConfig(config) {
    if (!config || !config.enabled) {
        document.getElementById('proxy_enabled').checked = false;
        document.getElementById('proxy_fields').style.display = 'none';
        return;
    }
    document.getElementById('proxy_enabled').checked = true;
    document.getElementById('proxy_fields').style.display = 'block';
    document.getElementById('proxy_login').value = config.login || '';
    document.getElementById('proxy_password').value = config.password || '';
    document.getElementById('proxy_host').value = config.host || 'gw.dataimpulse.com';
    document.getElementById('proxy_port').value = config.port || 823;
    document.getElementById('proxy_country').value = config.country || 'br';
}

// ─── Controls ────────────────────────────────────────────────────────────────
function startAll() {
    const rows = document.querySelectorAll('.account-row');
    const accounts = [];
    rows.forEach(row => {
        const email = row.querySelector('.acc-email').value.trim();
        const password = row.querySelector('.acc-pass').value.trim();
        const sessions = parseInt(row.querySelector('.acc-sessions').value) || 1;
        if (email && password) {
            accounts.push({ email, password, sessions, googleEmail: email });
        }
    });

    if (accounts.length === 0) {
        addLog('Adicione pelo menos uma conta antes de iniciar.', 'error');
        return;
    }

    const proxyConfig = getProxyConfig();

    socket.emit('start_all', { accounts, proxyConfig });
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
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString('pt-BR');
    entry.textContent = message.startsWith('[') ? message : `[${time}] ${message}`;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;

    // Keep max 200 entries
    while (logBox.children.length > 200) {
        logBox.removeChild(logBox.firstChild);
    }
}

// ─── Socket Events ───────────────────────────────────────────────────────────
socket.on('connect', () => {
    addLog('Conectado ao servidor.', 'success');
});

socket.on('disconnect', () => {
    addLog('Desconectado do servidor.', 'error');
});

socket.on('log', (msg) => {
    let type = '';
    if (msg.includes('✓') || msg.includes('Login OK') || msg.includes('concluída')) type = 'success';
    else if (msg.includes('✗') || msg.includes('falhou') || msg.includes('Erro')) type = 'error';
    else if (msg.includes('⏳') || msg.includes('⚠') || msg.includes('🔄') || msg.includes('aguardando')) type = 'warning';
    addLog(msg, type);
});

socket.on('status_update', (data) => {
    document.getElementById('status_text').textContent = data.status;
    document.getElementById('status_dot').style.background = data.color;
    if (data.status === 'ONLINE') {
        document.getElementById('btn_start').disabled = true;
        document.getElementById('btn_start').style.opacity = '0.5';
    } else {
        document.getElementById('btn_start').disabled = false;
        document.getElementById('btn_start').style.opacity = '1';
    }
});

socket.on('stats_update', (data) => {
    document.getElementById('stat_earned').textContent = `${data.earned} ₽`;
    document.getElementById('stat_views').textContent = data.views;
    document.getElementById('stat_sessions').textContent = data.activeSessions;
});

socket.on('session_update', (session) => {
    const table = document.getElementById('sessions_table');
    // Remove empty row
    const emptyRow = table.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    let row = document.getElementById(`session_${session.id}`);
    if (!row) {
        row = document.createElement('tr');
        row.id = `session_${session.id}`;
        table.appendChild(row);
    }
    row.innerHTML = `
        <td>${session.email}</td>
        <td>${session.accountIndex + 1}</td>
        <td>${session.deviceInfo}</td>
        <td>${session.ip}</td>
        <td><span class="status-badge ${session.status}">${session.status}</span></td>
        <td>${session.views}</td>
        <td>${session.earned} ₽</td>
        <td>${session.balance} ₽</td>
        <td class="site-url">${session.currentSite}</td>
    `;
});

socket.on('sessions_clear', () => {
    document.getElementById('sessions_table').innerHTML = '<tr class="empty-row"><td colspan="9">Nenhuma sessão ativa</td></tr>';
});

socket.on('online_users', (users) => {
    document.getElementById('online_count').textContent = users.length;
    const table = document.getElementById('online_table');
    if (users.length === 0) {
        table.innerHTML = '<tr class="empty-row"><td colspan="6">Nenhum usuário online</td></tr>';
        return;
    }
    table.innerHTML = users.map(u => `
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

// ─── Saved Accounts (auto-fill from persistence) ─────────────────────────────
socket.on('saved_accounts', (data) => {
    if (!data || Object.keys(data).length === 0) {
        // No saved accounts, add one empty row
        if (accountCount === 0) addAccount();
        return;
    }

    // Clear existing rows and rebuild from saved data
    document.getElementById('accounts_container').innerHTML = '';
    accountCount = 0;

    for (const email of Object.keys(data)) {
        const info = data[email];
        addAccount(info.email, info.password, info.sessions || 1, info.googleEmail || '');
    }

    // Restore proxy config from first saved account
    const firstKey = Object.keys(data)[0];
    if (data[firstKey] && data[firstKey].proxyConfig) {
        setProxyConfig(data[firstKey].proxyConfig);
    }
});

// ─── Proxy Config from server ────────────────────────────────────────────────
socket.on('proxy_config', (config) => {
    if (config) {
        setProxyConfig(config);
    }
});

// ─── Init ────────────────────────────────────────────────────────────────────
// Add one empty account row if none exist after load
setTimeout(() => {
    if (accountCount === 0) addAccount();
}, 1000);
