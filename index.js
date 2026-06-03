require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  ActivityType,
  MessageFlags
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const EMBED_COLOR = 0xeb91ee;

const TWITCH_CHECK_INTERVAL_MS = 60 * 1000;

const TIKTOK_CHECK_INTERVAL_MS = Math.max(
  30,
  Number(process.env.TIKTOK_CHECK_INTERVAL_SECONDS || 60)
) * 1000;

let twitchAccessToken = null;
let currentLiveStreamId = null;

let TikTokLiveConnection = null;
let WebcastEvent = null;

const tiktokStates = new Map();

// --------------------
// Shared helpers
// --------------------

function getLogChannelId() {
  return process.env.LOG_CHANNEL_ID || process.env.TRANSCRIPT_CHANNEL_ID;
}

function getTwitchUrl() {
  return `https://twitch.tv/${process.env.TWITCH_STREAMER_NAME}`;
}

function getTikTokLiveChannelId() {
  return process.env.TIKTOK_LIVE_CHANNEL_ID || process.env.TWITCH_LIVE_CHANNEL_ID;
}

// --------------------
// Twitch live alert system
// --------------------

async function getTwitchAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials"
  });

  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?${params.toString()}`,
    { method: "POST" }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twitch token error: ${errorText}`);
  }

  const data = await response.json();
  twitchAccessToken = data.access_token;
}

async function getStreamerLiveData() {
  if (
    !process.env.TWITCH_CLIENT_ID ||
    !process.env.TWITCH_CLIENT_SECRET ||
    !process.env.TWITCH_STREAMER_NAME
  ) {
    return null;
  }

  if (!twitchAccessToken) {
    await getTwitchAccessToken();
  }

  const streamerName = process.env.TWITCH_STREAMER_NAME;

  const response = await fetch(
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(streamerName)}`,
    {
      headers: {
        "Client-ID": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${twitchAccessToken}`
      }
    }
  );

  if (response.status === 401) {
    twitchAccessToken = null;
    await getTwitchAccessToken();
    return getStreamerLiveData();
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twitch check error: ${errorText}`);
  }

  const data = await response.json();
  return data.data?.[0] || null;
}

function buildLiveAlert(stream, isTest = false) {
  const streamerName = process.env.TWITCH_STREAMER_NAME;
  const displayName = stream?.user_name || streamerName || "streamer";
  const streamUrl = getTwitchUrl();

  const embed = new EmbedBuilder()
    .setTitle(isTest ? "💗 Test Twitch Alert" : "💗 Twitch Live Alert")
    .setDescription(
      isTest
        ? `This is how the live alert will look when **${displayName}** goes live.\n\n` +
          `**Title:** Test stream title\n` +
          `**Category:** Just Chatting\n` +
          `**Platform:** Twitch\n` +
          `**Status:** Test Alert\n\n` +
          `Come watch the stream!`
        : `**${displayName}** is live right now on Twitch.\n\n` +
          `**Title:** ${stream.title || "No title"}\n` +
          `**Category:** ${stream.game_name || "Unknown"}\n` +
          `**Platform:** Twitch\n` +
          `**Status:** Live Now\n\n` +
          `Come watch the stream!`
    )
    .setColor(EMBED_COLOR)
    .setURL(streamUrl)
    .setFooter({ text: "RGD Live Alerts" })
    .setTimestamp();

  if (!isTest && stream.thumbnail_url) {
    const thumbnailUrl =
      stream.thumbnail_url
        .replace("{width}", "1280")
        .replace("{height}", "720") + `?t=${Date.now()}`;

    embed.setImage(thumbnailUrl);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("▶ Watch Stream")
      .setStyle(ButtonStyle.Link)
      .setURL(streamUrl)
  );

  return { embed, row, displayName };
}

async function sendLiveAlert(stream) {
  const channel = await client.channels
    .fetch(process.env.TWITCH_LIVE_CHANNEL_ID)
    .catch(() => null);

  if (!channel) {
    console.log("Twitch live alert channel not found. Check TWITCH_LIVE_CHANNEL_ID.");
    return;
  }

  const { embed, row, displayName } = buildLiveAlert(stream, false);

  await channel.send({
    content: `@everyone 💗 **${displayName} is live on Twitch!**`,
    embeds: [embed],
    components: [row],
    allowedMentions: {
      parse: ["everyone"]
    }
  });
}

async function sendTestAlert(interaction) {
  const channel = await client.channels
    .fetch(process.env.TWITCH_LIVE_CHANNEL_ID)
    .catch(() => null);

  if (!channel) {
    return interaction.editReply({
      content: "I could not find the Twitch live alert channel. Check TWITCH_LIVE_CHANNEL_ID."
    });
  }

  const fakeStream = {
    user_name: process.env.TWITCH_STREAMER_NAME || "streamer",
    title: "Test stream title",
    game_name: "Just Chatting"
  };

  const { embed, row, displayName } = buildLiveAlert(fakeStream, true);

  await channel.send({
    content: `@everyone 💗 **${displayName} is live on Twitch!**`,
    embeds: [embed],
    components: [row],
    allowedMentions: {
      parse: ["everyone"]
    }
  });

  return interaction.editReply({
    content: `Twitch test alert sent to ${channel}.`
  });
}

async function checkStreamer() {
  try {
    if (!process.env.TWITCH_LIVE_CHANNEL_ID) {
      console.log("TWITCH_LIVE_CHANNEL_ID is not set. Skipping Twitch live check.");
      return;
    }

    const stream = await getStreamerLiveData();

    if (!stream) {
      if (currentLiveStreamId !== null) {
        console.log(`${process.env.TWITCH_STREAMER_NAME} went offline. Resetting Twitch alert.`);
      }

      currentLiveStreamId = null;
      return;
    }

    if (currentLiveStreamId === stream.id) {
      console.log(`${stream.user_name} is still live on Twitch. No new alert.`);
      return;
    }

    currentLiveStreamId = stream.id;

    console.log(`${stream.user_name} is live on Twitch. Sending alert.`);
    await sendLiveAlert(stream);
  } catch (error) {
    console.error("Twitch live check error:", error.message);
  }
}

// --------------------
// TikTok live alert system
// --------------------

function normalizeTikTokUsername(input) {
  if (!input) return "";

  let username = input.trim();

  const urlMatch = username.match(/tiktok\.com\/@([^/?#]+)/i);
  if (urlMatch) {
    username = urlMatch[1];
  }

  username = username.replace(/^@/, "");
  username = username.split("?")[0];
  username = username.split("/")[0];

  return username.trim();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getTikTokUsers() {
  return (process.env.TIKTOK_USERS || "")
    .split(",")
    .map(username => normalizeTikTokUsername(username))
    .filter(Boolean);
}

function getTikTokLiveUrl(username) {
  return `https://www.tiktok.com/@${username}/live`;
}

function ensureTikTokStates() {
  for (const username of getTikTokUsers()) {
    if (!tiktokStates.has(username)) {
      tiktokStates.set(username, {
        username,
        status: "unknown",
        isLive: false,
        notified: false,
        checking: false,
        connection: null,
        roomId: null,
        lastCheckedAt: null,
        lastReason: "Not checked yet",
        lastError: null
      });
    }
  }
}

async function loadTikTokConnector() {
  const tiktokModule = await import("tiktok-live-connector");

  TikTokLiveConnection = tiktokModule.TikTokLiveConnection;
  WebcastEvent = tiktokModule.WebcastEvent;

  if (!TikTokLiveConnection) {
    throw new Error("TikTokLiveConnection could not be loaded.");
  }

  console.log("TikTok connector loaded.");
}

function createTikTokConnection(username) {
  return new TikTokLiveConnection(username, {
    processInitialData: false,
    fetchRoomInfoOnConnect: false
  });
}

async function runWithTimeout(promise, ms, timeoutMessage) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function isProbablyOfflineError(message) {
  const lower = String(message || "").toLowerCase();

  return (
    lower.includes("user_not_live") ||
    lower.includes("not live") ||
    lower.includes("offline") ||
    lower.includes("room does not exist") ||
    lower.includes("live has ended")
  );
}

async function fetchTikTokLiveStatus(username) {
  const reasons = [];

  if (!TikTokLiveConnection) {
    return {
      isLive: false,
      method: "disabled",
      reason: "TikTok connector is not loaded."
    };
  }

  try {
    const connection = createTikTokConnection(username);

    const isLive = await runWithTimeout(
      connection.fetchIsLive(),
      20000,
      "fetchIsLive timed out."
    );

    return {
      isLive: Boolean(isLive),
      method: "fetchIsLive",
      reason: `fetchIsLive returned ${Boolean(isLive)}.`
    };
  } catch (error) {
    const message = error?.message || "fetchIsLive failed.";
    reasons.push(`fetchIsLive failed: ${message}`);
  }

  let testConnection = null;

  try {
    testConnection = createTikTokConnection(username);

    const liveState = await runWithTimeout(
      testConnection.connect(),
      25000,
      "connect fallback timed out."
    );

    const roomId = liveState?.roomId || null;

    await testConnection.disconnect().catch(() => {});

    return {
      isLive: true,
      method: "connectFallback",
      roomId,
      reason: roomId
        ? `connect fallback succeeded. Room ID: ${roomId}`
        : "connect fallback succeeded."
    };
  } catch (error) {
    if (testConnection) {
      await testConnection.disconnect().catch(() => {});
    }

    const message = error?.message || "connect fallback failed.";
    reasons.push(`connect fallback failed: ${message}`);

    if (isProbablyOfflineError(message)) {
      return {
        isLive: false,
        method: "connectFallback",
        reason: "connect fallback suggests the account is offline."
      };
    }
  }

  return {
    isLive: false,
    method: "unknown",
    reason: reasons.join(" | ") || "Could not detect live status."
  };
}

function buildTikTokLiveAlert(username, isTest = false) {
  const displayName = username.toUpperCase();
  const liveUrl = getTikTokLiveUrl(username);

  const embed = new EmbedBuilder()
    .setTitle(isTest ? "💗 Test TikTok Alert" : "💗 TikTok Live Alert")
    .setDescription(
      isTest
        ? `This is how the live alert will look when **${displayName}** goes live.\n\n` +
          `**Title:** TikTok live stream\n` +
          `**Platform:** TikTok\n` +
          `**Status:** Test Alert\n\n` +
          `Come watch the stream!`
        : `**${displayName}** is live right now on TikTok.\n\n` +
          `**Title:** TikTok live stream\n` +
          `**Platform:** TikTok\n` +
          `**Status:** Live Now\n\n` +
          `Come watch the stream!`
    )
    .setColor(EMBED_COLOR)
    .setURL(liveUrl)
    .setFooter({ text: "RGD Live Alerts" })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("▶ Watch Stream")
      .setStyle(ButtonStyle.Link)
      .setURL(liveUrl)
  );

  return { embed, row, displayName };
}

async function sendTikTokLiveAlert(username, isTest = false) {
  const channelId = getTikTokLiveChannelId();

  if (!channelId) {
    console.log("TikTok live alert channel not found. Set TIKTOK_LIVE_CHANNEL_ID or TWITCH_LIVE_CHANNEL_ID.");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    console.log("TikTok live alert channel could not be fetched.");
    return;
  }

  const { embed, row, displayName } = buildTikTokLiveAlert(username, isTest);

  await channel.send({
    content: `@everyone 💗 **${displayName} is live on TikTok!**`,
    embeds: [embed],
    components: [row],
    allowedMentions: {
      parse: ["everyone"]
    }
  });

  console.log(
    isTest
      ? `Sent TikTok test alert for @${username}`
      : `Sent TikTok live alert for @${username}`
  );
}

function listenSafely(connection, eventName, callback) {
  if (!eventName) return;

  try {
    connection.on(eventName, callback);
  } catch (error) {
    console.log(`Could not attach listener for ${eventName}: ${error.message}`);
  }
}

async function connectToTikTokLiveRoom(username) {
  const state = tiktokStates.get(username);
  if (!state) return;

  if (!TikTokLiveConnection) return;
  if (state.connection) return;

  const connection = createTikTokConnection(username);
  state.connection = connection;

  listenSafely(connection, "connected", liveState => {
    state.roomId = liveState?.roomId || null;
    console.log(`Connected to @${username}'s TikTok LIVE room. Room ID: ${state.roomId || "Unknown"}`);
  });

  listenSafely(connection, "disconnected", event => {
    console.log(`Disconnected from @${username}'s TikTok LIVE room.`);

    if (event?.reason) {
      console.log(`Disconnect reason: ${event.reason}`);
    }
  });

  listenSafely(connection, "error", error => {
    const message =
      error?.exception?.message ||
      error?.message ||
      "Unknown TikTok connection error";

    state.lastError = message;
    console.error(`TikTok connection error for @${username}:`, message);
  });

  listenSafely(connection, "streamEnd", async () => {
    console.log(`@${username}'s TikTok LIVE ended.`);
    await markTikTokStreamerOffline(username, "streamEnd");
  });

  if (WebcastEvent?.STREAM_END) {
    listenSafely(connection, WebcastEvent.STREAM_END, async () => {
      console.log(`@${username}'s TikTok LIVE ended.`);
      await markTikTokStreamerOffline(username, "STREAM_END");
    });
  }

  try {
    const liveState = await runWithTimeout(
      connection.connect(),
      25000,
      "Live room monitor connect timed out."
    );

    state.roomId = liveState?.roomId || null;

    console.log(`Live room monitor connected for @${username}.`);
  } catch (error) {
    state.connection = null;
    state.roomId = null;

    const message = error?.message || "Could not connect to TikTok LIVE room.";
    state.lastError = message;

    console.error(`Could not monitor @${username}'s live room:`, message);
  }
}

async function disconnectTikTokLiveRoom(username) {
  const state = tiktokStates.get(username);
  if (!state || !state.connection) return;

  const oldConnection = state.connection;

  state.connection = null;
  state.roomId = null;

  try {
    await oldConnection.disconnect();
  } catch (error) {
    console.error(`Disconnect error for @${username}:`, error.message);
  }
}

async function markTikTokStreamerOffline(username, reason = "offline") {
  const state = tiktokStates.get(username);
  if (!state) return;

  state.status = "offline";
  state.isLive = false;
  state.notified = false;
  state.roomId = null;
  state.lastReason = reason;

  await disconnectTikTokLiveRoom(username);

  console.log(`Marked @${username} offline. Reason: ${reason}`);
}

async function checkTikTokStreamer(username) {
  ensureTikTokStates();

  const state = tiktokStates.get(username);
  if (!state || state.checking) return;

  state.checking = true;
  state.lastCheckedAt = new Date();

  try {
    const result = await fetchTikTokLiveStatus(username);

    state.lastError = null;
    state.lastReason = result.reason;

    if (result.isLive) {
      state.status = "live";
      state.isLive = true;

      if (result.roomId) {
        state.roomId = result.roomId;
      }

      console.log(`[TikTok Check] @${username} => LIVE | ${result.method} | ${result.reason}`);

      if (!state.notified) {
        await sendTikTokLiveAlert(username, false);
        state.notified = true;
      }

      await connectToTikTokLiveRoom(username);
      return;
    }

    console.log(`[TikTok Check] @${username} => offline | ${result.method} | ${result.reason}`);

    if (state.isLive || state.notified) {
      await markTikTokStreamerOffline(username, result.reason);
    } else {
      state.status = "offline";
      state.isLive = false;
      state.notified = false;
    }
  } catch (error) {
    const message = error?.message || "Unknown TikTok check error";

    state.status = "unknown";
    state.lastError = message;
    state.lastReason = "TikTok check failed.";

    console.error(`[TikTok Error] @${username}:`, message);
  } finally {
    state.checking = false;
  }
}

async function checkAllTikTokStreamers() {
  ensureTikTokStates();

  const users = getTikTokUsers();

  if (!users.length) {
    console.log("No TikTok users configured. Add TIKTOK_USERS in .env.");
    return;
  }

  for (const username of users) {
    await checkTikTokStreamer(username);
    await sleep(2000);
  }
}

function buildTikTokStatusEmbed() {
  ensureTikTokStates();

  const lines = [];

  for (const username of getTikTokUsers()) {
    const state = tiktokStates.get(username);
    if (!state) continue;

    const checked = state.lastCheckedAt
      ? `<t:${Math.floor(state.lastCheckedAt.getTime() / 1000)}:R>`
      : "Never";

    const errorText = state.lastError
      ? `\nError: ${state.lastError}`
      : "";

    lines.push(
      `**@${username}**\n` +
      `Status: ${state.status}\n` +
      `Notified: ${state.notified ? "Yes" : "No"}\n` +
      `Room ID: ${state.roomId || "None"}\n` +
      `Last checked: ${checked}\n` +
      `Reason: ${state.lastReason}${errorText}`
    );
  }

  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle("TikTok Watcher Status")
    .setDescription(lines.length ? lines.join("\n\n") : "No TikTok users configured.")
    .setFooter({ text: "RGD Live Alerts" })
    .setTimestamp();
}

async function sendTikTokTestAlert(interaction) {
  const username = getTikTokUsers()[0] || "test_creator";

  await sendTikTokLiveAlert(username, true);

  return interaction.editReply({
    content: `TikTok test alert sent for @${username}.`
  });
}

// --------------------
// Discord startup
// --------------------

client.once("clientReady", async () => {
  console.log(`${client.user.tag} is online`);

  client.user.setActivity("over RGD 💗", {
    type: ActivityType.Watching
  });

  const guild = client.guilds.cache.get(process.env.GUILD_ID);

  if (!guild) {
    console.log("Guild not found. Check GUILD_ID.");
    return;
  }

  try {
    await loadTikTokConnector();
  } catch (error) {
    console.error("TikTok connector startup error:", error.message);
  }

  await guild.commands.set([
    {
      name: "verify",
      description: "Send the female verification panel"
    },
    {
      name: "livecheck",
      description: "Check if the Twitch streamer is live"
    },
    {
      name: "testalert",
      description: "Send a test Twitch live alert"
    },
    {
      name: "tiktokcheck",
      description: "Check if the TikTok streamer is live"
    },
    {
      name: "tiktoktest",
      description: "Send a test TikTok live alert"
    },
    {
      name: "tiktokstatus",
      description: "Show TikTok watcher status"
    }
  ]);

  console.log("Slash commands are ready.");

  await checkStreamer();
  setInterval(checkStreamer, TWITCH_CHECK_INTERVAL_MS);

  if (TikTokLiveConnection) {
    ensureTikTokStates();

    await checkAllTikTokStreamers();

    setInterval(() => {
      checkAllTikTokStreamers().catch(error => {
        console.error("TikTok watcher loop error:", error.message);
      });
    }, TIKTOK_CHECK_INTERVAL_MS);
  }
});

// --------------------
// Interactions
// --------------------

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "verify") {
      const embed = new EmbedBuilder()
        .setTitle("🎀 Female Verification")
        .setDescription(
          "Click the button below to get verified.\n\nThis helps keep the private girls-only space safe and comfortable."
        )
        .setColor(EMBED_COLOR)
        .setFooter({ text: "RGD Verification System" })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("open_ticket")
          .setLabel("💗 Get Verified")
          .setStyle(ButtonStyle.Secondary)
      );

      return interaction.reply({
        embeds: [embed],
        components: [row]
      });
    }

    if (interaction.commandName === "livecheck") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      try {
        const stream = await getStreamerLiveData();

        if (!stream) {
          return interaction.editReply({
            content: `${process.env.TWITCH_STREAMER_NAME} is not live right now.`
          });
        }

        return interaction.editReply({
          content:
            `${stream.user_name} is live right now on Twitch: ${getTwitchUrl()}\n` +
            `Title: ${stream.title || "No title"}`
        });
      } catch (error) {
        return interaction.editReply({
          content: `Error checking Twitch: ${error.message}`
        });
      }
    }

    if (interaction.commandName === "testalert") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return sendTestAlert(interaction);
    }

    if (interaction.commandName === "tiktokcheck") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      await checkAllTikTokStreamers();

      return interaction.editReply({
        content: "TikTok check completed.",
        embeds: [buildTikTokStatusEmbed()]
      });
    }

    if (interaction.commandName === "tiktoktest") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return sendTikTokTestAlert(interaction);
    }

    if (interaction.commandName === "tiktokstatus") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      return interaction.editReply({
        embeds: [buildTikTokStatusEmbed()]
      });
    }
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === "open_ticket") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const existing = interaction.guild.channels.cache.find(channel => {
      return (
        channel.topic === `verification-user:${interaction.user.id}` &&
        channel.parentId === process.env.TICKET_CATEGORY_ID
      );
    });

    if (existing) {
      return interaction.editReply({
        content: `You already have an open ticket: ${existing}`
      });
    }

    const ticketChannels = interaction.guild.channels.cache.filter(channel => {
      return (
        channel.parentId === process.env.TICKET_CATEGORY_ID &&
        channel.name.startsWith("ticket-")
      );
    });

    const ticketNumber = ticketChannels.size + 1;
    const ticketName = `ticket-${String(ticketNumber).padStart(4, "0")}`;

    const channel = await interaction.guild.channels.create({
      name: ticketName,
      type: ChannelType.GuildText,
      parent: process.env.TICKET_CATEGORY_ID,
      topic: `verification-user:${interaction.user.id}`,
      permissionOverwrites: [
        {
          id: interaction.guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        },
        {
          id: process.env.PING_ROLE_ID,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }
      ]
    });

    const ticketEmbed = new EmbedBuilder()
      .setTitle("💌 Verification Ticket")
      .setDescription(
        "Thank you for contacting us.\nA verifier will assist you shortly."
      )
      .setColor(EMBED_COLOR)
      .setFooter({ text: `Ticket opened by ${interaction.user.username}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Close Ticket")
        .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
      content: `<@&${process.env.PING_ROLE_ID}> | ${interaction.user}`,
      embeds: [ticketEmbed],
      components: [row]
    });

    const logChannel = interaction.guild.channels.cache.get(getLogChannelId());

    if (logChannel) {
      const openLog = new EmbedBuilder()
        .setTitle("🎀 Verification Log")
        .setDescription(
          `**Event:** Ticket Opened\n**Ticket:** ${channel.name}\n**Member:** ${interaction.user}`
        )
        .setColor(EMBED_COLOR)
        .setTimestamp();

      await logChannel.send({
        embeds: [openLog]
      });
    }

    return interaction.editReply({
      content: `Your ticket was created: ${channel}`
    });
  }

  if (interaction.customId === "close_ticket") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: "Admins only.",
        flags: MessageFlags.Ephemeral
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("confirm_close_ticket")
        .setLabel("Confirm Close")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("cancel_close_ticket")
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
      content: "Are you sure you want to close this ticket?",
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.customId === "cancel_close_ticket") {
    return interaction.update({
      content: "Ticket close cancelled.",
      components: []
    });
  }

  if (interaction.customId === "confirm_close_ticket") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: "Admins only.",
        flags: MessageFlags.Ephemeral
      });
    }

    const logChannel = interaction.guild.channels.cache.get(getLogChannelId());

    if (logChannel) {
      const userId = interaction.channel.topic?.replace(
        "verification-user:",
        ""
      );

      const closeLog = new EmbedBuilder()
        .setTitle("🎀 Verification Log")
        .setDescription(
          `**Event:** Ticket Closed\n**Ticket:** ${interaction.channel.name}\n**Member:** <@${userId}>\n**Closed By:** ${interaction.user}`
        )
        .setColor(EMBED_COLOR)
        .setTimestamp();

      await logChannel.send({
        embeds: [closeLog]
      });
    }

    await interaction.update({
      content: "Closing ticket...",
      components: []
    });

    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 3000);
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

client.login(process.env.TOKEN);