
const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

let botStatus = {
  online: false,
  username: null,
  guilds: 0,
  uptime: 0
};

// حالة البوت للوحة التحكم
app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    ...botStatus
  });
});

// استقبال تحديثات حالة البوت
app.post("/api/bot/status", (req, res) => {
  // حماية المسار بمفتاح سري عند إعداد الاستضافة
  const secret = process.env.DASHBOARD_SECRET;

  if (!secret || req.get("x-dashboard-secret") !== secret) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const { online, username, guilds, uptime } = req.body;

  botStatus = {
    online: Boolean(online),
    username: typeof username === "string" ? username : null,
    guilds: Number.isFinite(guilds) ? guilds : 0,
    uptime: Number.isFinite(uptime) ? uptime : 0
  };

  res.json({ success: true });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SHAR7 Dashboard server listening on port ${PORT}`);
});
