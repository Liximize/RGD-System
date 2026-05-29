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
  ActivityType
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const EMBED_COLOR = 0xeb91ee;
const CHECK_INTERVAL_MS = 60 * 1000;

let twitchAccessToken = null;
let currentLiveStreamId = null;

// --------------------
// Shared helpers
// --------------------

function getLogChannelId() {
  return process.env.LOG_CHANNEL_ID || process.env.TRANSCRIPT_CHANNEL_ID;
}

function getTwitchUrl() {
  return `https://twitch.tv/${process.env.TWITCH_STREAMER_NAME}`;
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
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET || !process.env.TWITCH_STREAMER_NAME) {
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
  const displayName = stream?.user_name || streamerName;
  const streamUrl = getTwitchUrl();

  const embed = new EmbedBuilder()
    .setTitle(isTest ? "💗 Test Live Alert" : `💗 ${displayName} is Live!`)
    .setDescription(
      isTest
        ? `This is how the live alert will look when **${displayName}** goes live.\n\n` +
          `**Title:** Test stream title\n` +
          `**Category:** Just Chatting\n\n` +
          `Come watch the stream!`
        : `**Title:** ${stream.title || "No title"}\n` +
          `**Category:** ${stream.game_name || "Unknown"}\n\n` +
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
  const channel = await client.channels.fetch(process.env.LIVE_CHANNEL_ID).catch(() => null);

  if (!channel) {
    console.log("Live alert channel not found. Check LIVE_CHANNEL_ID.");
    return;
  }

  const { embed, row, displayName } = buildLiveAlert(stream, false);

  await channel.send({
    content: `@everyone 💗 **${displayName} is live!**`,
    embeds: [embed],
    components: [row],
    allowedMentions: {
      parse: ["everyone"]
    }
  });
}

async function sendTestAlert(interaction) {
  const channel = await client.channels.fetch(process.env.LIVE_CHANNEL_ID).catch(() => null);

  if (!channel) {
    return interaction.editReply({
      content: "I could not find the live alert channel. Check LIVE_CHANNEL_ID."
    });
  }

  const fakeStream = {
    user_name: process.env.TWITCH_STREAMER_NAME || "streamer",
    title: "Test stream title",
    game_name: "Just Chatting"
  };

  const { embed, row, displayName } = buildLiveAlert(fakeStream, true);

  await channel.send({
    content: `@everyone 💗 **${displayName} is live!**`,
    embeds: [embed],
    components: [row],
    allowedMentions: {
      parse: ["everyone"]
    }
  });

  return interaction.editReply({
    content: `Test alert sent to ${channel}.`
  });
}

async function checkStreamer() {
  try {
    if (!process.env.LIVE_CHANNEL_ID) {
      console.log("LIVE_CHANNEL_ID is not set. Skipping Twitch live check.");
      return;
    }

    const stream = await getStreamerLiveData();

    if (!stream) {
      if (currentLiveStreamId !== null) {
        console.log(`${process.env.TWITCH_STREAMER_NAME} went offline. Resetting alert.`);
      }

      currentLiveStreamId = null;
      return;
    }

    if (currentLiveStreamId === stream.id) {
      console.log(`${stream.user_name} is still live. No new alert.`);
      return;
    }

    currentLiveStreamId = stream.id;

    console.log(`${stream.user_name} is live. Sending alert.`);
    await sendLiveAlert(stream);
  } catch (error) {
    console.error("Live check error:", error.message);
  }
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

  await guild.commands.create({
    name: "verify",
    description: "Send the female verification panel"
  });

  await guild.commands.create({
    name: "livecheck",
    description: "Check if the Twitch streamer is live"
  });

  await guild.commands.create({
    name: "testalert",
    description: "Send a test Twitch live alert"
  });

  console.log("Slash commands /verify, /livecheck, and /testalert are ready.");

  await checkStreamer();

  setInterval(checkStreamer, CHECK_INTERVAL_MS);
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
      await interaction.deferReply({ ephemeral: true });

      try {
        const stream = await getStreamerLiveData();

        if (!stream) {
          return interaction.editReply({
            content: `${process.env.TWITCH_STREAMER_NAME} is not live right now.`
          });
        }

        return interaction.editReply({
          content:
            `${stream.user_name} is live right now: ${getTwitchUrl()}\n` +
            `Title: ${stream.title || "No title"}`
        });
      } catch (error) {
        return interaction.editReply({
          content: `Error checking Twitch: ${error.message}`
        });
      }
    }

    if (interaction.commandName === "testalert") {
      await interaction.deferReply({ ephemeral: true });
      return sendTestAlert(interaction);
    }
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === "open_ticket") {
    await interaction.deferReply({ ephemeral: true });

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
        ephemeral: true
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
      ephemeral: true
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
        ephemeral: true
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

client.login(process.env.TOKEN);