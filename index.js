require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const { chromium } = require('playwright');

// --- INISIALISASI BOT & CACHE ---
const bot = new Telegraf(process.env.BOT_TOKEN); 
const hitQueue = []; 
let isProcessingHit = false;
let currentTaskDetail = null;
let globalAccountIndex = 0;

// --- DATABASE & SETTING OWNER ---
const USER_DB_FILE = 'users.json'; 
const OWNER_ID = 5420881452; 
const REQUIRED_CHANNEL = '@corvast'; 

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

async function isUserSubscribed(ctx) {
    try {
        const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL, ctx.from.id);
        return ['creator', 'administrator', 'member', 'restricted'].includes(member.status);
    } catch (error) { return true; }
}

// --- COMMANDS BOT ---
bot.start(async (ctx) => {
    saveUser(ctx, ctx.from.id, ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name);
    if (!(await isUserSubscribed(ctx))) {
        return ctx.reply(`🔴 <b>Akses Ditolak!</b>\n\nSilakan join channel kami terlebih dahulu.`, {
            parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.url('🍂 Join Channel', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)]])
        });
    }

    const welcomeText = `<b>[ CORVAST AUTOMATION SYSTEM ]</b>\n\n` +
        `Selamat datang di sistem otomatisasi CORVAST. Bot ini berfungsi sebagai mesin extractor otomatis untuk mendapatkan cookies Netflix (Live) secara massal.\n\n` +
        `<b>📋 Daftar Perintah Sistem</b>\n` +
        `• <code>/hit [jumlah]</code> : Memulai eksekusi. (Contoh: /hit 5)\n` +
        `• <code>/cekantrian</code> : Memantau progres & antrean.\n\n` +
        `<b>👑 Fitur Owner</b>\n` +
        `• <code>/addvip @username [durasi]</code> : Tambah VIP.\n` +
        `• <code>/delvip @username</code> : Hapus VIP.\n` +
        `• <code>/bc [pesan]</code> : Broadcast pesan ke semua user.\n\n` +
        `<b>⚙️ Cara Penggunaan:</b>\n` +
        `1. Pastikan Anda memiliki akses VIP.\n` +
        `2. Ketik /hit [jumlah] untuk masuk ke antrean.\n` +
        `3. Bot memproses akun di latar belakang secara otomatis.\n` +
        `4. Anda akan menerima ringkasan dan file cookies murni saat selesai.`;

    ctx.reply(welcomeText, { parse_mode: 'HTML' });
});

bot.command('cekantrian', (ctx) => {
    let message = `📊 <b>STATUS ANTREAN GENERATOR</b>\n━━━━━━━━━━━━━━━━━━━━━\n`;
    if (!currentTaskDetail && hitQueue.length === 0) return ctx.reply(message + `<i>✅ Antrean kosong. Bot siap digunakan!</i>`, { parse_mode: 'HTML' });
    if (currentTaskDetail) message += `🔄 <b>SEDANG DIPROSES:</b>\n👤 ${currentTaskDetail.username}\n🎯 Progress: <code>${currentTaskDetail.currentCount} / ${currentTaskDetail.targetTotal} Cookies</code>\n\n`;
    if (hitQueue.length > 0) {
        message += `⏳ <b>DAFTAR TUNGGU:</b>\n`;
        hitQueue.forEach((t, i) => message += `<b>${i + 1}.</b> ${t.username} ➔ Target: <code>${t.targetTotal} Link</code>\n`);
    }
    ctx.reply(message, { parse_mode: 'HTML' });
});

bot.command('hit', async (ctx) => {
    const currentUserId = ctx.from.id.toString();
    const isOwner = currentUserId === OWNER_ID.toString();
    const userRecord = loadUsers().find(u => u.id.toString() === currentUserId);
    
    let isVip = userRecord?.isVip === true && (!userRecord.vipExpiredAt || new Date() < new Date(userRecord.vipExpiredAt));
    if (!isOwner && !isVip) return ctx.reply('❌ *Akses Ditolak:*\nCommand ini khusus Owner dan user VIP.', { parse_mode: 'Markdown' });

    const args = ctx.message.text.split(' ');
    if (args.length < 2 || isNaN(parseInt(args[1]))) return ctx.reply('⚠️ *Format salah!*\nGunakan: `/hit <jumlah>`\nContoh: `/hit 5`', { parse_mode: 'Markdown' });
    
    let targetTotal = parseInt(args[1]) === 0 || parseInt(args[1]) > 50 ? 50 : parseInt(args[1]);

    if (hitQueue.some(t => t.userId === currentUserId) || (currentTaskDetail && currentTaskDetail.userId === currentUserId)) {
        return ctx.reply('⏳ <b>KAMU TELAH MENGANTRI!</b>\nSilakan tunggu prosesmu selesai.', { parse_mode: 'HTML' });
    }

    hitQueue.push({ ctx, targetTotal, userId: currentUserId, username: ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name });

    if (isProcessingHit) ctx.reply(`⏳ <b>ANTREAN MASUK</b>\nAntrian kamu ke: <b>${hitQueue.length}</b>`, { parse_mode: 'HTML' });
    else processNextHit();
}); 

async function processNextHit() {
    if (hitQueue.length === 0) { isProcessingHit = false; currentTaskDetail = null; return; }
    isProcessingHit = true;
    const { ctx, targetTotal, userId, username } = hitQueue.shift();
    currentTaskDetail = { userId, username, targetTotal, currentCount: 0 };
    let browser = null;

    try {
        const accounts = readAccountsGen();
        if (accounts.length === 0) return await ctx.reply('❌ File `account.txt` kosong!');

        let statusMsg = await ctx.reply(`🚀 <b>Menyiapkan proses ekstraksi...</b>`, { parse_mode: 'HTML' });
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

            // LAYOUT BARU YANG LEBIH SIMPEL
            const layoutScraping = `<b>[ STATUS PROSES HIT ]</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<blockquote><b>Akun Target :</b> <code>${account.username}</code>\n<b>Progres     :</b> <code>Akun ke-${akunDicoba} dari ${accounts.length}</code>\n<b>Didapat     :</b> <code>${allResults.length} / ${targetTotal} Cookies</code>\n</blockquote>\n\n<i>⏳ Status: Sedang login dan memeriksa akun...</i>`;
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
                    
                    // LAYOUT SAAT BERHASIL MENDAPATKAN LINK
                    const layoutProgress = `<b>[ STATUS PROSES HIT ]</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n<blockquote><b>Akun Target :</b> <code>${account.username}</code>\n<b>Progres     :</b> <code>Akun ke-${akunDicoba} dari ${accounts.length}</code>\n<b>Didapat     :</b> <code>${allResults.length} / ${targetTotal} Cookies</code>\n</blockquote>\n\n<i>⏳ Status: Mengekstrak data cookies...</i>`;
                    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, layoutProgress, { parse_mode: 'HTML' }).catch(()=>{});
                } 
            } catch (error) {} 
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
                `<b>Total Cookies Live :</b> <code>${allResults.length} Cookies Harvested</code>\n` +
                `<b>Countries Hit    :</b> <code>${countriesSummary || 'Global / UN'}</code>\n` +
                `<b>Plan Breakdown   :</b> <code>${plansSummary || 'Netflix Plan'}</code>\n` +
                `<b>Package Status   :</b> <code>Secured & Verified Live</code>\n` +
                `</blockquote>\n\n` +
                `<b>English 🇬🇧 :</b>\n` +
                `<i>Successfully hit cookies, if you want to tidy up the cookie format and check live/dead cookies, please forward this file to the bot @corvastcookie_bot so that it can be automatically sorted.</i>\n\n` +
                `<b>Indonesian 🇮🇩 :</b>\n` +
                `<i>Berhasil hit cookies, jika ingin merapihkan format cookies dan cek cookies live/dead silahkan forward file ini ke bot @corvastcookie_bot agar otomatis di sortir</i>`;
            
            await ctx.reply(summaryLayout, { parse_mode: 'HTML' });

            const textContent = allResults.map(item => item.cookie).join('\n');
            const fileBuffer = Buffer.from(textContent, 'utf8');
            await ctx.replyWithDocument(
                { source: fileBuffer, filename: 'extracted_cookies_live.txt' }, 
                { caption: `📁 <b>Hasil Hit: ${allResults.length} Cookies</b>\n\n📌 <i>Format file ini 100% murni cookies raw.</i>`, parse_mode: 'HTML' }
            );

            if (allResults.length < targetTotal) {
                await ctx.reply(`⚠️ <b>Database akun terkena limit, harap hubungi developer untuk update database.</b>`, { parse_mode: 'HTML' });
            }
        } else {
            await ctx.reply(`⚠️ <b>Database akun terkena limit, harap hubungi developer untuk update database.</b>`, { parse_mode: 'HTML' });
        }
    } catch (error) {
        await ctx.reply(`❌ *Kesalahan Kritis:*\n${error.message}`, { parse_mode: 'Markdown' });
    } finally {
        if (browser) await browser.close().catch(()=>{});
        isProcessingHit = false; currentTaskDetail = null;
        if (hitQueue.length > 0) processNextHit(); 
    }
}

// --- COMMAND VIP & BROADCAST ---
bot.command('addvip', async (ctx) => {
    if (ctx.from.id.toString() !== OWNER_ID.toString()) return ctx.reply("❌ Akses Ditolak!");
    const args = ctx.message.text.split(' ');
    if (args.length < 3) return ctx.reply("⚠️ Format: `/addvip @username 30d`", { parse_mode: 'Markdown' });
    let target = args[1].replace('@', ''), durationInput = args[2].toLowerCase(), users = loadUsers();
    let userIndex = users.findIndex(u => (u.username && u.username.replace('@', '').toLowerCase() === target.toLowerCase()) || u.id.toString() === target);
    if (userIndex === -1) return ctx.reply(`❌ User belum terdaftar.`);
    
    let expiredDate = null, durationText = "Selamanya (Lifetime)";
    if (durationInput !== 'lifetime') {
        const matchDays = durationInput.match(/^(\d+)d$/), matchMonths = durationInput.match(/^(\d+)(m|b)$/);
        let days = matchDays ? parseInt(matchDays[1]) : (matchMonths ? parseInt(matchMonths[1]) * 30 : 0);
        if (days === 0) return ctx.reply("⚠️ Format durasi tidak valid.");
        expiredDate = new Date(); expiredDate.setDate(expiredDate.getDate() + days);
        durationText = expiredDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    users[userIndex].isVip = true; users[userIndex].vipExpiredAt = expiredDate ? expiredDate.toISOString() : null;
    fs.writeFileSync(USER_DB_FILE, JSON.stringify(users, null, 2));
    ctx.reply(`✅ <b>VIP DITAMBAHKAN!</b>\n👤 <code>${users[userIndex].username}</code>\n⏳ Expired: <b>${durationText}</b>`, { parse_mode: 'HTML' });
});

bot.command('delvip', async (ctx) => {
    if (ctx.from.id.toString() !== OWNER_ID.toString()) return ctx.reply("❌ Akses Ditolak!");
    const args = ctx.message.text.split(' ');
    if (args.length < 2) return ctx.reply("⚠️ Format: `/delvip @username`", { parse_mode: 'Markdown' });
    let target = args[1].replace('@', ''), users = loadUsers();
    let userIndex = users.findIndex(u => (u.username && u.username.replace('@', '').toLowerCase() === target.toLowerCase()) || u.id.toString() === target);
    if (userIndex === -1) return ctx.reply(`❌ User tidak ditemukan.`);
    users[userIndex].isVip = false; delete users[userIndex].vipExpiredAt;
    fs.writeFileSync(USER_DB_FILE, JSON.stringify(users, null, 2));
    ctx.reply(`✅ <b>VIP DICABUT!</b>\n👤 <code>${users[userIndex].username}</code>`, { parse_mode: 'HTML' });
});

bot.command('bc', async (ctx) => {
    if (ctx.from.id.toString() !== OWNER_ID.toString()) return;
    const messageText = ctx.message.text.split(' ').slice(1).join(' ');
    if (!messageText) return ctx.reply('⚠️ Format: `/bc [pesan broadcast]`', { parse_mode: 'Markdown' });

    const users = loadUsers();
    let successCount = 0;
    let failCount = 0;
    
    const statusMsg = await ctx.reply(`🔄 <i>Menyiapkan broadcast ke ${users.length} pengguna...</i>`, { parse_mode: 'HTML' });

    for (const user of users) {
        try {
            await bot.telegram.sendMessage(user.id, `📢 <b>BROADCAST INFORMATION</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n${messageText}`, { parse_mode: 'HTML' });
            successCount++;
        } catch (error) {
            failCount++;
        }
        await new Promise(resolve => setTimeout(resolve, 50)); 
    }

    await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, null, `✅ <b>Broadcast Selesai!</b>\n\nBerhasil terkirim: <b>${successCount}</b> user\nGagal (Blokir bot): <b>${failCount}</b> user`, { parse_mode: 'HTML' });
});

bot.catch((err) => console.error(`[Global Error] ⚠️`, err.message));

async function startBotWithRetry() {
    try { await bot.launch({ polling: { timeout: 30 } }); console.log('✅ Bot Online (On-Demand Mode)'); } 
    catch (err) { setTimeout(startBotWithRetry, 5000); }
}
startBotWithRetry();
