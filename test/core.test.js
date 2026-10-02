const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, defaults } = require('../src/settings');
const { render, validate, validURL } = require('../src/templates');
test('settings survive reload and isolate welcome, leave, and guilds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgd-test-'));
  try {
    const file = path.join(dir, 'data', 'settings.json');
    const store = new Settings(file);
    store.update('guild1', 'welcome', { enabled: true, channelId: '123', content: 'Hello!' });
    store.update('guild1', 'leave', { content: 'Goodbye!' });
    store.update('guild2', 'welcome', { content: 'Other server' });
    store.update('guild1', 'welcome', { color: '#ffffff' });
    const reloaded = new Settings(file);
    assert.equal(reloaded.get('guild1', 'welcome').content, 'Hello!');
    assert.equal(reloaded.get('guild1', 'welcome').enabled, true);
    assert.equal(reloaded.get('guild1', 'leave').content, 'Goodbye!');
    assert.equal(reloaded.get('guild2', 'welcome').content, 'Other server');
    assert.equal(reloaded.get('guild2', 'leave').enabled, false);
    assert.equal(fs.existsSync(file + '.tmp'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('corrupt settings are not silently overwritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgd-test-'));
  try {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, 'broken');
    assert.throws(() => new Settings(file));
    assert.equal(fs.readFileSync(file, 'utf8'), 'broken');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('replacement is single-pass, preserves unknown placeholders, limits expansion', () => {
  assert.equal(render('{user} in {server}: {unknown}', { user: '{server}', server: 'RGD' }, 2000), '{server} in RGD: {unknown}');
  assert.equal(render('{server}'.repeat(100), { server: 'X'.repeat(100) }, 2000).length, 2000);
  assert.equal(render('{memberCount}', { memberCount: '0' }, 100), '0');
});
test('three formats validate correctly and reject empty active sections', () => {
  const base = defaults('welcome');
  for (const mode of ['text', 'embed', 'both']) assert.doesNotThrow(() => validate({ ...base, mode }));
  assert.throws(() => validate({ ...base, mode: 'text', content: ' ' }), /text/);
  assert.doesNotThrow(() => validate({ ...base, mode: 'embed', content: '' }));
  assert.throws(() => validate({ ...base, mode: 'embed', title: '', description: '', footer: '', thumbnail: '' }), /embed content/);
  assert.throws(() => validate({ ...base, color: 'pink' }), /hex/);
  assert.throws(() => validate({ ...base, mode: 'invalid' }), /format/);
});
test('image and link inputs reject unsafe or malformed URLs', () => {
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url']) {
    assert.equal(validURL(value), false);
    assert.throws(() => validate({ ...defaults('welcome'), image: value }), /http/);
  }
  for (const image of ['', '{avatar}', '{serverIcon}', 'https://example.com/image.gif']) assert.doesNotThrow(() => validate({ ...defaults('welcome'), image }));
});

test('shared store: two callers with the same file see each other\'s changes', () => {
  const { getStore } = require('../src/settings');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgd-test-'));
  try {
    const file = path.join(dir, 'settings.json');
    const a = getStore(file), b = getStore(file);
    assert.equal(a, b);
    a.update('g', 'welcome', { content: 'from dashboard' });
    b.update('g', 'leave', { content: 'from slash command' });
    const reloaded = new Settings(file);
    assert.equal(reloaded.get('g', 'welcome').content, 'from dashboard');
    assert.equal(reloaded.get('g', 'leave').content, 'from slash command');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
