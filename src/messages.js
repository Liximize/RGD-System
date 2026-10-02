const { EmbedBuilder, escapeMarkdown, PermissionsBitField, ChannelType } = require('discord.js');
const { render, validURL, validate } = require('./templates');
const placeholders = '{user} {username} {displayName} {userId} {server} {memberCount} {avatar} {serverIcon}';
function variables(member) {
  return {
    user: `<@${member.id}>`, username: escapeMarkdown(member.user.username),
    displayName: escapeMarkdown(member.displayName || member.user.globalName || member.user.username),
    userId: member.id, server: escapeMarkdown(member.guild.name), memberCount: String(member.guild.memberCount),
    avatar: member.user.displayAvatarURL({ size: 512 }), serverIcon: member.guild.iconURL({ size: 512 }) || ''
  };
}
function buildMessage(config, member, preview = false) {
  validate(config);
  const vars = variables(member);
  const payload = {
  allowedMentions: {
    parse: [],
    users: [member.id],
    repliedUser: false
  }
};

if (preview || !config.ping) {
  payload.flags = 4096;
}
  if (config.mode !== 'embed') payload.content = render(config.content, vars, 2000);
  if (config.mode !== 'text') {
    const embed = new EmbedBuilder().setColor(config.color);
    for (const [key, limit, method] of [['title', 256, 'setTitle'], ['description', 4096, 'setDescription']]) {
      const value = render(config[key], vars, limit);
      if (value) embed[method](value);
    }
    const footer = render(config.footer, vars, 1000);
    if (footer) embed.setFooter({ text: footer });
    const author = render(config.author, vars, 256);
    const iconURL = render(config.authorIcon, vars, 2048);
    if (author) embed.setAuthor({ name: author, ...(iconURL ? { iconURL } : {}) });
    for (const [key, method] of [['image', 'setImage'], ['thumbnail', 'setThumbnail'], ['url', 'setURL']]) {
      const value = render(config[key], vars, 2048);
      if (value && validURL(value)) embed[method](value);
    }
    if (config.timestamp) embed.setTimestamp();
    // Combined maximum is 5608 chars, below Discord's 6000-character embed limit.
    payload.embeds = [embed];
  }
  return payload;
}
async function destination(guild, config) {
  if (!config.channelId) throw new Error('Choose a channel first.');
  const channel = await guild.channels.fetch(config.channelId);
  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw new Error('Select an available text or announcement channel.');
  const me = guild.members.me || await guild.members.fetchMe();
  const required = [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages];
  if (config.mode !== 'text') required.push(PermissionsBitField.Flags.EmbedLinks);
  if (!channel.permissionsFor(me)?.has(required)) throw new Error('I need View Channel, Send Messages, and (for embeds) Embed Links in that channel.');
  return channel;
}
async function deliver(store, member, kind) {
  const config = store.get(member.guild.id, kind);
  if (!config.enabled || (config.ignoreBots && member.user.bot)) return;
  const channel = await destination(member.guild, config);
  await channel.send(buildMessage(config, member));
}
module.exports = { placeholders, render, validate, buildMessage, destination, deliver };
