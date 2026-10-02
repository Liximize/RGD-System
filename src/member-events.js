const path = require('node:path');
const { Events } = require('discord.js');
const { getStore } = require('./settings');
const { onInteraction } = require('./panels');
const { deliver } = require('./messages');
module.exports = function registerMemberEvents(client) {
  const store = getStore(process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'settings.json'));
  client.on(Events.InteractionCreate, interaction => {
    if (interaction.guildId !== process.env.GUILD_ID) return;
    if ((interaction.isChatInputCommand() && ['welcome', 'leave'].includes(interaction.commandName)) || interaction.customId?.startsWith('rgd:')) {
      void onInteraction(interaction, store);
    }
  });
  for (const [event, kind] of [[Events.GuildMemberAdd, 'welcome'], [Events.GuildMemberRemove, 'leave']]) {
    client.on(event, member => {
      if (member.guild.id !== process.env.GUILD_ID) return;
      void deliver(store, member, kind).catch(error => console.error(`[${kind}] guild=${member.guild.id} member=${member.id}: ${error.message}`));
    });
  }
};
