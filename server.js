const express = require('express');
const session = require('express-session');
const passport = require('passport');
const Strategy = require('passport-discord').Strategy;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// إعداد قاعدة البيانات للتخزين الدائم
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) console.error('Error opening database', err.message);
    else console.log('Connected to SQLite database.');
});

// إنشاء جدول إعدادات السيرفرات
db.run(`CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    welcome_message TEXT,
    welcome_channel TEXT,
    prefix TEXT,
    log_channel TEXT,
    ticket_channel TEXT
)`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET || 'shar7_bot_super_secret',
    resave: false,
    saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new Strategy({
    clientID: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.DISCORD_CALLBACK_URL || 'https://shar7-bot-dashboard.onrender.com/auth/discord/callback',
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    return done(null, profile);
}));

// مسارات المصادقة
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/',
    successRedirect: '/'
}));

// جلب المستخدم الحالي
app.get('/api/user', (req, res) => {
    res.json({ user: req.user || null });
});

// جلب السيرفرات التي يملك المستخدم صلاحية إدارتها
app.get('/api/servers', (req, res) => {
    if (!req.user || !req.user.guilds) return res.status(401).json({ error: 'Unauthorized' });
    const adminServers = req.user.guilds.filter(g => (g.permissions & 0x20) === 0x20);
    res.json(adminServers);
});

// جلب إعدادات سيرفر معين
app.get('/api/settings/:guildId', (req, res) => {
    const { guildId } = req.params;
    db.get(`SELECT * FROM guild_settings WHERE guild_id = ?`, [guildId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || {});
    });
});

// حفظ إعدادات سيرفر معين
app.post('/api/settings/:guildId', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { guildId } = req.params;
    const { welcome_message, welcome_channel, prefix, log_channel, ticket_channel } = req.body;

    db.run(`INSERT INTO guild_settings (guild_id, welcome_message, welcome_channel, prefix, log_channel, ticket_channel)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(guild_id) DO UPDATE SET 
            welcome_message = excluded.welcome_message,
            welcome_channel = excluded.welcome_channel,
            prefix = excluded.prefix,
            log_channel = excluded.log_channel,
            ticket_channel = excluded.ticket_channel`,
        [guildId, welcome_message, welcome_channel, prefix, log_channel, ticket_channel],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Settings saved successfully' });
        }
    );
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
