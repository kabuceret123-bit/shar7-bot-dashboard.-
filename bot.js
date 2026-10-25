require("dotenv").config();
const { Client, GatewayIntentBits, Partials, Events, PermissionsBitField } = require("discord.js");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

if (!process.env.DISCORD_BOT_TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN in .env");
  process.exit(1);
}
const db = new sqlite3.Database(path.join(__dirname, "data", "shar7.sqlite"));
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

const DEFAULTS = {
  welcome: { enabled: false, channelId: "", message: "أهلاً {user} في سيرفر {server} ❤️", imagePath: "", imagePosition: "above" },
  leave: { enabled: false, channelId: "", message: "مع السلامة {user}، نتمنى نشوفك تاني." }
};
function getSettings(guildId) {
  return new Promise(resolve => db.get("SELECT settings_json FROM guild_settings WHERE guild_id = ?", [guildId], (err, row) => {
    if (err || !row) return resolve(structuredClone(DEFAULTS));
    try {
      const parsed = JSON.parse(row.settings_json);
      resolve({
        welcome: { ...DEFAULTS.welcome, ...(parsed.welcome || {}) },
        leave: { ...DEFAULTS.leave, ...(parsed.leave || {}) }
      });
    } catch { resolve(structuredClone(DEFAULTS)); }
  }));
}
function renderMessage(template, member) {
  return String(template || "")
    .replaceAll("{user}", `<@${member.id}>`)
    .replaceAll("{server}", member.guild.name)
    .slice(0, 1900);
}
async function getTextChannel(guild, channelId) {
  if (!channelId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.guild) return null;
  const me = guild.members.me;
  if (!me) return null;
  const perms = channel.permissionsFor(me);
  if (!perms?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) return null;
  return channel;
}
async function sendWelcome(member) {
  const settings = await getSettings(member.guild.id);
  const cfg = settings.welcome;
  if (!cfg.enabled || !cfg.channelId) return;
  const channel = await getTextChannel(member.guild, cfg.channelId);
  if (!channel) return;
  const text = renderMessage(cfg.message, member);
  let imagePath = "";
  if (cfg.imagePath && cfg.imagePath.startsWith("/uploads/")) {
    imagePath = path.join(__dirname, cfg.imagePath.replace(/^\//, ""));
    if (!imagePath.startsWith(path.join(__dirname, "uploads") + path.sep) || !fs.existsSync(imagePath)) imagePath = "";
  }
  try {
    if (imagePath && cfg.imagePosition === "above") {
      await channel.send({ files: [{ attachment: imagePath, name: path.basename(imagePath) }] });
      await channel.send({ content: text });
    } else if (imagePath) {
      await channel.send({ content: text });
      await channel.send({ files: [{ attachment: imagePath, name: path.basename(imagePath) }] });
    } else {
      await channel.send({ content: text });
    }
  } catch (err) { console.error(`Welcome message failed in ${member.guild.id}:`, err.message); }
}
async function sendLeave(member) {
  const settings = await getSettings(member.guild.id);
  const cfg = settings.leave;
  if (!cfg.enabled || !cfg.channelId) return;
  const channel = await getTextChannel(member.guild, cfg.channelId);
  if (!channel) return;
  try { await channel.send({ content: renderMessage(cfg.message, member) }); }
  catch (err) { console.error(`Leave message failed in ${member.guild.id}:`, err.message); }
}
client.once(Events.ClientReady, c => console.log(`SHAR7 bot online as ${c.user.tag}`));
client.on(Events.GuildMemberAdd, member => { sendWelcome(member).catch(console.error); });
client.on(Events.GuildMemberRemove, member => { sendLeave(member).catch(console.error); });
client.login(process.env.DISCORD_BOT_TOKEN);
