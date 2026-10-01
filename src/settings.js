const fs = require('node:fs');
const path = require('node:path');
function defaults(kind) {
  return {
    enabled: false, channelId: null, mode: 'both', ping: kind === 'welcome',
    ignoreBots: false, timestamp: true,
    content: kind === 'welcome' ? 'Welcome {user} to **{server}**!' : '**{username}** has left {server}.',
    title: kind === 'welcome' ? 'Welcome to {server}!' : 'Goodbye, {username}',
    description: kind === 'welcome' ? 'Hey {user}, glad you joined! We now have **{memberCount}** members.' : '{displayName} has left. We now have **{memberCount}** members.',
    color: '#eb91ee', footer: '{server} • {memberCount} members',
    image: '', thumbnail: '{avatar}', author: '', authorIcon: '', url: ''
  };
}
class Settings {
  constructor(file) {
    this.file = file;
    this.data = {};
    if (fs.existsSync(file)) {
      // Fail visibly rather than silently replacing damaged settings.
      this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!this.data || Array.isArray(this.data) || typeof this.data !== 'object') throw new Error('Invalid settings file');
    }
  }
  get(guild, kind) { return { ...defaults(kind), ...this.data[guild]?.[kind] }; }
  update(guild, kind, patch) {
    const value = { ...this.get(guild, kind), ...patch };
    const next = { ...this.data, [guild]: { ...this.data[guild], [kind]: value } };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file);
    this.data = next;
    return value;
  }
}
module.exports = { Settings, defaults };
