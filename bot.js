
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

const PORT = process.env.PORT || 3000;
const DASHBOARD_URL =
  process.env.DASHBOARD_URL || `http://localhost:${PORT}`;
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET;

const startedAt = Date.now();

async function updateDashboard() {
  if (!client.isReady() || !slwiXG1dvPqJ1mNsJd6UcGlcyaoDfboC) return;

  try {
    const response = await fetch(
      `${DASHBOARD_URL}/api/bot/status`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-dashboard-secret": slwiXG1dvPqJ1mNsJd6UcGlcyaoDfboC
        },
        body: JSON.stringify({
          online: true,
          username: client.user.tag,
          guilds: client.guilds.cache.size,
          uptime: Math.floor((Date.now() - startedAt) / 1000)
        })
      }
    );

    if (!response.ok) {
      console.error("Dashboard update failed:", response.status);
    }
  } catch (error) {
    console.error("Could not reach dashboard:", error.message);
  }
}

client.once("ready", () => {
  console.log(`SHAR7 Bot logged in as ${client.user.tag}`);
  updateDashboard();
  setInterval(updateDashboard, 30000);
});

client.login(process.env.MTU0MDc4MDI0MTIyMjUwMDQ3Mg.G8k_0w.pO6PnB9d0fuO3y4vm5YheoLsV4DbWO2CzSqzRI);
