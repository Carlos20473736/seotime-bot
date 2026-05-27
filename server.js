const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

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
    POLL_INTERVAL: 30000,  // 30s between site fetches
    VIEW_EXTRA_WAIT: 2000, // extra wait after timer
};

// ─── State ────────────────────────────────────────────────────────────────────
const sessions = new Map(); // sessionId -> session state
const onlineUsers = new Map(); // global online users tracking

// ─── Crypto / Signature ───────────────────────────────────────────────────────
function sha256hex(data) {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

function signRequest(token, deviceId, timestamp, nonce, body) {
    const bodyHash = sha256hex(body);
    const payload = `${token}\n${deviceId}\n${timestamp}\n${nonce}\n${bodyHash}`;
    const hmac = crypto.createHmac('sha256', CONFIG.API_SECRET);
    hmac.update(payload, 'utf8');
    // Base64 URL-safe no padding
    return hmac.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateDeviceId() {
    // Real Android device_id = "aid_" + Settings.Secure.ANDROID_ID (16 hex chars)
    return 'aid_' + crypto.randomBytes(8).toString('hex');
}

function generateDeviceInfo(deviceId) {
    const devices = [
        { manufacturer: 'samsung', model: 'SM-G960N', device: 'starlte', brand: 'samsung' },
        { manufacturer: 'samsung', model: 'SM-A525F', device: 'a52q', brand: 'samsung' },
        { manufacturer: 'xiaomi', model: 'Redmi Note 10', device: 'mojito', brand: 'Redmi' },
        { manufacturer: 'huawei', model: 'P30 Lite', device: 'marie', brand: 'HUAWEI' },
        { manufacturer: 'motorola', model: 'moto g(60)', device: 'hanoip', brand: 'motorola' },
        { manufacturer: 'OnePlus', model: 'IN2025', device: 'OnePlus8T', brand: 'OnePlus' },
        { manufacturer: 'Google', model: 'Pixel 5', device: 'redfin', brand: 'google' },
        { manufacturer: 'samsung', model: 'SM-G998B', device: 'o1s', brand: 'samsung' },
    ];
    const d = devices[Math.floor(Math.random() * devices.length)];
    const sdks = [28, 29, 30, 31, 33];
    const sdk = sdks[Math.floor(Math.random() * sdks.length)];
    const versions = { 28: '9', 29: '10', 30: '11', 31: '12', 33: '13' };
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

// ─── HTTP Client ──────────────────────────────────────────────────────────────
async function apiRequest(endpoint, params, token = '', deviceId = '', accept = 'application/json') {
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

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
    });

    const text = await response.text();
    if (accept.includes('json')) {
        try { return JSON.parse(text); } catch { return { ok: false, error: text.substring(0, 200) }; }
    }
    return text;
}

async function apiGetLastSite(token, userId, deviceId, deviceInfo) {
    const url = `${CONFIG.API_BASE}/api_mobile/last_site.php?token=${encodeURIComponent(token)}&user_id=${encodeURIComponent(userId)}`;
    // CRITICAL: Must include device fields in body (without them server returns "Bad device")
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

    const response = await fetch(url, { method: 'POST', headers, body });
    return await response.text();
}

function parseSiteList(html) {
    // Format: site_id&nbsp;reward&nbsp;seconds&nbsp;url&nbsp;<br>
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

// ─── Bot Session Logic ────────────────────────────────────────────────────────
class BotSession {
    constructor(socketId, accountIndex, email, password, googleEmail, sessionsCount) {
        this.id = uuidv4();
        this.socketId = socketId;
        this.accountIndex = accountIndex;
        this.email = email;
        this.password = password;
        this.googleEmail = googleEmail || email;
        this.sessionsCount = sessionsCount || 1;
        this.running = false;
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
        this.subSessions = [];
    }

    async login(emitLog = null, maxRetries = 5) {
        const params = {
            login: this.email,
            password: this.password,
            google_email: this.googleEmail,
            version_code: CONFIG.VERSION_CODE,
            version_name: CONFIG.VERSION_NAME,
            ...this.deviceInfo
        };

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const result = await apiRequest('/api_mobile/mobile_login.php', params, '', this.deviceId);
            if (result.ok) {
                this.token = result.token;
                this.userId = result.id;
                this.username = result.username;
                this.status = 'logged_in';
                return { success: true, username: result.username, money: result.money };
            }

            // Check for rate limit (retry_after field or "Подождите" message)
            if (result.retry_after || (result.error && result.error.includes('Подождите'))) {
                let waitSec = result.retry_after || 60;
                // Parse from error message like "Подождите 1:52 мин."
                if (!result.retry_after && result.error) {
                    const match = result.error.match(/(\d+):(\d+)/);
                    if (match) {
                        waitSec = parseInt(match[1]) * 60 + parseInt(match[2]) + 5;
                    }
                }
                if (emitLog) emitLog(`[${this.email}] ⏳ Rate limit - aguardando ${waitSec}s (tentativa ${attempt}/${maxRetries})...`);
                this.status = 'rate_limited';
                await sleep((waitSec + 2) * 1000);
                continue;
            }

            // Other error - no retry
            return { success: false, error: result.error || 'Login failed' };
        }
        return { success: false, error: 'Max retries exceeded (rate limit)' };
    }

    async ping() {
        if (!this.token) return null;
        const params = { token: this.token, google_email: this.googleEmail, ...this.deviceInfo };
        return await apiRequest('/api_mobile/ping.php', params, this.token, this.deviceId);
    }

    async todayStats() {
        if (!this.token) return null;
        const params = { token: this.token, google_email: this.googleEmail, ...this.deviceInfo };
        return await apiRequest('/api_mobile/today_stats.php', params, this.token, this.deviceId);
    }

    async fetchSites() {
        if (!this.token || !this.userId) return [];
        const html = await apiGetLastSite(this.token, this.userId, this.deviceId, this.deviceInfo);
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
        return await apiRequest('/api_mobile/view_started.php', params, this.token, this.deviceId);
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
        return await apiRequest('/api_mobile/view_completed.php', params, this.token, this.deviceId);
    }

    async runLoop(subIndex, emitLog) {
        let consecutiveEmpty = 0;
        while (this.running) {
            try {
                // Fetch available sites
                const sites = await this.fetchSites();
                if (!sites || sites.length === 0) {
                    consecutiveEmpty++;
                    if (consecutiveEmpty <= 3 || consecutiveEmpty % 10 === 0) {
                        emitLog(`[${this.email}#${subIndex}] Sem sites disponíveis (${consecutiveEmpty}x), aguardando ${Math.min(consecutiveEmpty * 5, 30)}s...`);
                    }
                    // Exponential backoff: 5s, 10s, 15s... max 30s
                    await sleep(Math.min(consecutiveEmpty * 5000, 30000));
                    continue;
                }
                consecutiveEmpty = 0;

                // Pick a random site
                const site = sites[Math.floor(Math.random() * Math.min(sites.length, 10))];
                this.currentSite = site.url;
                this.status = 'viewing';

                emitLog(`[${this.email}#${subIndex}] Iniciando view: ${site.url.substring(0, 60)}... (${site.seconds}s, ${site.reward}₽)`);

                // Start view
                const startResult = await this.viewStarted(site);
                if (!startResult || !startResult.ok) {
                    emitLog(`[${this.email}#${subIndex}] Erro ao iniciar view: ${startResult?.error || 'unknown'}`);
                    await sleep(5000);
                    continue;
                }

                const viewId = startResult.view_id;
                const waitTime = (startResult.required_seconds || site.seconds) * 1000 + CONFIG.VIEW_EXTRA_WAIT;

                // Wait for the required time
                await sleep(waitTime);

                if (!this.running) break;

                // Complete view
                const completeResult = await this.viewCompleted(site.siteId, viewId);
                if (completeResult && completeResult.ok) {
                    this.views++;
                    this.earned += parseFloat(site.reward);
                    emitLog(`[${this.email}#${subIndex}] ✓ View concluída! +${site.reward}₽ (Total: ${this.views} views, ${this.earned.toFixed(4)}₽)`);
                } else {
                    emitLog(`[${this.email}#${subIndex}] ✗ Erro ao completar: ${completeResult?.error || 'unknown'}`);
                }

                this.currentSite = null;
                this.status = 'waiting';

                // Small delay between views
                await sleep(2000 + Math.random() * 3000);

            } catch (err) {
                emitLog(`[${this.email}#${subIndex}] Erro: ${err.message}`);
                await sleep(10000);
            }
        }
    }

    async start(emitLog) {
        if (this.running) return;
        this.running = true;
        this.startTime = new Date();
        this.status = 'logging_in';

        emitLog(`[${this.email}] Fazendo login...`);
        const loginResult = await this.login(emitLog);
        if (!loginResult.success) {
            emitLog(`[${this.email}] ✗ Login falhou: ${loginResult.error}`);
            this.running = false;
            this.status = 'error';
            return;
        }
        emitLog(`[${this.email}] ✓ Login OK! User: ${this.username}, Saldo: ${loginResult.money}₽`);

        // Start ping loop
        this.pingInterval = setInterval(async () => {
            if (this.running && this.token) {
                await this.ping();
            }
        }, 60000);

        // Start sub-sessions
        for (let i = 0; i < this.sessionsCount; i++) {
            const subSession = this.runLoop(i + 1, emitLog);
            this.subSessions.push(subSession);
        }
    }

    stop() {
        this.running = false;
        this.status = 'stopped';
        this.currentSite = null;
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Socket.IO ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    const clientSessions = [];

    socket.on('start_all', async (data) => {
        const { accounts, useProxy } = data;
        if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
            socket.emit('log', 'Nenhuma conta configurada.');
            return;
        }

        socket.emit('log', `Iniciando ${accounts.length} conta(s)...`);
        socket.emit('status_update', { status: 'ONLINE', color: '#0f0' });

        for (const acc of accounts) {
            if (!acc.email || !acc.password) continue;
            const session = new BotSession(
                socket.id,
                acc.index,
                acc.email,
                acc.password,
                acc.googleEmail || acc.email,
                acc.sessions || 1
            );
            clientSessions.push(session);
            sessions.set(session.id, session);

            // Track online user
            onlineUsers.set(session.id, {
                email: acc.email,
                sessions: acc.sessions || 1,
                views: 0,
                earned: 0,
                since: new Date().toLocaleTimeString('pt-BR'),
            });

            session.start((msg) => {
                socket.emit('log', msg);
                // Update stats
                const userInfo = onlineUsers.get(session.id);
                if (userInfo) {
                    userInfo.views = session.views;
                    userInfo.earned = session.earned.toFixed(3);
                }
                broadcastOnlineUsers();
                socket.emit('session_update', getSessionData(session));
                socket.emit('stats_update', getClientStats(clientSessions));
            });
        }
    });

    socket.on('stop_all', () => {
        socket.emit('log', 'Parando todas as sessões...');
        for (const session of clientSessions) {
            session.stop();
            sessions.delete(session.id);
            onlineUsers.delete(session.id);
        }
        clientSessions.length = 0;
        socket.emit('status_update', { status: 'OFFLINE', color: '#f00' });
        socket.emit('stats_update', { earned: '0.000', views: 0, activeSessions: 0 });
        broadcastOnlineUsers();
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        for (const session of clientSessions) {
            session.stop();
            sessions.delete(session.id);
            onlineUsers.delete(session.id);
        }
        clientSessions.length = 0;
        broadcastOnlineUsers();
    });

    // Send initial online users
    socket.emit('online_users', getOnlineUsersData());
});

function getSessionData(session) {
    return {
        id: session.id,
        email: session.email,
        accountIndex: session.accountIndex,
        deviceInfo: `${session.deviceInfo.manufacturer} ${session.deviceInfo.model}`,
        ip: '-',
        status: session.status,
        views: session.views,
        earned: session.earned.toFixed(4),
        currentSite: session.currentSite ? session.currentSite.substring(0, 50) + '...' : '-',
    };
}

function getClientStats(clientSessions) {
    let totalViews = 0;
    let totalEarned = 0;
    let activeSessions = 0;
    for (const s of clientSessions) {
        totalViews += s.views;
        totalEarned += s.earned;
        if (s.running) activeSessions += s.sessionsCount;
    }
    return {
        earned: totalEarned.toFixed(3),
        views: totalViews,
        activeSessions,
    };
}

function getOnlineUsersData() {
    const users = [];
    let idx = 1;
    for (const [id, info] of onlineUsers) {
        users.push({ index: idx++, ...info });
    }
    return users;
}

function broadcastOnlineUsers() {
    io.emit('online_users', getOnlineUsersData());
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.get('/trap', (req, res) => {
    res.sendFile(path.join(__dirname, 'static', 'admin.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`SeoTime Bot running on port ${PORT}`);
});
