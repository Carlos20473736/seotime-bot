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

const deviceId = 'aid_' + crypto.randomBytes(6).toString('hex');
const deviceInfo = {
    device_id: deviceId,
    manufacturer: 'motorola',
    model: 'moto g(60)',
    device: 'hanoip',
    brand: 'motorola',
    android_sdk: '30',
    android_version: '11',
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
    return await response.text();
}

async function apiPostHtml(endpoint, params, token = '') {
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

    const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
        method: 'POST',
        headers,
        body,
    });
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

async function run() {
    const email = 'muriel55herrera@gmail.com';
    const password = '730crai8';

    console.log('=== FULL TEST ===');
    console.log('1. LOGIN...');
    
    const loginParams = {
        login: email,
        password: password,
        google_email: email,
        version_code: CONFIG.VERSION_CODE,
        version_name: CONFIG.VERSION_NAME,
        ...deviceInfo
    };

    const loginText = await apiPost('/api_mobile/mobile_login.php', loginParams);
    console.log('Login response:', loginText);
    
    let loginData;
    try { loginData = JSON.parse(loginText); } catch { console.log('Login parse error'); return; }
    
    if (!loginData.ok) {
        console.log('Login failed:', loginData.error);
        if (loginData.retry_after) {
            console.log(`Retry after ${loginData.retry_after} seconds`);
        }
        return;
    }

    const token = loginData.token;
    const userId = loginData.id;
    console.log(`✓ Login OK! User: ${loginData.username}, Money: ${loginData.money}, Online: ${loginData.online_count}`);
    console.log('');

    // 2. Today stats
    console.log('2. TODAY STATS...');
    const statsText = await apiPost('/api_mobile/today_stats.php', { token, google_email: email, ...deviceInfo }, token);
    console.log('Stats:', statsText);
    console.log('');

    // 3. Fetch sites
    console.log('3. FETCH SITES (last_site)...');
    const sitesParams = { token, user_id: String(userId), ...deviceInfo };
    const sitesHtml = await apiPostHtml('/api_mobile/last_site.php', sitesParams, token);
    console.log('Sites HTML (first 500 chars):', sitesHtml.substring(0, 500));
    
    const sites = parseSiteList(sitesHtml);
    console.log(`Found ${sites.length} sites`);
    if (sites.length > 0) {
        console.log('First 3 sites:', JSON.stringify(sites.slice(0, 3), null, 2));
    }
    console.log('');

    if (sites.length === 0) {
        console.log('No sites available, stopping.');
        return;
    }

    // 4. Start a view
    const site = sites[0];
    console.log(`4. VIEW STARTED (site_id=${site.siteId}, ${site.seconds}s, ${site.reward}₽)...`);
    const viewStartParams = {
        token,
        google_email: email,
        site_id: String(site.siteId),
        reward: site.reward,
        seconds: String(site.seconds),
        url: site.url,
        ...deviceInfo
    };
    const viewStartText = await apiPost('/api_mobile/view_started.php', viewStartParams, token);
    console.log('View started:', viewStartText);
    
    let viewStartData;
    try { viewStartData = JSON.parse(viewStartText); } catch { console.log('Parse error'); return; }
    
    if (!viewStartData.ok) {
        console.log('View start failed:', viewStartData.error);
        return;
    }

    const viewId = viewStartData.view_id;
    const waitSeconds = viewStartData.required_seconds || site.seconds;
    console.log(`✓ View started! view_id=${viewId}, waiting ${waitSeconds}s...`);
    
    // Wait
    await new Promise(r => setTimeout(r, (waitSeconds + 2) * 1000));

    // 5. Complete view
    console.log(`5. VIEW COMPLETED (view_id=${viewId})...`);
    const viewCompleteParams = {
        token,
        google_email: email,
        site_id: String(site.siteId),
        view_id: String(viewId),
        ...deviceInfo
    };
    const viewCompleteText = await apiPost('/api_mobile/view_completed.php', viewCompleteParams, token);
    console.log('View completed:', viewCompleteText);
    
    console.log('');
    console.log('=== TEST COMPLETE ===');
}

run().catch(err => console.error('Fatal error:', err));
