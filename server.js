const express = require('express');
const session = require('express-session');
const passport = require('passport');
const Strategy = require('passport-discord').Strategy;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// 1. إعداد قاعدة البيانات للتخزين الدائم
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
    }
});

// 2. إنشاء جدول الإعدادات الشامل للسيرفرات
db.run(`CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    welcome_message TEXT,
    welcome_channel TEXT,
    leave_message TEXT,
    leave_channel TEXT,
    welcome_image TEXT,
    welcome_avatar INTEGER,
    auto_role TEXT,
    levels_enabled INTEGER,
    levels_channel TEXT,
    automod_links INTEGER,
    automod_spam INTEGER,
    ticket_channel TEXT,
    ticket_role TEXT,
    log_channel TEXT,
    prefix TEXT,
    starboard_channel TEXT,
    temp_voice_channel TEXT
)`);

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'shar7_pro_super_secret_key',
    resave: false,
    saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

// 3. إعداد ديسكورد OAuth2
passport.use(new Strategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL || 'https://shar7-bot-dashboard.onrender.com/auth/discord/callback',
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

// مسارات المصادقة (Auth Routes)
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/',
    successRedirect: '/'
}));

// 4. API: جلب بيانات المستخدم الحالي
app.get('/api/user', (req, res) => {
    res.json({ user: req.user || null });
});

// 5. API: جلب السيرفرات التي يملك فيها المستخدم صلاحية الإدارة (MANAGE_GUILD = 0x20)
app.get('/api/servers', (req, res) => {
    if (!req.user || !req.user.guilds) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const adminServers = req.user.guilds.filter(g => (g.permissions & 0x20) === 0x20);
    res.json(adminServers);
});

// 6. API: جلب إعدادات سيرفر معين
app.get('/api/settings/:guildId', (req, res) => {
    const { guildId } = req.params;
    db.get(`SELECT * FROM guild_settings WHERE guild_id = ?`, [guildId], (err, row) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(row || {});
    });
});

// 7. API: حفظ إعدادات سيرفر معين بجميع الخصائص
app.post('/api/settings/:guildId', (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const { guildId } = req.params;
    const {
        welcome_message, welcome_channel, leave_message, leave_channel,
        welcome_image, welcome_avatar, auto_role, levels_enabled,
        levels_channel, automod_links, automod_spam, ticket_channel,
        ticket_role, log_channel, prefix, starboard_channel, temp_voice_channel
    } = req.body;

    const query = `
        INSERT INTO guild_settings (
            guild_id, welcome_message, welcome_channel, leave_message, leave_channel,
            welcome_image, welcome_avatar, auto_role, levels_enabled,
            levels_channel, automod_links, automod_spam, ticket_channel,
            ticket_role, log_channel, prefix, starboard_channel, temp_voice_channel
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET
            welcome_message = excluded.welcome_message,
            welcome_channel = excluded.welcome_channel,
            leave_message = excluded.leave_message,
            leave_channel = excluded.leave_channel,
            welcome_image = excluded.welcome_image,
            welcome_avatar = excluded.welcome_avatar,
            auto_role = excluded.auto_role,
            levels_enabled = excluded.levels_enabled,
            levels_channel = excluded.levels_channel,
            automod_links = excluded.automod_links,
            automod_spam = excluded.automod_spam,
            ticket_channel = excluded.ticket_channel,
            ticket_role = excluded.ticket_role,
            log_channel = excluded.log_channel,
            prefix = excluded.prefix,
            starboard_channel = excluded.starboard_channel,
            temp_voice_channel = excluded.temp_voice_channel
    `;

    db.run(query, [
        guildId, welcome_message, welcome_channel, leave_message, leave_channel,
        welcome_image, welcome_avatar ? 1 : 0, auto_role, levels_enabled ? 1 : 0,
        levels_channel, automod_links ? 1 : 0, automod_spam ? 1 : 0, ticket_channel,
        ticket_role, log_channel, prefix || '!', starboard_channel, temp_voice_channel
    ], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: 'Saved successfully' });
    });
});

app.listen(PORT, () => {
    console.log(`SHAR7 Dashboard Server running on port ${PORT}`);
});
