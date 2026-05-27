const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'static')));

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG = {
    API_BASE: 'https://seotime.biz',
    API_SECRET: 'SeoTimeMobileApi_2026_144',
    USER_AGENT: 'SeoTimeApp/1.4.5',
    PACKAGE: 'app.example.video',
    VERSION_CODE: '12',
    VERSION_NAME: '1.4.5',
    MAX_ACCOUNTS: 20,
    POLL_INTERVAL: 30000,
    VIEW_EXTRA_WAIT: 2000,
    PROXY_PORT: 823,
    PROXY_COUNTRY: 'br',
    IP_EXHAUSTED_THRESHOLD: 5,
};

// ─── Persistence ─────────────────────────────────────────────────────────────
const PERSISTENCE_FILE = path.join(__dirname, 'active_bots.json');

function loadActiveBots() {
    try {
        if (fs.existsSync(PERSISTENCE_FILE)) {
            return JSON.parse(fs.readFileSync(PERSISTENCE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[PERSIST] Erro ao carregar:', e.message);
    }
    return {};
}

function saveActiveBots(data) {
    try {
        fs.writeFileSync(PERSISTENCE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('[PERSIST] Erro ao salvar:', e.message);
    }
}

function saveBot(email, password, sessions, googleEmail, proxyConfig) {
    const data = loadActiveBots();
    data[email] = {
        email,
        password,
        sessions,
        googleEmail: googleEmail || email,
        proxyConfig: proxyConfig || null,
        started_at: new Date().toISOString()
    };
    saveActiveBots(data);
}

function removeBot(email) {
    const data = loadActiveBots();
    delete data[email];
    saveActiveBots(data);
}

// ─── Global State ────────────────────────────────────────────────────────────
const activeBots = new Map(); // email -> BotSession
const onlineUsers = new Map(); // email -> { sessions, views, earned, since }
let globalProxyConfig = null; // shared proxy config

// ─── Proxy ───────────────────────────────────────────────────────────────────
function buildProxyUrl(proxyConfig, sessionId, rotationId) {
    if (!proxyConfig || !proxyConfig.enabled) return null;
    const login = proxyConfig.login || '';
    const password = proxyConfig.password || '';
    const host = proxyConfig.host || 'gw.dataimpulse.com';
    const port = proxyConfig.port || CONFIG.PROXY_PORT;
    const country = proxyConfig.country || CONFIG.PROXY_COUNTRY;
    if (!login || !password) return null;
    const rotId = rotationId || (Date.now() % 100000);
    const sessidValue = `st${sessionId}r${rotId}`;
    const loginWithParams = `${login}__cr.${country}__sd.${sessidValue}`;
    return `http://${loginWithParams}:${password}@${host}:${port}`;
}

function createProxyAgent(proxyUrl) {
    if (!proxyUrl) return undefined;
    return new HttpsProxyAgent(proxyUrl);
}

// ─── Crypto / Signature ───────────────────────────────────────────────────────
function sha256hex(data) {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function signRequest(token, deviceId, timestamp, nonce, body) {
    const bodyHash = sha256hex(body);
    const payload = `${token}\n${deviceId}\n${timestamp}\n${nonce}\n${bodyHash}`;
    const hmac = crypto.createHmac('sha256', CONFIG.API_SECRET);
    hmac.update(payload, 'utf8');
    return hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateDeviceId() {
    return 'aid_' + crypto.randomBytes(8).toString('hex');
}

function generateDeviceInfo(deviceId) {
    const devices = [
        { manufacturer: 'samsung', model: 'SM-G960N', device: 'starlte', brand: 'samsung' },
        { manufacturer: 'samsung', model: 'SM-A525F', device: 'a52q', brand: 'samsung' },
        { manufacturer: 'samsung', model: 'SM-A546E', device: 'a54x', brand: 'samsung' },
        { manufacturer: 'samsung', model: 'SM-G991B', device: 'o1s', brand: 'samsung' },
        { manufacturer: 'samsung', model: 'SM-G998B', device: 'p3s', brand: 'samsung' },
        { manufacturer: 'xiaomi', model: 'Redmi Note 10', device: 'mojito', brand: 'Redmi' },
        { manufacturer: 'xiaomi', model: 'Redmi Note 12', device: 'tapas', brand: 'xiaomi' },
        { manufacturer: 'xiaomi', model: 'POCO X5 Pro', device: 'redwood', brand: 'xiaomi' },
        { manufacturer: 'motorola', model: 'moto g(60)', device: 'hanoip', brand: 'motorola' },
        { manufacturer: 'OnePlus', model: 'CPH2449', device: 'OP5958L1', brand: 'OnePlus' },
        { manufacturer: 'Google', model: 'Pixel 7', device: 'panther', brand: 'google' },
        { manufacturer: 'Google', model: 'Pixel 6a', device: 'bluejay', brand: 'google' },
    ];
    const d = devices[Math.floor(Math.random() * devices.length)];
    const sdks = [28, 29, 30, 31, 33, 34];
    const sdk = sdks[Math.floor(Math.random() * sdks.length)];
    const versions = { 28: '9', 29: '10', 30: '11', 31: '12', 33: '13', 34: '14' };
    return {
        device_id: deviceId,
        manufacturer: d.manufacturer,
        model: d.model,
        device: d.device,
        brand: d.brand,
        android_sdk: String(sdk),
        android_version: versions[sdk],
        app_version_code: CONFIG.VERSION_CODE,
        app_version_name: CONFIG.VERSION_NAME,
        package_name: CONFIG.PACKAGE,
        locale: 'en_US',
        language: 'en'
    };
}

// ─── HTTP Client (with optional proxy) ───────────────────────────────────────
async function apiRequest(endpoint, params, token = '', deviceId = '', accept = 'application/json', agent = undefined) {
    const url = `${CONFIG.API_BASE}${endpoint}`;
    const body = new URLSearchParams(params).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = uuidv4().replace(/-/g, '');
    const signature = signRequest(token, deviceId, timestamp, nonce, body);

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Accept': accept,
        'User-Agent': CONFIG.USER_AGENT,
        'X-ST-App': 'SeoTimeApp',
        'X-ST-Package': CONFIG.PACKAGE,
        'X-ST-Version-Code': CONFIG.VERSION_CODE,
        'X-ST-Version-Name': CONFIG.VERSION_NAME,
        'X-ST-Timestamp': timestamp,
        'X-ST-Nonce': nonce,
        'X-ST-Signature': signature,
    };

    const fetchOpts = { method: 'POST', headers, body };
    if (agent) fetchOpts.agent = agent;

    const response = await fetch(url, fetchOpts);
    const text = await response.text();
    if (accept.includes('json')) {
        try { return JSON.parse(text); } catch { return { ok: false, error: text.substring(0, 200) }; }
    }
    return text;
}

async function apiGetLastSite(token, userId, deviceId, deviceInfo, agent = undefined) {
    const url = `${CONFIG.API_BASE}/api_mobile/last_site.php?token=${encodeURIComponent(token)}&user_id=${encodeURIComponent(userId)}`;
    const params = { token, user_id: String(userId), ...deviceInfo };
    const body = new URLSearchParams(params).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = uuidv4().replace(/-/g, '');
    const signature = signRequest(token, deviceId, timestamp, nonce, body);

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Accept': 'text/html, */*',
        'User-Agent': CONFIG.USER_AGENT,
        'X-ST-App': 'SeoTimeApp',
        'X-ST-Package': CONFIG.PACKAGE,
        'X-ST-Version-Code': CONFIG.VERSION_CODE,
        'X-ST-Version-Name': CONFIG.VERSION_NAME,
        'X-ST-Timestamp': timestamp,
        'X-ST-Nonce': nonce,
        'X-ST-Signature': signature,
    };

    const fetchOpts = { method: 'POST', headers, body };
    if (agent) fetchOpts.agent = agent;

    const response = await fetch(url, fetchOpts);
    return await response.text();
}

function parseSiteList(html) {
    const sites = [];
    const lines = html.split('<br>');
    for (const line of lines) {
        const parts = line.split('&nbsp;').map(s => s.trim()).filter(Boolean);
        if (parts.length >= 4) {
            sites.push({
                siteId: parseInt(parts[0]),
                reward: parts[1],
                seconds: parseInt(parts[2]),
                url: parts[3]
            });
        }
    }
    return sites;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Bot Session Logic ────────────────────────────────────────────────────────
class BotSession {
    constructor(email, password, googleEmail, sessionsCount, proxyConfig = null) {
        this.email = email;
        this.password = password;
        this.googleEmail = googleEmail || email;
        this.sessionsCount = sessionsCount || 1;
        this.proxyConfig = proxyConfig;
        this.running = false;
        this.stopRequested = false;
        this.token = null;
        this.userId = null;
        this.username = null;
        this.deviceId = generateDeviceId();
        this.deviceInfo = generateDeviceInfo(this.deviceId);
        this.views = 0;
        this.earned = 0;
        this.currentSite = null;
        this.status = 'idle';
        this.startTime = null;
        this.logs = [];
        this.accountBalance = '0.0000';
        this.consecutiveEmpty = 0;
        this.rotationCount = 0;
        this.currentProxyUrl = null;
        this.proxyAgent = null;

        // Setup initial proxy
        this._setupProxy(1);
    }

    _setupProxy(sessionId, rotationId = null) {
        if (this.proxyConfig && this.proxyConfig.enabled) {
            this.currentProxyUrl = buildProxyUrl(this.proxyConfig, sessionId, rotationId);
            this.proxyAgent = createProxyAgent(this.currentProxyUrl);
        } else {
            this.currentProxyUrl = null;
            this.proxyAgent = undefined;
        }
    }

    _rotateIp(sessionId) {
        this.rotationCount++;
        const rotId = Date.now() % 100000 + this.rotationCount;
        this._setupProxy(sessionId, rotId);
        return !!this.currentProxyUrl;
    }

    addLog(msg, level = 'info') {
        const time = new Date().toLocaleTimeString('pt-BR');
        this.logs.push({ time, message: msg, level });
        if (this.logs.length > 500) this.logs = this.logs.slice(-500);
        io.emit('log', msg);
        this.broadcastState();
    }

    broadcastState() {
        const userInfo = onlineUsers.get(this.email);
        if (userInfo) {
            userInfo.views = this.views;
            userInfo.earned = this.earned.toFixed(3);
        }
        io.emit('online_users', getOnlineUsersData());
        io.emit('session_update', this.getSessionData());
        io.emit('stats_update', getGlobalStats());
    }

    getSessionData() {
        const proxyStr = this.proxyConfig && this.proxyConfig.enabled ? ' [PROXY]' : '';
        return {
            id: this.email,
            email: this.email,
            accountIndex: 0,
            deviceInfo: `${this.deviceInfo.manufacturer} ${this.deviceInfo.model}${proxyStr}`,
            ip: this.proxyConfig && this.proxyConfig.enabled ? `proxy (rot: ${this.rotationCount})` : '-',
            status: this.status,
            views: this.views,
            earned: this.earned.toFixed(4),
            balance: this.accountBalance || '0.0000',
            currentSite: this.currentSite ? this.currentSite.substring(0, 50) + '...' : '-',
        };
    }

    async login(maxRetries = 10) {
        const params = {
            login: this.email,
            password: this.password,
            google_email: this.googleEmail,
            version_code: CONFIG.VERSION_CODE,
            version_name: CONFIG.VERSION_NAME,
            ...this.deviceInfo
        };

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            if (this.stopRequested) return { success: false, error: 'Stopped by user' };

            const result = await apiRequest('/api_mobile/mobile_login.php', params, '', this.deviceId, 'application/json', this.proxyAgent);
            if (result.ok) {
                this.token = result.token;
                this.userId = result.id;
                this.username = result.username;
                this.status = 'logged_in';
                return { success: true, username: result.username, money: result.money };
            }

            // Rate limit
            if (result.retry_after || (result.error && result.error.includes('Подождите'))) {
                let waitSec = result.retry_after || 60;
                if (!result.retry_after && result.error) {
                    const match = result.error.match(/(\d+):(\d+)/);
                    if (match) {
                        waitSec = parseInt(match[1]) * 60 + parseInt(match[2]) + 5;
                    }
                }
                this.addLog(`[${this.email}] ⏳ Rate limit - aguardando ${waitSec}s (tentativa ${attempt}/${maxRetries})...`, 'warning');
                this.status = 'rate_limited';
                for (let i = 0; i < waitSec + 2; i++) {
                    if (this.stopRequested) return { success: false, error: 'Stopped by user' };
                    await sleep(1000);
                }
                // Rotate IP on rate limit if proxy enabled
                if (this.proxyConfig && this.proxyConfig.enabled) {
                    this._rotateIp(1);
                    this.addLog(`[${this.email}] 🔄 IP rotacionado (tentativa ${attempt})`, 'warning');
                }
                continue;
            }

            // Other error - retry with backoff
            this.addLog(`[${this.email}] ⚠ Login erro (tentativa ${attempt}): ${result.error || 'unknown'}`, 'warning');
            if (attempt < maxRetries) {
                // Rotate IP on error if proxy enabled
                if (this.proxyConfig && this.proxyConfig.enabled) {
                    this._rotateIp(1);
                }
                const backoff = Math.min(attempt * 5, 30);
                for (let i = 0; i < backoff; i++) {
                    if (this.stopRequested) return { success: false, error: 'Stopped by user' };
                    await sleep(1000);
                }
            }
        }
        return { success: false, error: 'Max retries exceeded' };
    }

    async ping() {
        if (!this.token) return null;
        const params = { token: this.token, google_email: this.googleEmail, ...this.deviceInfo };
        return await apiRequest('/api_mobile/ping.php', params, this.token, this.deviceId, 'application/json', this.proxyAgent);
    }

    async todayStats() {
        if (!this.token) return null;
        const params = { token: this.token, google_email: this.googleEmail, ...this.deviceInfo };
        return await apiRequest('/api_mobile/today_stats.php', params, this.token, this.deviceId, 'application/json', this.proxyAgent);
    }

    async fetchSites() {
        if (!this.token || !this.userId) return [];
        const html = await apiGetLastSite(this.token, this.userId, this.deviceId, this.deviceInfo, this.proxyAgent);
        return parseSiteList(html);
    }

    async viewStarted(site) {
        if (!this.token) return null;
        const params = {
            token: this.token,
            google_email: this.googleEmail,
            site_id: String(site.siteId),
            reward: site.reward,
            seconds: String(site.seconds),
            url: site.url,
            ...this.deviceInfo
        };
        return await apiRequest('/api_mobile/view_started.php', params, this.token, this.deviceId, 'application/json', this.proxyAgent);
    }

    async viewCompleted(siteId, viewId) {
        if (!this.token) return null;
        const params = {
            token: this.token,
            google_email: this.googleEmail,
            site_id: String(siteId),
            view_id: String(viewId),
            ...this.deviceInfo
        };
        return await apiRequest('/api_mobile/view_completed.php', params, this.token, this.deviceId, 'application/json', this.proxyAgent);
    }

    // ─── Main Loop (runs FOREVER until stopRequested) ─────────────────────────
    async runLoop(subIndex) {
        let consecutiveEmpty = 0;
        let consecutiveErrors = 0;

        while (!this.stopRequested) {
            try {
                // Fetch available sites
                const sites = await this.fetchSites();
                if (!sites || sites.length === 0) {
                    consecutiveEmpty++;
                    this.consecutiveEmpty = consecutiveEmpty;

                    // IP exhausted - rotate if proxy enabled
                    if (consecutiveEmpty >= CONFIG.IP_EXHAUSTED_THRESHOLD && this.proxyConfig && this.proxyConfig.enabled) {
                        this.addLog(`[${this.email}#${subIndex}] 🔄 IP esgotado (${consecutiveEmpty}x sem sites), rotacionando...`, 'warning');
                        this.status = 'rotating';
                        this._rotateIp(subIndex);
                        consecutiveEmpty = 0;
                        this.consecutiveEmpty = 0;
                        this.addLog(`[${this.email}#${subIndex}] ✓ Novo IP ativo (rotação #${this.rotationCount})`, 'info');
                        await sleep(3000);
                        continue;
                    }

                    if (consecutiveEmpty <= 3 || consecutiveEmpty % 10 === 0) {
                        this.addLog(`[${this.email}#${subIndex}] Sem sites disponíveis (${consecutiveEmpty}x), aguardando...`);
                    }
                    this.status = 'waiting';
                    const waitTime = Math.min(10 + consecutiveEmpty * 5, 30);
                    for (let i = 0; i < waitTime; i++) {
                        if (this.stopRequested) return;
                        await sleep(1000);
                    }
                    continue;
                }
                consecutiveEmpty = 0;
                this.consecutiveEmpty = 0;
                consecutiveErrors = 0;

                // Pick a random site from top 10
                const site = sites[Math.floor(Math.random() * Math.min(sites.length, 10))];
                this.currentSite = site.url;
                this.status = 'viewing';

                this.addLog(`[${this.email}#${subIndex}] Iniciando view: ${site.url.substring(0, 60)}... (${site.seconds}s, ${site.reward}₽)`);

                // Start view
                const startResult = await this.viewStarted(site);
                if (!startResult || !startResult.ok) {
                    const err = startResult?.error || 'unknown';
                    this.addLog(`[${this.email}#${subIndex}] Erro ao iniciar view: ${err}`, 'error');
                    
                    if (err.includes('token') || err.includes('auth') || err.includes('Авторизуйтесь')) {
                        this.addLog(`[${this.email}#${subIndex}] Token expirado, fazendo re-login...`, 'warning');
                        this.status = 'logging_in';
                        const loginResult = await this.login();
                        if (!loginResult.success) {
                            this.addLog(`[${this.email}#${subIndex}] Re-login falhou: ${loginResult.error}`, 'error');
                            await sleep(30000);
                        }
                    } else {
                        await sleep(5000);
                    }
                    continue;
                }

                const viewId = startResult.view_id;
                const waitTime = (startResult.required_seconds || site.seconds) * 1000 + CONFIG.VIEW_EXTRA_WAIT;

                const waitSecs = Math.ceil(waitTime / 1000);
                for (let i = 0; i < waitSecs; i++) {
                    if (this.stopRequested) return;
                    await sleep(1000);
                }

                if (this.stopRequested) return;

                // Complete view
                const completeResult = await this.viewCompleted(site.siteId, viewId);
                if (completeResult && completeResult.ok) {
                    this.views++;
                    this.earned += parseFloat(site.reward);
                    // Update balance
                    let balanceStr = '';
                    try {
                        const stats = await this.todayStats();
                        if (stats && stats.money !== undefined) {
                            this.accountBalance = stats.money;
                            balanceStr = ` | Saldo conta: ${this.accountBalance}₽`;
                        } else if (this.accountBalance) {
                            balanceStr = ` | Saldo conta: ~${this.accountBalance}₽`;
                        }
                    } catch(e) {
                        if (this.accountBalance) balanceStr = ` | Saldo conta: ~${this.accountBalance}₽`;
                    }
                    this.addLog(`[${this.email}#${subIndex}] ✓ View concluída! +${site.reward}₽ (Sessão: ${this.views} views, ${this.earned.toFixed(4)}₽${balanceStr})`, 'success');
                } else {
                    this.addLog(`[${this.email}#${subIndex}] ✗ Erro ao completar: ${completeResult?.error || 'unknown'}`, 'error');
                }

                this.currentSite = null;
                this.status = 'waiting';
                await sleep(1000 + Math.random() * 2000);

            } catch (err) {
                consecutiveErrors++;
                this.addLog(`[${this.email}#${subIndex}] Erro: ${err.message}`, 'error');
                
                if (consecutiveErrors >= 5) {
                    this.addLog(`[${this.email}#${subIndex}] Muitos erros, tentando re-login...`, 'warning');
                    // Rotate IP on persistent errors
                    if (this.proxyConfig && this.proxyConfig.enabled) {
                        this._rotateIp(subIndex);
                        this.addLog(`[${this.email}#${subIndex}] 🔄 IP rotacionado após erros`, 'warning');
                    }
                    this.status = 'logging_in';
                    const loginResult = await this.login();
                    if (loginResult.success) {
                        this.addLog(`[${this.email}#${subIndex}] Re-login OK!`, 'success');
                        consecutiveErrors = 0;
                    } else {
                        for (let i = 0; i < 60; i++) {
                            if (this.stopRequested) return;
                            await sleep(1000);
                        }
                    }
                } else {
                    await sleep(10000);
                }
            }
        }
    }

    // ─── Start Bot (runs until user stops) ────────────────────────────────────
    async start() {
        if (this.running) return;
        this.running = true;
        this.stopRequested = false;
        this.startTime = new Date();
        this.status = 'logging_in';

        const proxyStatus = this.proxyConfig && this.proxyConfig.enabled
            ? `COM PROXY (${this.proxyConfig.host}:${this.proxyConfig.port}, ${CONFIG.PROXY_COUNTRY.toUpperCase()})`
            : 'SEM PROXY';
        this.addLog(`[${this.email}] Fazendo login... (${proxyStatus})`);

        const loginResult = await this.login();
        if (!loginResult.success) {
            this.addLog(`[${this.email}] ✗ Login falhou: ${loginResult.error}`, 'error');
            if (this.stopRequested) {
                this.running = false;
                this.status = 'stopped';
                return;
            }
            this.addLog(`[${this.email}] Tentando novamente em 60s...`, 'warning');
            for (let i = 0; i < 60; i++) {
                if (this.stopRequested) { this.running = false; this.status = 'stopped'; return; }
                await sleep(1000);
            }
            this.running = false;
            return this.start();
        }
        this.accountBalance = loginResult.money || '0.0000';
        this.addLog(`[${this.email}] ✓ Login OK! User: ${this.username}, Saldo total da conta: ${this.accountBalance}₽`, 'success');

        // Start ping loop (every 60s) + update balance
        this.pingInterval = setInterval(async () => {
            if (!this.stopRequested && this.token) {
                try {
                    const pingResult = await this.ping();
                    if (pingResult && pingResult.money !== undefined) {
                        this.accountBalance = pingResult.money;
                    }
                } catch (e) {}
            }
        }, 60000);

        // Start sub-sessions (all run in parallel, FOREVER)
        for (let i = 0; i < this.sessionsCount; i++) {
            this.runLoop(i + 1);
            await sleep(2000);
        }
    }

    stop() {
        this.stopRequested = true;
        this.running = false;
        this.status = 'stopped';
        this.currentSite = null;
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
}

// ─── Helper Functions ────────────────────────────────────────────────────────
function getOnlineUsersData() {
    const users = [];
    let idx = 1;
    for (const [email, info] of onlineUsers) {
        users.push({ index: idx++, ...info });
    }
    return users;
}

function getGlobalStats() {
    let totalViews = 0;
    let totalEarned = 0;
    let activeSessions = 0;
    for (const [email, bot] of activeBots) {
        totalViews += bot.views;
        totalEarned += bot.earned;
        if (bot.running) activeSessions += bot.sessionsCount;
    }
    return {
        earned: totalEarned.toFixed(3),
        views: totalViews,
        activeSessions,
    };
}

function broadcastAll() {
    io.emit('online_users', getOnlineUsersData());
    io.emit('stats_update', getGlobalStats());
    const savedData = loadActiveBots();
    io.emit('saved_accounts', savedData);
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Send current state to new client
    socket.emit('online_users', getOnlineUsersData());
    socket.emit('stats_update', getGlobalStats());

    // Send saved accounts for auto-fill
    const savedData = loadActiveBots();
    socket.emit('saved_accounts', savedData);

    // Send proxy config
    socket.emit('proxy_config', globalProxyConfig);

    // Send active session data
    for (const [email, bot] of activeBots) {
        socket.emit('session_update', bot.getSessionData());
    }

    // Send current status
    if (activeBots.size > 0) {
        socket.emit('status_update', { status: 'ONLINE', color: '#0f0' });
    }

    // Send recent logs from active bots
    for (const [email, bot] of activeBots) {
        const recentLogs = bot.logs.slice(-50);
        for (const log of recentLogs) {
            socket.emit('log', `[${log.time}] ${log.message}`);
        }
    }

    socket.on('start_all', async (data) => {
        const { accounts, proxyConfig } = data;
        if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
            socket.emit('log', 'Nenhuma conta configurada.');
            return;
        }

        // Save proxy config globally
        globalProxyConfig = proxyConfig || null;

        // Stop any currently running bots first
        for (const [email, bot] of activeBots) {
            bot.stop();
            onlineUsers.delete(email);
        }
        activeBots.clear();

        const proxyStr = proxyConfig && proxyConfig.enabled
            ? ` (COM PROXY: ${proxyConfig.host}:${proxyConfig.port})`
            : ' (SEM PROXY)';
        socket.emit('log', `Iniciando ${accounts.length} conta(s)...${proxyStr}`);
        socket.emit('status_update', { status: 'ONLINE', color: '#0f0' });

        for (const acc of accounts) {
            if (!acc.email || !acc.password) continue;

            const bot = new BotSession(
                acc.email,
                acc.password,
                acc.googleEmail || acc.email,
                acc.sessions || 1,
                proxyConfig || null
            );

            activeBots.set(acc.email, bot);
            onlineUsers.set(acc.email, {
                email: acc.email,
                sessions: acc.sessions || 1,
                views: 0,
                earned: '0.000',
                since: new Date().toLocaleTimeString('pt-BR'),
            });

            // Save credentials + proxy config for persistence
            saveBot(acc.email, acc.password, acc.sessions || 1, acc.googleEmail || acc.email, proxyConfig);

            // Start bot (runs forever until stopped)
            bot.start();

            // Stagger between accounts
            await sleep(3000);
        }

        broadcastAll();
    });

    socket.on('stop_all', () => {
        socket.emit('log', 'Parando todas as sessões...');
        for (const [email, bot] of activeBots) {
            bot.stop();
            removeBot(email);
            onlineUsers.delete(email);
        }
        activeBots.clear();
        socket.emit('status_update', { status: 'OFFLINE', color: '#f00' });
        socket.emit('stats_update', { earned: '0.000', views: 0, activeSessions: 0 });
        socket.emit('sessions_clear');
        broadcastAll();
    });

    // Note: We do NOT stop bots on disconnect!
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id} (bots continue running)`);
    });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.get('/trap', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'admin.html'));
});

app.get('/api/status', (req, res) => {
    const status = {};
    for (const [email, bot] of activeBots) {
        status[email] = {
            running: bot.running,
            status: bot.status,
            views: bot.views,
            earned: bot.earned.toFixed(4),
            sessions: bot.sessionsCount,
            proxy: bot.proxyConfig && bot.proxyConfig.enabled ? 'enabled' : 'disabled',
            rotations: bot.rotationCount,
            uptime: bot.startTime ? Math.floor((Date.now() - bot.startTime.getTime()) / 1000) : 0,
        };
    }
    res.json({ activeBots: status, totalBots: activeBots.size });
});

// ─── Auto-Resume on Startup ──────────────────────────────────────────────────
function autoResumeBots() {
    const saved = loadActiveBots();
    const emails = Object.keys(saved);
    if (emails.length === 0) {
        console.log('[AUTO-RESUME] Nenhuma conta salva para resumir.');
        return;
    }

    console.log(`[AUTO-RESUME] Resumindo ${emails.length} conta(s)...`);

    for (const email of emails) {
        const info = saved[email];
        if (activeBots.has(email)) continue;

        const bot = new BotSession(
            info.email,
            info.password,
            info.googleEmail || info.email,
            info.sessions || 1,
            info.proxyConfig || null
        );

        // Restore global proxy config from first saved bot
        if (info.proxyConfig && !globalProxyConfig) {
            globalProxyConfig = info.proxyConfig;
        }

        activeBots.set(email, bot);
        onlineUsers.set(email, {
            email: info.email,
            sessions: info.sessions || 1,
            views: 0,
            earned: '0.000',
            since: new Date().toLocaleTimeString('pt-BR'),
        });

        console.log(`[AUTO-RESUME] Iniciando ${email}...`);
        bot.start();
    }
}

// ─── Start Server ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`SeoTime Bot running on port ${PORT}`);
    setTimeout(() => {
        autoResumeBots();
    }, 5000);
});
