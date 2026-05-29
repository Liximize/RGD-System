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

// Supports either LOG_CHANNEL_ID or your old TRANSCRIPT_CHANNEL_ID name.
function getLogChannelId() {
  return process.env.LOG_CHANNEL_ID || process.env.TRANSCRIPT_CHANNEL_ID;
}

client.once("clientReady", async () => {
  console.log(`${client.user.tag} is online`);

// General server status.
client.user.setActivity("💗 Watching over RGD", {
  type: ActivityType.Watching
});

  const guild = client.guilds.cache.get(process.env.GUILD_ID);

  if (!guild) {
    console.log("Guild not found. Check GUILD_ID in your environment variables.");
    return;
  }

  await guild.commands.create({
  name: "verify",
  description: "Send the female verification panel"
});

  console.log("Slash command /verify is ready.");
});

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