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

function generateDeviceId() {
    return 'aid_' + crypto.randomBytes(6).toString('hex');
}

async function testLogin() {
    const email = 'muriel55herrera@gmail.com';
    const password = '730crai8';
    const deviceId = generateDeviceId();

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

    const params = {
        login: email,
        password: password,
        google_email: email,
        version_code: CONFIG.VERSION_CODE,
        version_name: CONFIG.VERSION_NAME,
        ...deviceInfo
    };

    const body = new URLSearchParams(params).toString();
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = uuidv4().replace(/-/g, '');
    const signature = signRequest('', deviceId, timestamp, nonce, body);

    console.log('=== TEST LOGIN ===');
    console.log('Email:', email);
    console.log('DeviceId:', deviceId);
    console.log('Timestamp:', timestamp);
    console.log('Nonce:', nonce);
    console.log('Body:', body.substring(0, 200) + '...');
    console.log('Signature:', signature);
    console.log('');

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

    console.log('Headers:', JSON.stringify(headers, null, 2));
    console.log('');

    try {
        const response = await fetch(`${CONFIG.API_BASE}/api_mobile/mobile_login.php`, {
            method: 'POST',
            headers,
            body,
        });

        console.log('Status:', response.status);
        console.log('Status Text:', response.statusText);
        
        const responseHeaders = {};
        response.headers.forEach((v, k) => responseHeaders[k] = v);
        console.log('Response Headers:', JSON.stringify(responseHeaders, null, 2));
        
        const text = await response.text();
        console.log('Response Body:', text);
        
        try {
            const json = JSON.parse(text);
            console.log('Parsed JSON:', JSON.stringify(json, null, 2));
        } catch (e) {
            console.log('(Not JSON)');
        }
    } catch (err) {
        console.error('Error:', err.message);
    }
}

testLogin();
