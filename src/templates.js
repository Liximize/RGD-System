function render(text, vars, limit) {
  const value = (text || '').replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
  return value.length > limit ? value.slice(0, limit - 1) + '…' : value;
}
function validURL(value) {
  if (!value) return true;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}
function validate(config) {
  if (!['text', 'embed', 'both'].includes(config.mode)) throw new Error('Choose a message format.');
  if (config.mode !== 'embed' && !config.content.trim()) throw new Error('Add normal message text first.');
  if (config.mode !== 'text' && ![config.title, config.description, config.image, config.thumbnail, config.author, config.footer].some(x => x.trim())) throw new Error('Add some embed content first.');
  if (!/^#[a-f\d]{6}$/i.test(config.color)) throw new Error('Use a six-digit hex color, such as #eb91ee.');
  for (const key of ['image', 'thumbnail', 'authorIcon', 'url']) {
    if (!['{avatar}', '{serverIcon}'].includes(config[key]) && !validURL(config[key])) throw new Error(`${key}: use an http(s) URL, {avatar}, {serverIcon}, or leave blank.`);
  }
}
module.exports = { render, validURL, validate };
