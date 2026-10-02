const http = require('node:http');
const crypto = require('node:crypto');
const { ChannelType } = require('discord.js');
const path = require('node:path');
const fs = require('node:fs');
const { getStore } = require('./settings');
const { validate, buildMessage, destination } = require('./messages');

const MAX_BODY = 64 * 1024;
const PUBLIC = path.join(__dirname, '..', 'public');
const sessions = new Map();
const cookieName = 'rgd_dashboard';

function json(res, status, value, extra = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(value));
}
function text(res, status, value, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(value);
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim()).filter(Boolean).map(v => { const i=v.indexOf('='); return [v.slice(0,i), decodeURIComponent(v.slice(i+1))]; }));
}
function session(req) { const id = parseCookies(req)[cookieName]; return id && sessions.get(id); }
function safeEqual(a, b) {
  const aa=Buffer.from(String(a || '')); const bb=Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
async function body(req) {
  let size=0; const chunks=[];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new Error('Request too large.'); chunks.push(chunk); }
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new Error('Invalid JSON.'); }
}
function cleanPatch(input) {
  const keys=['enabled','channelId','mode','ping','ignoreBots','timestamp','content','title','description','color','footer','image','thumbnail','author','authorIcon','url'];
  return Object.fromEntries(keys.filter(k => Object.prototype.hasOwnProperty.call(input,k)).map(k => [k, input[k]]));
}
function previewData(client, guild) {
  const me = guild.members.me;
  return { username: me?.user.username || client.user.username, displayName: me?.displayName || client.user.username, avatar: client.user.displayAvatarURL({size:512}), server: guild.name, memberCount: guild.memberCount, serverIcon: guild.iconURL({size:512}) || '' };
}
function renderWeb(config, vars) {
  const replace=s=>String(s||'').replaceAll('{user}', '@'+vars.username).replaceAll('{username}',vars.username).replaceAll('{displayName}',vars.displayName).replaceAll('{userId}','000000000000000000').replaceAll('{server}',vars.server).replaceAll('{memberCount}',String(vars.memberCount)).replaceAll('{avatar}',vars.avatar).replaceAll('{serverIcon}',vars.serverIcon);
  return { ...config, content:replace(config.content), title:replace(config.title), description:replace(config.description), footer:replace(config.footer), author:replace(config.author), image:replace(config.image), thumbnail:replace(config.thumbnail), authorIcon:replace(config.authorIcon), url:replace(config.url) };
}
function serveStatic(req, res) {
  const pathname = new URL(req.url, 'http://local').pathname;
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html','app.js','styles.css'].includes(name)) return false;
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
  text(res, 200, fs.readFileSync(path.join(PUBLIC,name)), types[path.extname(name)]); return true;
}

function startDashboard(client) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) { console.log('[dashboard] DASHBOARD_PASSWORD is not set; dashboard disabled.'); return; }
  const port = Number(process.env.PORT || process.env.DASHBOARD_PORT || 3000);
  const store = getStore(process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'settings.json'));
  const server = http.createServer(async (req,res) => {
    try {
      const url = new URL(req.url, 'http://local');
      if (!url.pathname.startsWith('/api/')) return serveStatic(req,res) || text(res,404,'Not found');
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const data=await body(req); if (!safeEqual(data.password,password)) return json(res,401,{error:'Incorrect password.'});
        const id=crypto.randomBytes(32).toString('hex'); sessions.set(id,{created:Date.now()});
        return json(res,200,{ok:true},{'set-cookie':`${cookieName}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${process.env.NODE_ENV==='production'?'; Secure':''}`});
      }
      if (url.pathname === '/api/logout' && req.method === 'POST') { const id=parseCookies(req)[cookieName]; if(id)sessions.delete(id); return json(res,200,{ok:true},{'set-cookie':`${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`}); }
      if (!session(req)) return json(res,401,{error:'Login required.'});
      const guild = client.guilds.cache.get(process.env.GUILD_ID); if (!guild) return json(res,503,{error:'Configured Discord server is not available.'});
      if (url.pathname === '/api/bootstrap' && req.method === 'GET') {
        const channels = [...guild.channels.cache.values()].filter(c=>[ChannelType.GuildText,ChannelType.GuildAnnouncement].includes(c.type)).sort((a,b)=>a.rawPosition-b.rawPosition).map(c=>({id:c.id,name:c.name}));
        return json(res,200,{guild:{id:guild.id,name:guild.name,icon:guild.iconURL({size:128})},channels,welcome:store.get(guild.id,'welcome'),leave:store.get(guild.id,'leave'),preview:previewData(client,guild)});
      }
      const m=url.pathname.match(/^\/api\/(welcome|leave)$/);
      if (m && req.method === 'PUT') {
        const kind=m[1], patch=cleanPatch(await body(req)), candidate={...store.get(guild.id,kind),...patch};
        validate({...candidate, mode:'embed', title:candidate.title || 'Validation'}); if(candidate.enabled){validate(candidate); await destination(guild,candidate);}
        return json(res,200,{config:store.update(guild.id,kind,patch)});
      }
      const t=url.pathname.match(/^\/api\/(welcome|leave)\/test$/);
      if (t && req.method === 'POST') {
        const kind=t[1], config=store.get(guild.id,kind), channel=await destination(guild,config), member=guild.members.me || await guild.members.fetchMe();
        await channel.send(buildMessage(config,member,true)); return json(res,200,{ok:true,message:`Test ${kind} message sent to #${channel.name}.`});
      }
      const p=url.pathname.match(/^\/api\/(welcome|leave)\/preview$/);
      if (p && req.method === 'POST') { const candidate={...store.get(guild.id,p[1]),...cleanPatch(await body(req))}; validate({...candidate,mode:'embed',title:candidate.title||'Validation'}); return json(res,200,{preview:renderWeb(candidate,previewData(client,guild))}); }
      return json(res,404,{error:'Not found.'});
    } catch (error) { console.error('[dashboard]',error); return json(res,400,{error:error.message || 'Request failed.'}); }
  });
  server.listen(port,'0.0.0.0',()=>console.log(`[dashboard] listening on port ${port}`));
  setInterval(()=>{const cutoff=Date.now()-86400000; for(const [id,s] of sessions)if(s.created<cutoff)sessions.delete(id)},3600000).unref();
}
module.exports={startDashboard};
