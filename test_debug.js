const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const CONFIG = {
    API_BASE: 'https://seotime.biz',
    API_SECRET: 'SeoTimeMobileApi_2026_144',
    USER_AGENT: 'SeoTimeApp/1.4.5',
    PACKAGE: 'app.example.video',
    VERSION_CODE: '12',
    VERSION_NAME: '1.4.5',
};

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

// Use android_id style like the real app: "aid_" + android_id (hex string)
// The real app uses Settings.Secure.getString(contentResolver, "android_id")
// which returns a 16-char hex string
function generateDeviceId() {
    return 'aid_' + crypto.randomBytes(8).toString('hex');  // 16 hex chars like real android_id
}

const deviceId = generateDeviceId();
const deviceInfo = {
    device_id: deviceId,
    manufacturer: 'samsung',
    model: 'SM-G960N',
    device: 'starlte',
    brand: 'samsung',
    android_sdk: '28',
    android_version: '9',
    app_version_code: CONFIG.VERSION_CODE,
    app_version_name: CONFIG.VERSION_NAME,
    package_name: CONFIG.PACKAGE,
    locale: 'en_US',
    language: 'en'
};

async function apiPost(endpoint, params, token = '') {
    const body = new URLSearchParams(params).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = uuidv4().replace(/-/g, '');
    const signature = signRequest(token, deviceId, timestamp, nonce, body);

    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'Accept': 'application/json',
        'User-Agent': CONFIG.USER_AGENT,
        'X-ST-App': 'SeoTimeApp',
        'X-ST-Package': CONFIG.PACKAGE,
        'X-ST-Version-Code': CONFIG.VERSION_CODE,
        'X-ST-Version-Name': CONFIG.VERSION_NAME,
        'X-ST-Timestamp': timestamp,
        'X-ST-Nonce': nonce,
        'X-ST-Signature': signature,
    };

    const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
        method: 'POST',
        headers,
        body,
    });
    return { status: response.status, text: await response.text() };
}

async function apiLastSite(token, userId) {
    // The real app calls: POST to URL with query params
    // URL: baseUrl + "/api_mobile/last_site.php?token=...&user_id=..."
    // Body: token + user_id + all device fields (form-encoded)
    const params = { token, user_id: String(userId), ...deviceInfo };
    const body = new URLSearchParams(params).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = uuidv4().replace(/-/g, '');
    const signature = signRequest(token, deviceId, timestamp, nonce, body);

    const url = `${CONFIG.API_BASE}/api_mobile/last_site.php?token=${encodeURIComponent(token)}&user_id=${encodeURIComponent(userId)}`;

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

    console.log('  last_site URL:', url);
    console.log('  last_site body:', body.substring(0, 150) + '...');

    const response = await fetch(url, { method: 'POST', headers, body });
    return { status: response.status, text: await response.text() };
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

async function run() {
    const email = 'muriel55herrera@gmail.com';
    const password = '730crai8';

    console.log('=== DEBUG TEST ===');
    console.log('Device ID:', deviceId);
    console.log('');

    // Login
    console.log('1. LOGIN...');
    const loginParams = {
        login: email,
        password: password,
        google_email: email,
        version_code: CONFIG.VERSION_CODE,
        version_name: CONFIG.VERSION_NAME,
        ...deviceInfo
    };
    const loginResp = await apiPost('/api_mobile/mobile_login.php', loginParams);
    console.log('  Status:', loginResp.status);
    console.log('  Response:', loginResp.text);
    
    let loginData;
    try { loginData = JSON.parse(loginResp.text); } catch { console.log('Parse error'); return; }
    if (!loginData.ok) { console.log('Login failed:', loginData.error); return; }
    
    const token = loginData.token;
    const userId = loginData.id;
    console.log(`  ✓ Token: ${token.substring(0, 30)}...`);
    console.log(`  ✓ UserId: ${userId}`);
    console.log('');

    // Ping
    console.log('2. PING...');
    const pingResp = await apiPost('/api_mobile/ping.php', { token, google_email: email, ...deviceInfo }, token);
    console.log('  Status:', pingResp.status);
    console.log('  Response:', pingResp.text);
    console.log('');

    // Today stats
    console.log('3. TODAY STATS...');
    const statsResp = await apiPost('/api_mobile/today_stats.php', { token, google_email: email, ...deviceInfo }, token);
    console.log('  Status:', statsResp.status);
    console.log('  Response:', statsResp.text);
    console.log('');

    // Last site - try multiple times
    console.log('4. LAST_SITE (attempt 1)...');
    const sitesResp1 = await apiLastSite(token, userId);
    console.log('  Status:', sitesResp1.status);
    console.log('  Response (first 300):', sitesResp1.text.substring(0, 300));
    const sites1 = parseSiteList(sitesResp1.text);
    console.log('  Parsed sites:', sites1.length);
    console.log('');

    // Wait and try again
    console.log('5. LAST_SITE (attempt 2, after 3s)...');
    await new Promise(r => setTimeout(r, 3000));
    const sitesResp2 = await apiLastSite(token, userId);
    console.log('  Status:', sitesResp2.status);
    console.log('  Response (first 300):', sitesResp2.text.substring(0, 300));
    const sites2 = parseSiteList(sitesResp2.text);
    console.log('  Parsed sites:', sites2.length);
    console.log('');

    // Try without device_info in body, just token and user_id
    console.log('6. LAST_SITE (minimal params)...');
    const minParams = { token, user_id: String(userId) };
    const minBody = new URLSearchParams(minParams).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = uuidv4().replace(/-/g, '');
    const signature = signRequest(token, deviceId, timestamp, nonce, minBody);
    const url = `${CONFIG.API_BASE}/api_mobile/last_site.php?token=${encodeURIComponent(token)}&user_id=${encodeURIComponent(userId)}`;
    const minResp = await fetch(url, {
        method: 'POST',
        headers: {
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
        },
        body: minBody,
    });
    const minText = await minResp.text();
    console.log('  Status:', minResp.status);
    console.log('  Response (first 300):', minText.substring(0, 300));
    const sites3 = parseSiteList(minText);
    console.log('  Parsed sites:', sites3.length);
    
    console.log('');
    console.log('=== DONE ===');
}

run().catch(err => console.error('Fatal:', err));
