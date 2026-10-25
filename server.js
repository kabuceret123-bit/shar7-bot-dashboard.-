require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const sqlite3 = require("sqlite3").verbose();
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const required = ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_CALLBACK_URL", "SESSION_SECRET"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be at least 32 characters.");
  process.exit(1);
}

const db = new sqlite3.Database(path.join(DATA_DIR, "shar7.sqlite"));
db.serialize(() => {
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run(`CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    settings_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
});

const DEFAULTS = {
  welcome: {
    enabled: false, channelId: "", message: "أهلاً {user} في سيرفر {server} ❤️",
    imagePath: "", imagePosition: "above"
  },
  leave: {
    enabled: false, channelId: "", message: "مع السلامة {user}، نتمنى نشوفك تاني."
  }
};

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
}
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function (err) {
    err ? reject(err) : resolve({ changes: this.changes, lastID: this.lastID });
  }));
}
function safeSettings(input) {
  const out = structuredClone(DEFAULTS);
  if (input && typeof input === "object") {
    for (const moduleName of ["welcome", "leave"]) {
      const src = input[moduleName];
      if (!src || typeof src !== "object") continue;
      out[moduleName].enabled = src.enabled === true;
      out[moduleName].channelId = typeof src.channelId === "string" && /^\d{17,20}$/.test(src.channelId) ? src.channelId : "";
      out[moduleName].message = typeof src.message === "string" ? src.message.slice(0, 1800) : out[moduleName].message;
      if (moduleName === "welcome") {
        out.welcome.imagePosition = src.imagePosition === "below" ? "below" : "above";
        // Uploaded paths can only be set by the upload route, not by arbitrary API input.
        out.welcome.imagePath = typeof src.imagePath === "string" && src.imagePath.startsWith("/uploads/") ? src.imagePath : "";
      }
    }
  }
  return out;
}
async function getSettings(guildId) {
  const row = await dbGet("SELECT settings_json FROM guild_settings WHERE guild_id = ?", [guildId]);
  if (!row) return structuredClone(DEFAULTS);
  try { return safeSettings(JSON.parse(row.settings_json)); }
  catch { return structuredClone(DEFAULTS); }
}
async function putSettings(guildId, settings) {
  const clean = safeSettings(settings);
  await dbRun(
    `INSERT INTO guild_settings(guild_id, settings_json, updated_at) VALUES(?, ?, datetime('now'))
     ON CONFLICT(guild_id) DO UPDATE SET settings_json=excluded.settings_json, updated_at=datetime('now')`,
    [guildId, JSON.stringify(clean)]
  );
  return clean;
}

app.disable("x-powered-by");
app.set("trust proxy", 1); // Required behind a trusted HTTPS reverse proxy.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR, concurrentDB: true }),
  name: "shar7.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12
  }
}));
app.use(passport.initialize());
app.use(passport.session());
app.use("/api", rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false }));
app.use(express.static(ROOT, { index: false, dotfiles: "ignore" }));
app.use("/uploads", express.static(UPLOAD_DIR, { dotfiles: "deny", index: false, maxAge: "1d" }));

passport.use(new DiscordStrategy({
  clientID: process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL: process.env.DISCORD_CALLBACK_URL,
  scope: ["identify", "guilds"]
}, (accessToken, refreshToken, profile, done) => {
  profile.accessToken = accessToken;
  done(null, profile);
}));
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

const ADMIN_IDS = new Set((process.env.ADMIN_USER_IDS || "").split(",").map(s => s.trim()).filter(Boolean));
function isAdmin(user) {
  return !ADMIN_IDS.size || ADMIN_IDS.has(user.id);
}
function requireAuth(req, res, next) {
  if (!req.isAuthenticated?.() || !req.user) return res.status(401).json({ error: "سجّل الدخول أولاً." });
  if (!isAdmin(req.user)) return res.status(403).json({ error: "ليس لديك صلاحية دخول لوحة التحكم." });
  next();
}
function validGuildId(id) { return typeof id === "string" && /^\d{17,20}$/.test(id); }

app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/auth/discord", passport.authenticate("discord"));
app.get("/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/?login=failed" }),
  (req, res) => res.redirect("/")
);
app.post("/auth/logout", (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => res.clearCookie("shar7.sid", { sameSite: "lax", httpOnly: true }).json({ ok: true }));
  });
});

app.get("/api/me", (req, res) => {
  if (!req.isAuthenticated?.() || !req.user || !isAdmin(req.user)) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    user: { id: req.user.id, username: req.user.username, global_name: req.user.global_name, avatar: req.user.avatar },
    csrfToken: req.session.csrfToken || (req.session.csrfToken = crypto.randomBytes(24).toString("hex"))
  });
});
function csrf(req, res, next) {
  const sent = req.get("x-csrf-token");
  const expected = req.session.csrfToken || "";
  const actualBuffer = Buffer.from(sent || "");
  const expectedBuffer = Buffer.from(expected);
  if (!expected || !sent || actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return res.status(403).json({ error: "طلب غير صالح. حدّث الصفحة وحاول مجدداً." });
  }
  next();
}

app.get("/api/guilds", requireAuth, async (req, res, next) => {
  try {
    const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${req.user.accessToken}` }
    });
    if (!response.ok) return res.status(502).json({ error: "تعذر تحميل سيرفرات Discord." });
    const guilds = await response.json();
    const botToken = process.env.DISCORD_BOT_TOKEN;
    let botGuildIds = null;
    if (botToken) {
      const botResponse = await fetch("https://discord.com/api/v10/users/@me/guilds", {
        headers: { Authorization: `Bot ${botToken}` }
      });
      if (botResponse.ok) botGuildIds = new Set((await botResponse.json()).map(g => g.id));
    }
    const manageable = guilds.filter(g => (BigInt(g.permissions || "0") & 0x20n) === 0x20n || (BigInt(g.permissions || "0") & 0x8n) === 0x8n);
    res.json(manageable.map(g => ({
      id: g.id, name: g.name, icon: g.icon,
      botPresent: botGuildIds ? botGuildIds.has(g.id) : null
    })));
  } catch (err) { next(err); }
});

app.get("/api/guilds/:guildId/channels", requireAuth, async (req, res, next) => {
  try {
    const guildId = req.params.guildId;
    if (!validGuildId(guildId)) return res.status(400).json({ error: "معرّف السيرفر غير صالح." });
    const guilds = await fetchUserGuilds(req.user);
    if (!guilds.some(g => g.id === guildId && canManage(g))) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر." });
    if (!process.env.DISCORD_BOT_TOKEN) return res.status(503).json({ error: "لم يتم ضبط توكن البوت." });
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
    });
    if (!response.ok) return res.status(502).json({ error: "تعذر تحميل قنوات السيرفر. تأكد أن البوت موجود فيه." });
    const channels = await response.json();
    res.json({ channels: channels.filter(c => [0, 5].includes(c.type) && c.name)
      .map(c => ({ id: c.id, name: c.name, type: c.type })) });
  } catch (err) { next(err); }
});
app.get("/api/guilds/:guildId/settings", requireAuth, async (req, res, next) => {
  try {
    if (!validGuildId(req.params.guildId)) return res.status(400).json({ error: "معرّف السيرفر غير صالح." });
    const guilds = await fetchUserGuilds(req.user);
    if (!guilds.some(g => g.id === req.params.guildId && canManage(g))) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر." });
    res.json({ settings: await getSettings(req.params.guildId) });
  } catch (err) { next(err); }
});
app.put("/api/guilds/:guildId/settings", requireAuth, csrf, async (req, res, next) => {
  try {
    if (!validGuildId(req.params.guildId)) return res.status(400).json({ error: "معرّف السيرفر غير صالح." });
    const guilds = await fetchUserGuilds(req.user);
    if (!guilds.some(g => g.id === req.params.guildId && canManage(g))) return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر." });
    const existing = await getSettings(req.params.guildId);
    const incoming = req.body?.settings;
    if (!incoming || typeof incoming !== "object") return res.status(400).json({ error: "الإعدادات غير صالحة." });
    // Never accept a client-supplied image path; preserve the server-side uploaded path.
    if (incoming.welcome) incoming.welcome.imagePath = existing.welcome.imagePath;
    res.json({ ok: true, settings: await putSettings(req.params.guildId, incoming) });
  } catch (err) { next(err); }
});

async function fetchUserGuilds(user) {
  const response = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: { Authorization: `Bearer ${user.accessToken}` }
  });
  if (!response.ok) throw new Error("Discord guild lookup failed");
  return response.json();
}
function canManage(guild) {
  const p = BigInt(guild.permissions || "0");
  return (p & 0x20n) === 0x20n || (p & 0x8n) === 0x8n;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
    cb(allowed.has(file.mimetype) ? null : new Error("يسمح فقط بصور PNG وJPG وWEBP وGIF."), allowed.has(file.mimetype));
  }
});
app.post("/api/guilds/:guildId/welcome-image", requireAuth, csrf, upload.single("image"), async (req, res, next) => {
  try {
    const guildId = req.params.guildId;
    if (!validGuildId(guildId)) return res.status(400).json({ error: "معرّف السيرفر غير صالح." });
    const guilds = await fetchUserGuilds(req.user);
    if (!guilds.some(g => g.id === guildId && canManage(g))) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(403).json({ error: "لا تملك صلاحية إدارة هذا السيرفر." });
    }
    if (!req.file) return res.status(400).json({ error: "اختر صورة أولاً." });
    const settings = await getSettings(guildId);
    if (settings.welcome.imagePath) {
      const oldPath = path.join(ROOT, settings.welcome.imagePath.replace(/^\//, ""));
      if (oldPath.startsWith(UPLOAD_DIR) && fs.existsSync(oldPath)) fs.unlink(oldPath, () => {});
    }
    settings.welcome.imagePath = `/uploads/${req.file.filename}`;
    await putSettings(guildId, settings);
    res.json({ ok: true, imagePath: settings.welcome.imagePath });
  } catch (err) { next(err); }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "حجم الصورة الأقصى 5 ميجابايت." : "تعذر رفع الملف." });
  res.status(500).json({ error: err.message?.startsWith("يسمح فقط") ? err.message : "حدث خطأ داخلي. راجع سجل الخادم." });
});

const server = app.listen(PORT, () => console.log(`SHAR7 dashboard listening on port ${PORT}`));
async function shutdown() {
  server.close(() => db.close(() => process.exit(0)));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
