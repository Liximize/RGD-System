const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ChannelSelectMenuBuilder,
  StringSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags, PermissionsBitField
} = require('discord.js');
const { placeholders, validate, buildMessage, destination } = require('./messages');
const row = (...items) => new ActionRowBuilder().addComponents(...items);
const forms = {
  text: [['content', 'Normal message (placeholders supported)', 2000, true]],
  embed: [['title', 'Title', 256], ['description', 'Description', 4000, true], ['color', 'Hex color (example: #eb91ee)', 7], ['footer', 'Footer', 1000]],
  media: [['image', 'Large image URL / {avatar} / {serverIcon}', 1000], ['thumbnail', 'Thumbnail URL / {avatar} / {serverIcon}', 1000], ['author', 'Author name', 256], ['authorIcon', 'Author icon URL / {avatar} / {serverIcon}', 1000], ['url', 'Title link URL', 1000]]
};
function panel(kind, config, owner, notice = '') {
  const id = action => `rgd:${kind}:${owner}:${action}`;
  const button = (action, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id(action)).setLabel(label).setStyle(style);
  const channel = new ChannelSelectMenuBuilder().setCustomId(id('channel')).setPlaceholder('Choose the delivery channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  if (config.channelId) channel.setDefaultChannels(config.channelId);
  return {
    content: notice || null,
    embeds: [new EmbedBuilder().setColor(config.color).setTitle(`${kind === 'welcome' ? '💗 Welcome' : '👋 Leave'} message setup`)
      .setDescription('Changes save automatically. Choose a channel, edit your message, preview it, then enable it.\nBlank fields in the editor clear that field.')
      .addFields(
        { name: 'Status', value: config.enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Channel', value: config.channelId ? `<#${config.channelId}>` : 'Not selected', inline: true },
        { name: 'Format', value: { text: 'Normal message', embed: 'Embed', both: 'Normal + embed' }[config.mode], inline: true },
        { name: 'Options', value: `Member ping: **${config.ping ? 'on' : 'off'}** • Ignore bots: **${config.ignoreBots ? 'on' : 'off'}** • Timestamp: **${config.timestamp ? 'on' : 'off'}**` },
        { name: 'Placeholders', value: placeholders.split(' ').map(x => '`' + x + '`').join(' ') }
      ).setFooter({ text: 'Preview is private • Send test posts in the selected channel without pinging' })],
    components: [
      row(channel),
      row(new StringSelectMenuBuilder().setCustomId(id('mode')).setPlaceholder('Message format').addOptions(
        ...[['text', 'Normal message'], ['embed', 'Embed only'], ['both', 'Normal message + embed']].map(([value, label]) => ({ value, label, default: config.mode === value }))
      )),
      row(button('text', 'Edit text'), button('embed', 'Edit embed'), button('media', 'Images & author'), button('preview', 'Preview', ButtonStyle.Primary), button('test', 'Send test')),
      row(button('toggle', config.enabled ? 'Disable' : 'Enable', config.enabled ? ButtonStyle.Danger : ButtonStyle.Success), button('ping', `Ping: ${config.ping ? 'ON' : 'OFF'}`), button('ignoreBots', `Ignore bots: ${config.ignoreBots ? 'ON' : 'OFF'}`), button('timestamp', `Time: ${config.timestamp ? 'ON' : 'OFF'}`))
    ], allowedMentions: { parse: [] }
  };
}
function editor(kind, config, owner, action) {
  const modal = new ModalBuilder().setCustomId(`rgd:${kind}:${owner}:save_${action}`).setTitle(`${kind === 'welcome' ? 'Welcome' : 'Leave'} — ${action === 'media' ? 'Images & author' : action}`);
  for (const [key, label, max, paragraph] of forms[action]) {
    const input = new TextInputBuilder().setCustomId(key).setLabel(label).setRequired(key === 'color').setMaxLength(max).setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short);
    if (config[key]) input.setValue(config[key]);
    modal.addComponents(row(input));
  }
  return modal;
}
async function handle(interaction, store) {
  let kind, action, owner;
  if (interaction.isChatInputCommand()) {
    if (!['welcome', 'leave'].includes(interaction.commandName)) return;
    kind = interaction.commandName;
  } else {
    if (!interaction.customId?.startsWith('rgd:')) return;
    [, kind, owner, action] = interaction.customId.split(':');
    if (!['welcome', 'leave'].includes(kind)) return;
  }
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    return interaction.reply({ content: 'You need Manage Server permission to change these settings.', flags: MessageFlags.Ephemeral });
  }
  if (owner && owner !== interaction.user.id) return interaction.reply({ content: `Open your own panel with /${kind}.`, flags: MessageFlags.Ephemeral });
  const guildId = interaction.guildId;
  let config = store.get(guildId, kind);
  if (!action) return interaction.reply({ ...panel(kind, config, interaction.user.id), flags: MessageFlags.Ephemeral });
  if (interaction.isButton() && forms[action]) return interaction.showModal(editor(kind, config, owner, action));
  if (action === 'preview' || action === 'test') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (action === 'preview') {
      const { flags, ...previewPayload } = buildMessage(config, member, true);
      return interaction.editReply(previewPayload);
    }
    const channel = await destination(interaction.guild, config);
    await channel.send(buildMessage(config, member, true));
    return interaction.editReply({ content: `Test sent to ${channel}. It uses you as the sample member and does not ping anyone.` });
  }
  await interaction.deferUpdate();
  let patch;
  if (interaction.isModalSubmit() && action.startsWith('save_')) {
    const fields = forms[action.slice(5)];
    if (!fields) throw new Error('Unknown editor. Reopen the setup command.');
    patch = Object.fromEntries(fields.map(([key]) => [key, interaction.fields.getTextInputValue(key).trim()]));
    // Inactive sections may be empty; validate their URLs/color without requiring text.
    const candidate = { ...config, ...patch };
    validate({ ...candidate, mode: 'embed', title: candidate.title || 'Validation' });
    if (candidate.enabled) validate(candidate);
  } else if (interaction.isChannelSelectMenu() && action === 'channel') {
    patch = { channelId: interaction.values[0] };
    await destination(interaction.guild, { ...config, ...patch });
  } else if (interaction.isStringSelectMenu() && action === 'mode') {
    patch = { mode: interaction.values[0] };
    validate({ ...config, ...patch });
    if (config.enabled) await destination(interaction.guild, { ...config, ...patch });
  } else if (interaction.isButton() && action === 'toggle') {
    patch = { enabled: !config.enabled };
    if (patch.enabled) {
      validate(config);
      await destination(interaction.guild, config);
    }
  } else if (interaction.isButton() && ['ping', 'ignoreBots', 'timestamp'].includes(action)) {
    patch = { [action]: !config[action] };
  } else throw new Error('Unknown control. Reopen the setup command.');
  // Apply only edited fields so another admin's unrelated changes are retained.
  config = store.update(guildId, kind, patch);
  return interaction.editReply(panel(kind, config, owner, 'Saved.'));
}
async function onInteraction(interaction, store) {
  try { await handle(interaction, store); }
  catch (error) {
    console.error('Setup interaction failed:', error.message);
    const content = `Could not complete that action: ${error.message}`.slice(0, 1900);
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    } catch (replyError) { console.error('Could not report interaction error:', replyError.message); }
  }
}
module.exports = { panel, editor, handle, onInteraction };
