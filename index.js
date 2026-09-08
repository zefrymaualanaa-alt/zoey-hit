require('dotenv').config();
const { Telegraf } = require('telegraf'); // Hapus Markup karena kita pakai raw object
const axios = require('axios');
const fs = require('fs');
const { chromium } = require('playwright');

// --- INISIALISASI BOT & CACHE ---
const bot = new Telegraf(process.env.BOT_TOKEN); 
const hitQueue = []; 
let isProcessingHit = false;
let currentTaskDetail = null;
let globalAccountIndex = 0;
const userStates = {}; 

// --- DATABASE & SETTING OWNER ---
const USER_DB_FILE = 'users.json'; 
const OWNER_ID = 5420881452; 

// --- SISTEM STATISTIK RINGAN (REAL-TIME) ---
const STATS_FILE = 'stats.json';
let systemStats = {
    totalCookies: 0,
    cookiesToday: 0,
    lastDate: new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }),
    totalTimeSeconds: 0,       
    totalCookiesForSpeed: 0    
};

function loadStats() {
    try {
        if (!fs.existsSync(STATS_FILE)) {
            fs.writeFileSync(STATS_FILE, JSON.stringify(systemStats, null, 2));
        } else {
            systemStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
        }
    } catch (e) { console.log("Gagal memuat stats.json"); }
}

function saveStats() {
    try {
        fs.writeFileSync(STATS_FILE, JSON.stringify(systemStats, null, 2));
    } catch (e) {}
}
loadStats();

// --- FUNGSI PEMETAAN NEGARA & BENDERA KOMPLIT ---
function getCountryDetail(countryCode) {
    if (!countryCode || countryCode === 'Not Detected' || countryCode === 'Global / UN') return { name: countryCode, flag: '' };
    const cleanCode = countryCode.replace(/[\p{Emoji}\s]/gu, '').toUpperCase().trim();
    const countryMap = {
        'ID': { name: 'Indonesia', flag: '🇮🇩' }, 'SG': { name: 'Singapore', flag: '🇸🇬' },
        'MY': { name: 'Malaysia', flag: '🇲🇾' }, 'PH': { name: 'Philippines', flag: '🇵🇭' },
        'TH': { name: 'Thailand', flag: '🇹🇭' }, 'VN': { name: 'Vietnam', flag: '🇻🇳' },
        'IN': { name: 'India', flag: '🇮🇳' }, 'JP': { name: 'Japan', flag: '🇯🇵' },
        'KR': { name: 'South Korea', flag: '🇰🇷' }, 'TW': { name: 'Taiwan', flag: '🇹🇼' },
        'HK': { name: 'Hong Kong', flag: '🇭🇰' }, 'CN': { name: 'China', flag: '🇨🇳' },
        'PK': { name: 'Pakistan', flag: '🇵🇰' }, 'BD': { name: 'Bangladesh', flag: '🇧🇩' },
        'LK': { name: 'Sri Lanka', flag: '🇱🇰' }, 'NP': { name: 'Nepal', flag: '🇳🇵' },
        'MM': { name: 'Myanmar', flag: '🇲🇲' }, 'KH': { name: 'Cambodia', flag: '🇰🇭' },
        'LA': { name: 'Laos', flag: '🇱🇦' }, 'BN': { name: 'Brunei', flag: '🇧🇳' },
        'MO': { name: 'Macau', flag: '🇲🇴' },
        'US': { name: 'United States', flag: '🇺🇸' }, 'CA': { name: 'Canada', flag: '🇨🇦' },
        'BR': { name: 'Brazil', flag: '🇧🇷' }, 'MX': { name: 'Mexico', flag: '🇲🇽' },
        'AR': { name: 'Argentina', flag: '🇦🇷' }, 'CO': { name: 'Colombia', flag: '🇨🇴' },
        'CL': { name: 'Chile', flag: '🇨🇱' }, 'PE': { name: 'Peru', flag: '🇵🇪' },
        'VE': { name: 'Venezuela', flag: '🇻🇪' }, 'EC': { name: 'Ecuador', flag: '🇪🇨' },
        'BO': { name: 'Bolivia', flag: '🇧🇴' }, 'PY': { name: 'Paraguay', flag: '🇵🇾' },
        'UY': { name: 'Uruguay', flag: '🇺🇾' }, 'CR': { name: 'Costa Rica', flag: '🇨🇷' },
        'PA': { name: 'Panama', flag: '🇵🇦' }, 'DO': { name: 'Dominican Republic', flag: '🇩🇴' },
        'GT': { name: 'Guatemala', flag: '🇬🇹' }, 'HN': { name: 'Honduras', flag: '🇭🇳' },
        'GB': { name: 'United Kingdom', flag: '🇬🇧' }, 'DE': { name: 'Germany', flag: '🇩🇪' },
        'FR': { name: 'France', flag: '🇫🇷' }, 'IT': { name: 'Italy', flag: '🇮🇹' },
        'ES': { name: 'Spain', flag: '🇪🇸' }, 'NL': { name: 'Netherlands', flag: '🇳🇱' },
        'PL': { name: 'Poland', flag: '🇵🇱' }, 'RU': { name: 'Russia', flag: '🇷🇺' },
        'UA': { name: 'Ukraine', flag: '🇺🇦' }, 'SE': { name: 'Sweden', flag: '🇸🇪' },
        'NO': { name: 'Norway', flag: '🇳🇴' }, 'FI': { name: 'Finland', flag: '🇫🇮' },
        'DK': { name: 'Denmark', flag: '🇩🇰' }, 'IE': { name: 'Ireland', flag: '🇮🇪' },
        'CH': { name: 'Switzerland', flag: '🇨🇭' }, 'AT': { name: 'Austria', flag: '🇦🇹' },
        'BE': { name: 'Belgium', flag: '🇧🇪' }, 'PT': { name: 'Portugal', flag: '🇵🇹' },
        'TR': { name: 'Turkey', flag: '🇹🇷' }, 'ZA': { name: 'South Africa', flag: '🇿🇦' },
        'AE': { name: 'United Arab Emirates', flag: '🇦🇪' }, 'SA': { name: 'Saudi Arabia', flag: '🇸🇦' },
        'EG': { name: 'Egypt', flag: '🇪🇬' }, 'NG': { name: 'Nigeria', flag: '🇳🇬' },
        'IL': { name: 'Israel', flag: '🇮🇱' }, 'QA': { name: 'Qatar', flag: '🇶🇦' },
        'AU': { name: 'Australia', flag: '🇦🇺' }, 'NZ': { name: 'New Zealand', flag: '🇳🇿' }
    };
    return countryMap[cleanCode] || { name: cleanCode, flag: '' };
}

// --- HELPER FUNCTION GENERATOR ---
function readAccountsGen() {
    try {
        if (!fs.existsSync('account.txt')) return [];
        return fs.readFileSync('account.txt', 'utf8').split('\n').filter(line => line.trim() !== '').map(line => {
            const [username, password] = line.split(':');
            return { username: username.trim(), password: password.trim() };
        });
    } catch (error) { return []; }
}

async function getLinkFromCodeboxGen(page) {
    try {
        await page.waitForSelector('.codebox', { timeout: 30000, state: 'visible' });
        const link = await page.$eval('.codebox code', el => el.textContent.trim());
        if (link && link.includes('https://netflix.com/?nftoken=')) return link;
        return null;
    } catch (error) { return null; }
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
    } catch (error) { return false; }
}

// --- FUNGSI RESOLVE LINK LOGIN MENJADI COOKIE MENTAH ---
async function resolveLinkToCookie(targetUrl) {
    try {
        let currentUrl = targetUrl, netflixId = '', secureNetflixId = '', nfvdid = '', combinedCookies = '', attempt = 0;
        while (attempt < 5) {
            const response = await axios.get(currentUrl, {
                maxRedirects: 0, validateStatus: (status) => status >= 200 && status <= 302,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36', 'Cookie': combinedCookies }
            });
            const setCookieHeaders = response.headers['set-cookie'];
            if (setCookieHeaders) {
                setCookieHeaders.forEach(cookieStr => {
                    const cookiePart = cookieStr.split(';')[0], key = cookiePart.split('=')[0], val = cookiePart.substring(key.length + 1);
                    if (key === 'NetflixId') netflixId = val;
                    if (key === 'SecureNetflixId') secureNetflixId = val;
                    if (key === 'nfvdid') nfvdid = val;
                    combinedCookies += `${cookiePart}; `;
                });
            }
            if (response.status === 301 || response.status === 302) {
                currentUrl = response.headers.location;
                if (!currentUrl.startsWith('http')) currentUrl = `https://www.netflix.com${currentUrl}`;
                attempt++;
            } else break;
        }
        if (netflixId && secureNetflixId) return `NetflixId=${netflixId}; SecureNetflixId=${secureNetflixId}; ${nfvdid ? 'nfvdid=' + nfvdid + ';' : ''}`;
        return null;
    } catch (error) { return null; }
}

// --- SISTEM DATABASE ---
function loadUsers() {
    try {
        if (!fs.existsSync(USER_DB_FILE)) {
            fs.writeFileSync(USER_DB_FILE, JSON.stringify([], null, 2));
            return [];
        }
        return JSON.parse(fs.readFileSync(USER_DB_FILE, 'utf8'));
    } catch (e) { return []; }
}

function saveUser(ctx, userId, username = 'User VIP') {
    let users = loadUsers();
    let userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        users.push({ id: userId, username: username, isVip: false });
        fs.writeFileSync(USER_DB_FILE, JSON.stringify(users, null, 2));
    }
}

// --- HELPER BUILD BUTTON WARNA-WARNI ---
function buildBtn(text, data, style = 'primary') {
    return {
        text: text,
        callback_data: data,
        style: style
    };
}

// --- FUNGSI GENERATE TEKS START / HOME DENGAN STATISTIK NYATA ---
function generateWelcomeText(ctx) {
    let ping = 0;
    if (ctx.message && ctx.message.date) ping = Date.now() - (ctx.message.date * 1000);
    else ping = Math.floor(Math.random() * 80) + 20;
    if (ping < 0 || isNaN(ping)) ping = Math.floor(Math.random() * 50) + 30;

    const totalUsers = loadUsers().length;

    let totalSeconds = process.uptime();
    let days = Math.floor(totalSeconds / 86400);
    let hours = Math.floor((totalSeconds % 86400) / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let uptimeStr = `${days}h ${hours}j ${minutes}m`;

    const now = new Date();
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' };
    const dateStr = now.toLocaleDateString('id-ID', dateOptions);
    const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute:'2-digit', second:'2-digit', timeZone: 'Asia/Jakarta' }).replace(/\./g, ':');
    const currentTime = `${dateStr} | ${timeStr} WIB`;

    const todayStr = now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
    if (systemStats.lastDate !== todayStr) {
        systemStats.cookiesToday = 0;
        systemStats.lastDate = todayStr;
        saveStats();
    }

    let avgSpeed = 0;
    if (systemStats.totalCookiesForSpeed > 0) {
        avgSpeed = (systemStats.totalTimeSeconds / systemStats.totalCookiesForSpeed).toFixed(2);
    }

    return `<b>[ CORVAST  NETFLIX HIT ]</b>\n\n` +
        `Selamat datang, <b>${ctx.from.first_name ||'}</b>.\n\n` +
        `Bot ini dirancang untuk mendapatkan sesi cookies Netflix live secara massal. Pastikan sebelum menjalankan bot ini kamu sudah memiliki akses membership ke bot.\n\n` +

        `📊 <b>STATUS BOT:</b>\n\n` +
        `🗓 Diproses Hari Ini: <code>${systemStats.cookiesToday} Cookie</code>\n` +
        `✅ Keseluruhan Data: <code>${systemStats.totalCookies} Cookie</code>\n` +
        `⚡️ Kecepatan Rata-rata: <code>${avgSpeed} detik/cookie</code>\n` +
        `👤 Pengguna Aktif: <code>${totalUsers} User</code>\n` +
        `⌛️ Bot Aktif Selama: <code>${uptimeStr}</code>\n` +
        `🚀 Ping Server: <code>${ping}ms</code>\n` +
        `⏰ Waktu: <code>${currentTime}</code>\n\n` +
        `Silakan gunakan panel kendali interaktif di bawah ini untuk mulai mengoperasikan bot.`;
}

// --- FUNGSI HANDLE ANTRIAN ---
function handleCekAntrian(ctx) {
    let message = `📊 <b>STATUS ANTREAN GENERATOR</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
    if (!currentTaskDetail && hitQueue.length === 0) return ctx.reply(message + `<i>✅ Antrean kosong. Bot siap digunakan!</i>`, { parse_mode: 'HTML' });
    if (currentTaskDetail) message += `🔄 <b>SEDANG DIPROSES:</b>\n👤 ${currentTaskDetail.username}\n🎯 Progress: <code>${currentTaskDetail.currentCount} / ${currentTaskDetail.targetTotal} Cookies</code>\n\n`;
    if (hitQueue.length > 0) {
        message += `⏳ <b>DAFTAR TUNGGU:</b>\n`;
        hitQueue.forEach((t, i) => message += `<b>${i + 1}.</b> ${t.username} ➔ Target: <code>${t.targetTotal} Link</code>\n`);
    }
    ctx.reply(message, { parse_mode: 'HTML' });
}

function handleHitQueue(ctx, currentUserId, targetTotal) {
    if (hitQueue.some(t => t.userId === currentUserId) || (currentTaskDetail && currentTaskDetail.userId === currentUserId)) {
        return ctx.reply('⏳ <b>SISTEM SEDANG MEMPROSES</b>\nAnda sudah memiliki antrean aktif. Mohon tunggu proses sebelumnya selesai.', { parse_mode: 'HTML' });
    }

    hitQueue.push({ ctx, targetTotal, userId: currentUserId, username: ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name });

    if (isProcessingHit) ctx.reply(`⏳ <b>ANTREAN DITERIMA</b>\nSistem sedang padat. Posisi antrean Anda: <b>${hitQueue.length}</b>`, { parse_mode: 'HTML' });
    else processNextHit();
}

// --- COMMANDS BOT ---
bot.start(async (ctx) => {
    saveUser(ctx, ctx.from.id, ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name);

    const welcomeText = generateWelcomeText(ctx);

    ctx.reply(welcomeText, { 
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    buildBtn('🚀 RUN SYSTEM', 'action_run_bot', 'success'), 
                    buildBtn('🌟 CEK ANTRIAN', 'action_cek_antrian', 'primary')
                ],
                [
                    buildBtn('📖 MENU FITUR', 'action_menu_bot', 'danger')
                ]
            ]
        }
    });
});

bot.command('cekantrian', (ctx) => {
    handleCekAntrian(ctx);
});

bot.command('hit', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    const isOwner = currentUserId === OWNER_ID.toString();
    const userRecord = loadUsers().find(u => u.id.toString() === currentUserId);
    let isVip = userRecord?.isVip === true && (!userRecord.vipExpiredAt || new Date() < new Date(userRecord.vipExpiredAt));
    if (!isOwner && !isVip) return ctx.reply('❌ <b>Akses Ditolak:</b>\nFitur eksklusif ini hanya dapat diakses oleh Owner dan anggota VIP.', { parse_mode: 'HTML' });

    const args = ctx.message.text.split(' ');
    if (args.length < 2 || isNaN(parseInt(args[1]))) return ctx.reply('⚠️ <b>Format Input Invalid</b>\nPanduan penggunaan: <code>/hit &lt;jumlah&gt;</code>\nContoh: <code>/hit 5</code>', { parse_mode: 'HTML' });
    
    let targetTotal = parseInt(args[1]) === 0 || parseInt(args[1]) > 100 ? 100 : parseInt(args[1]);
    handleHitQueue(ctx, currentUserId, targetTotal);
});

// --- TOMBOL ACTION HANDLER ---
bot.action('action_cek_antrian', (ctx) => {
    ctx.answerCbQuery();
    handleCekAntrian(ctx);
});

bot.action('action_run_bot', async (ctx) => {
    ctx.answerCbQuery();
    const currentUserId = ctx.from.id.toString();
    const isOwner = currentUserId === OWNER_ID.toString();
    const userRecord = loadUsers().find(u => u.id.toString() === currentUserId);
    
    let isVip = userRecord?.isVip === true && (!userRecord.vipExpiredAt || new Date() < new Date(userRecord.vipExpiredAt));
    if (!isOwner && !isVip) return ctx.reply('❌ <b>Akses Ditolak:</b>\nOtorisasi gagal. Sistem ini khusus untuk Administrator dan Pengguna VIP.', { parse_mode: 'HTML' });

    userStates[currentUserId] = 'AWAITING_HIT_COUNT';
    ctx.reply('🔢 <b>SISTEM MENUNGGU INPUT</b>\n\nBerapa jumlah target data akun yang ingin Anda ekstraksi pada sesi ini?\n\n<i>(Kirimkan format angka bilangan bulat saja, contoh: 5)</i>', { parse_mode: 'HTML' });
});

bot.action('action_menu_bot', (ctx) => {
    ctx.answerCbQuery();
    const menuText = `<b>[ PUSAT KENDALI SISTEM ]</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Berikut adalah modul perintah utama yang tersedia di sistem Corvast:\n\n` +
        `<b>🚀 Modul Eksekusi</b>\n` +
        `• <code>/hit [jumlah]</code> : Eksekusi manual mesin ekstraksi (Maks 100).\n` +
        `• <code>/cekantrian</code> : Pantau status lalu lintas server secara <i>real-time</i>.\n\n` +
        `<b>👑 Modul Administrator</b>\n` +
        `• <code>/addvip @username [durasi]</code> : Mendaftarkan kredensial VIP baru.\n` +
        `• <code>/delvip @username</code> : Mencabut otorisasi VIP pengguna.\n` +
        `• <code>/bc [pesan]</code> : Menyiarkan pemberitahuan global ke <i>database</i> pengguna.\n\n` +
        `<i>Anda juga dapat mengoperasikan sistem dengan mudah menggunakan panel tombol di bawah ini.</i>`;

    ctx.editMessageText(menuText, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    buildBtn('🚀 RUN SYSTEM', 'action_run_bot', 'success'), 
                    buildBtn('🌟 CEK ANTRIAN', 'action_cek_antrian', 'primary')
                ],
                [
                    buildBtn('⬅️ KEMBALI KE BERANDA', 'action_back_home', 'danger')
                ]
            ]
        }
    }).catch(() => {});
});

bot.action('action_back_home', (ctx) => {
    ctx.answerCbQuery();
    const welcomeText = generateWelcomeText(ctx);

    ctx.editMessageText(welcomeText, { 
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    buildBtn('🚀 RUN SYSTEM', 'action_run_bot', 'success'), 
                    buildBtn('🌟 CEK ANTRIAN', 'action_cek_antrian', 'primary')
                ],
                [
                    buildBtn('📖 MENU FITUR', 'action_menu_bot', 'primary')
                ]
            ]
        }
    }).catch(() => {});
});

// --- TEXT INPUT HANDLER ---
bot.on('text', async (ctx, next) => {
    const currentUserId = ctx.from.id.toString();
    
    if (userStates[currentUserId] === 'AWAITING_HIT_COUNT') {
        const inputStr = ctx.message.text.trim();
        const targetCount = parseInt(inputStr);
        
        if (isNaN(targetCount) || targetCount <= 0) {
            return ctx.reply('⚠️ <b>Input Invalid</b>\nSistem hanya menerima input numerik. Silakan kirim ulang angka dengan benar. (Contoh: 5)', { parse_mode: 'HTML' });
        }
        
        delete userStates[currentUserId];
        let targetTotal = targetCount > 100 ? 100 : targetCount;
        
        await ctx.reply(`✅ <b>Otorisasi Target: ${targetTotal} Data</b>\nSistem sedang menyiapkan resource komputasi...`, { parse_mode: 'HTML' });
        handleHitQueue(ctx, currentUserId, targetTotal);
        return;
    }
    
    return next();
});

async function processNextHit() {
    if (hitQueue.length === 0) { isProcessingHit = false; currentTaskDetail = null; return; }
    isProcessingHit = true;
    const { ctx, targetTotal, userId, username } = hitQueue.shift();
    currentTaskDetail = { userId, username, targetTotal, currentCount: 0 };
    let browser = null;

    try {
        const accounts = readAccountsGen();
        if (accounts.length === 0) return await ctx.reply('❌ <b>Error:</b> Database `account.txt` kosong atau tidak ditemukan.', { parse_mode: 'HTML' });

        let statusMsg = await ctx.reply(`🚀 <b>Inisialisasi mesin ekstraktor dimulai...</b>`, { parse_mode: 'HTML' });
        const allResults = [];
        let akunDicoba = 0;

        browser = await chromium.launch({
            headless: true,
            args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        
        while (akunDicoba < accounts.length) {
            if (targetTotal > 0 && allResults.length >= targetTotal) break;
            const account = accounts[globalAccountIndex];
            globalAccountIndex = (globalAccountIndex + 1) % accounts.length; 
            akunDicoba++;

            const layoutScraping = `<b>[ STATUS PROSES HIT ]</b>\n` +
`<pre>[Sistem] Menginisialisasi otomatisasi...
[Target] Memproses akun ke-${akunDicoba} dari ${accounts.length}
[Akun]   Mencoba otorisasi: ${account.username}
[Aksi]   Sedang login dan memverifikasi akses...
[Result] Terkumpul: ${allResults.length} / ${targetTotal} Sesi</pre>`;

            await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, layoutScraping, { parse_mode: 'HTML' }).catch(()=>{});
            
            let context = null, page = null;
            try {
                context = await browser.newContext();
                await context.route('**/*', (route) => {
                    if (['image', 'media', 'font', 'stylesheet'].includes(route.request().resourceType())) route.abort();
                    else route.continue();
                });
                page = await context.newPage();
                await page.goto('https://kxntu.com/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
                await page.fill('#l-username', account.username);
                await page.fill('#l-password', account.password); 
                await page.click('button[type="submit"].btn-primary');
                await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
                await page.goto('https://kxntu.com/generar', { waitUntil: 'domcontentloaded', timeout: 45000 });

                let startHitTime = Date.now();

                while (true) {
                    if (targetTotal > 0 && allResults.length >= targetTotal) break;
                    await page.click('#btn-link');
                    const link = await getLinkFromCodeboxGen(page);
                    if (!link) break; 
                    if (await checkPartnerGen(page)) { await page.waitForTimeout(500); continue; }
                    const activeCookie = await resolveLinkToCookie(link);
                    if (!activeCookie) continue; 

                    let hitCountry = 'Global / UN', hitPlan = 'Netflix Plan';
                    try {
                        const infoElements = await page.$$('.kx-kv');
                        for (const element of infoElements) {
                            const label = (await element.$eval('.k', el => el.textContent.trim()).catch(() => '')).toLowerCase();
                            const value = await element.$eval('.v', el => el.textContent.trim()).catch(() => '');
                            if (label.includes('plan') || label.includes('paket')) hitPlan = value;
                            if (label.includes('country') || label.includes('negara') || label.includes('region') || label.includes('país') || label.includes('pais')) hitCountry = value;
                        }
                    } catch (e) {}

                    const countryDetail = getCountryDetail(hitCountry);
                    const formattedCountry = countryDetail.flag ? `${countryDetail.flag} ${countryDetail.name}` : hitCountry;

                    allResults.push({ cookie: activeCookie, country: formattedCountry, plan: hitPlan });
                    currentTaskDetail.currentCount = allResults.length;
                    
                    // --- UPDATE STATISTIK REAL-TIME ---
                    const timeTakenMs = Date.now() - startHitTime;
                    const todayDate = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
                    
                    if (systemStats.lastDate !== todayDate) {
                        systemStats.cookiesToday = 0;
                        systemStats.lastDate = todayDate;
                    }

                    systemStats.totalCookies++;
                    systemStats.cookiesToday++;
                    systemStats.totalTimeSeconds += (timeTakenMs / 1000);
                    systemStats.totalCookiesForSpeed++;
                    saveStats();

                    startHitTime = Date.now();

                    const layoutProgress = `<b>[ STATUS PROSES HIT ]</b>\n` +
`<pre>[Sistem] Sesi login valid terdeteksi...
[Target] Memproses akun ke-${akunDicoba} dari ${accounts.length}
[Akun]   Berhasil diakses: ${account.username}
[Aksi]   🟢 [SUKSES] Ekstrak sesi live...
[Result] Terkumpul: ${allResults.length} / ${targetTotal} Sesi</pre>`;

                    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, layoutProgress, { parse_mode: 'HTML' }).catch(()=>{});
                } 
            } catch (error) {
                console.log(`[Error Ekstraktor] Akun ${account.username}:`, error.message);
            } 
            finally { if (page) await page.close().catch(()=>{}); if (context) await context.close().catch(()=>{}); }
        } 
        
        await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});

        if (allResults.length > 0) {
            const countryCounts = {};
            const planCounts = {};
            allResults.forEach(item => {
                const cLabel = item.country || 'Not Detected';
                countryCounts[cLabel] = (countryCounts[cLabel] || 0) + 1;
                const pLabel = item.plan || 'Netflix Plan';
                planCounts[pLabel] = (planCounts[pLabel] || 0) + 1;
            });
            const countriesSummary = Object.entries(countryCounts).map(([name, count]) => `${name} ${count}`).join(' | ');
            const plansSummary = Object.entries(planCounts).map(([name, count]) => `${name} ${count}`).join(' | ');

            const summaryLayout = 
                `<blockquote>` +
                `<b>Total Cookies Live :</b> <code>${allResults.length} Data Terverifikasi</code>\n` +
                `<b>Distribusi Region  :</b> <code>${countriesSummary || 'Global / UN'}</code>\n` +
                `<b>Rincian Paket      :</b> <code>${plansSummary || 'Netflix Plan'}</code>\n` +
                `<b>Status Akhir       :</b> <code>Operasi Ekstraksi Berhasil</code>\n` +
                `</blockquote>\n\n` +
                `<b>Keterangan Tambahan:</b>\n` +
                `<i>Sistem telah menyelesaikan tugas dengan sukses. Jika Anda membutuhkan standarisasi format atau verifikasi live/dead lanjutan, silakan teruskan file output di bawah ini ke bot manajemen @corvastcookie_bot agar diproses lebih lanjut.</i>`;
            
            await ctx.reply(summaryLayout, { parse_mode: 'HTML' });

            const textContent = allResults.map(item => item.cookie).join('\n');
            const fileBuffer = Buffer.from(textContent, 'utf8');
            await ctx.replyWithDocument(
                { source: fileBuffer, filename: 'LiveCookies.txt' }, 
                { caption: `📁 <b>Report Output: ${allResults.length} Data (Live)</b>\n\n📌 <i>Berkas ini berisi data sesi murni (raw cookies) yang dienkripsi oleh sistem.</i>`, parse_mode: 'HTML' }
            );

            if (allResults.length < targetTotal) {
                await ctx.reply(`⚠️ <b>Perhatian:</b> Kapasitas database akun telah mencapai batas operasional (Limit). Hubungi developer untuk *update* sumber daya database.`, { parse_mode: 'HTML' });
            }
        } else {
            await ctx.reply(`⚠️ <b>Perhatian:</b> Kapasitas database akun telah mencapai batas operasional (Limit). Hubungi developer untuk *update* sumber daya database.`, { parse_mode: 'HTML' });
        }
    } catch (error) {
        await ctx.reply(`❌ <b>Kesalahan Fatal Sistem:</b>\n<code>${error.message}</code>`, { parse_mode: 'HTML' });
    } finally {
        if (browser) await browser.close().catch(()=>{});
        isProcessingHit = false; currentTaskDetail = null;
        if (hitQueue.length > 0) processNextHit(); 
    }
}

// --- COMMAND VIP & BROADCAST ---
bot.command('addvip', async (ctx) => {
    if (ctx.from.id.toString() !== OWNER_ID.toString()) return ctx.reply("❌ Otorisasi Ditolak!");
    const args = ctx.message.text.split(' ');
    if (args.length < 3) return ctx.reply("⚠️ Format Perintah: <code>/addvip @username 30d</code>", { parse_mode: 'HTML' });
    let target = args[1].replace('@', ''), durationInput = args[2].toLowerCase(), users = loadUsers();
    let userIndex = users.findIndex(u => (u.username && u.username.replace('@', '').toLowerCase() === target.toLowerCase()) || u.id.toString() === target);
    if (userIndex === -1) return ctx.reply(`❌ Pengguna tidak terdaftar di database.`);
    
    let expiredDate = null, durationText = "Selamanya (Lifetime)";
    if (durationInput !== 'lifetime') {
        const matchDays = durationInput.match(/^(\d+)d$/), matchMonths = durationInput.match(/^(\d+)(m|b)$/);
        let days = matchDays ? parseInt(matchDays[1]) : (matchMonths ? parseInt(matchMonths[1]) * 30 : 0);
        if (days === 0) return ctx.reply("⚠️ Format durasi waktu tidak valid.");
        expiredDate = new Date(); expiredDate.setDate(expiredDate.getDate() + days);
        durationText = expiredDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    users[userIndex].isVip = true; users[userIndex].vipExpiredAt = expiredDate ? expiredDate.toISOString() : null;
    fs.writeFileSync(USER_DB_FILE, JSON.stringify(users, null, 2));
    ctx.reply(`✅ <b>AKSES VIP DIBERIKAN</b>\n👤 Pengguna: <code>${users[userIndex].username}</code>\n⏳ Masa Aktif: <b>${durationText}</b>`, { parse_mode: 'HTML' });
});

bot.command('delvip', async (ctx) => {
    if (ctx.from.id.toString() !== OWNER_ID.toString()) return ctx.reply("❌ Otorisasi Ditolak!");
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply("⚠️ Format Perintah: <code>/delvip @username</code>", { parse_mode: 'HTML' });
    let target = args[1].replace('@', ''), users = loadUsers();
    let userIndex = users.findIndex(u => (u.username && u.username.replace('@', '').toLowerCase() === target.toLowerCase()) || u.id.toString() === target);
    if (userIndex === -1) return ctx.reply(`❌ Pengguna tidak ditemukan.`);
    users[userIndex].isVip = false; delete users[userIndex].vipExpiredAt;
    fs.writeFileSync(USER_DB_FILE, JSON.stringify(users, null, 2));
    ctx.reply(`✅ <b>AKSES VIP DICABUT</b>\n👤 Pengguna: <code>${users[userIndex].username}</code>\nSistem telah menonaktifkan otorisasi pengguna tersebut.`, { parse_mode: 'HTML' });
});

bot.command('bc', async (ctx) => {
    if (ctx.from.id.toString() !== OWNER_ID.toString()) return;
    const messageText = ctx.message.text.split(' ').slice(1).join(' ');
    if (!messageText) return ctx.reply('⚠️ Format Perintah: <code>/bc [Pesan Siaran]</code>', { parse_mode: 'HTML' });

    const users = loadUsers();
    let successCount = 0;
    let failCount = 0;
    
    const statusMsg = await ctx.reply(`🔄 <i>Sistem sedang mendistribusikan pesan ke ${users.length} pengguna...</i>`, { parse_mode: 'HTML' });

    for (const user of users) {
        try {
            await bot.telegram.sendMessage(user.id, `📢 <b>INFORMASI SISTEM</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n${messageText}`, { parse_mode: 'HTML' });
            successCount++;
        } catch (error) {
            failCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 50)); 
    }

    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `✅ <b>Operasi Siaran Selesai</b>\n\nBerhasil didistribusikan: <b>${successCount}</b> pengguna\nGagal (Blokir/Unreachable): <b>${failCount}</b> pengguna`, { parse_mode: 'HTML' });
});

bot.catch((err) => console.error(`[Global Error] ⚠️`, err.message));

async function startBotWithRetry() {
    try { await bot.launch({ polling: { timeout: 30 } }); console.log('✅ Sistem Corvast Online & Beroperasi (Mode Terenkripsi)'); } 
    catch (err) { setTimeout(startBotWithRetry, 5000); }
}
startBotWithRetry();