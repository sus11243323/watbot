
'use strict';

require('dotenv').config();

const http = require('http');

const {
  Client,
  GatewayIntentBits,
  Events,
  AuditLogEvent,
  ChannelType
} = require('discord.js');

// ENV
const apiBase = (process.env.WATASZIT_API_URL || '').replace(/\/$/, '');
const secret = process.env.BETA_REVIEW_SECRET || '';
const token = process.env.DISCORD_BOT_TOKEN || '';
const PORT = Number(process.env.PORT) || 10000;

// HTTP SERVER FOR RENDER WEB SERVICE
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      service: 'Wataszit Discord Monitor'
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Wataszit] HTTP server running on port ${PORT}`);
});

// DISCORD CLIENT
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

// HELPERS
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendServerEvent(event) {
  try {
    const response = await fetch(`${apiBase}/api/internal/discord/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Beta-Review-Secret': secret
      },
      body: JSON.stringify({
        ...event,
        timestamp: new Date().toISOString()
      }),
      signal: AbortSignal.timeout(10000)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || `HTTP ${response.status}`);
    }

    console.log(`[Wataszit] Event sent: ${event.action}`);
  } catch (error) {
    console.error('[Wataszit] Could not send event:', error.message);
  }
}

async function getExecutor(guild, type, targetId) {
  try {
    const logs = await guild.fetchAuditLogs({
      type,
      limit: 5
    });

    const entry = logs.entries.find(entry =>
      entry.target?.id === targetId &&
      Date.now() - entry.createdTimestamp < 15000
    );

    return entry?.executor?.tag || 'Unknown user';
  } catch (error) {
    console.error('[Wataszit] Audit log error:', error.message);
    return 'Unknown user';
  }
}

function channelTypeName(channel) {
  return channel.type === ChannelType.GuildCategory
    ? 'category'
    : 'channel';
}

// CHANNEL CREATED
client.on(Events.ChannelCreate, async channel => {
  if (!channel.guild) return;

  await delay(1200);

  const executor = await getExecutor(
    channel.guild,
    AuditLogEvent.ChannelCreate,
    channel.id
  );

  const type = channelTypeName(channel);

  await sendServerEvent({
    action: 'channel_created',
    username: executor,
    target: channel.name,
    targetId: channel.id,
    details: `${executor} created a ${type} ${channel.name}`,
    guildId: channel.guild.id,
    guildName: channel.guild.name
  });
});

// CHANNEL DELETED
client.on(Events.ChannelDelete, async channel => {
  if (!channel.guild) return;

  await delay(1200);

  const executor = await getExecutor(
    channel.guild,
    AuditLogEvent.ChannelDelete,
    channel.id
  );

  const type = channelTypeName(channel);

  await sendServerEvent({
    action: 'channel_deleted',
    username: executor,
    target: channel.name,
    targetId: channel.id,
    details: `${executor} deleted a ${type} ${channel.name}`,
    guildId: channel.guild.id,
    guildName: channel.guild.name
  });
});

// CHANNEL UPDATED
client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild || oldChannel.name === newChannel.name) return;

  await delay(1200);

  const executor = await getExecutor(
    newChannel.guild,
    AuditLogEvent.ChannelUpdate,
    newChannel.id
  );

  await sendServerEvent({
    action: 'channel_updated',
    username: executor,
    target: newChannel.name,
    targetId: newChannel.id,
    details: `${executor} renamed ${oldChannel.name} to ${newChannel.name}`,
    guildId: newChannel.guild.id,
    guildName: newChannel.guild.name
  });
});

// ROLE CREATED
client.on(Events.GuildRoleCreate, async role => {
  await delay(1200);

  const executor = await getExecutor(
    role.guild,
    AuditLogEvent.RoleCreate,
    role.id
  );

  await sendServerEvent({
    action: 'role_created',
    username: executor,
    target: role.name,
    targetId: role.id,
    details: `${executor} created a role ${role.name}`,
    guildId: role.guild.id,
    guildName: role.guild.name
  });
});

// ROLE DELETED
client.on(Events.GuildRoleDelete, async role => {
  await delay(1200);

  const executor = await getExecutor(
    role.guild,
    AuditLogEvent.RoleDelete,
    role.id
  );

  await sendServerEvent({
    action: 'role_deleted',
    username: executor,
    target: role.name,
    targetId: role.id,
    details: `${executor} deleted a role ${role.name}`,
    guildId: role.guild.id,
    guildName: role.guild.name
  });
});

// ROLE UPDATED
client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  const changes = [];

  if (oldRole.name !== newRole.name)
    changes.push(`renamed role ${oldRole.name} to ${newRole.name}`);

  if (oldRole.color !== newRole.color)
    changes.push(`changed color of role ${newRole.name}`);

  if (oldRole.hoist !== newRole.hoist)
    changes.push(`changed display settings of role ${newRole.name}`);

  if (oldRole.mentionable !== newRole.mentionable)
    changes.push(`changed mention settings of role ${newRole.name}`);

  if (!changes.length) return;

  await delay(1200);

  const executor = await getExecutor(
    newRole.guild,
    AuditLogEvent.RoleUpdate,
    newRole.id
  );

  await sendServerEvent({
    action: 'role_updated',
    username: executor,
    target: newRole.name,
    targetId: newRole.id,
    details: `${executor} ${changes.join(', ')}`,
    guildId: newRole.guild.id,
    guildName: newRole.guild.name
  });
});

// MEMBER UPDATED
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const changes = [];

  if (oldMember.user.username !== newMember.user.username) {
    changes.push(
      `changed username from ${oldMember.user.username} to ${newMember.user.username}`
    );
  }

  if (oldMember.nickname !== newMember.nickname) {
    changes.push(
      `changed nickname from ${oldMember.nickname || oldMember.user.username} to ${newMember.nickname || newMember.user.username}`
    );
  }

  if (!changes.length) return;

  await sendServerEvent({
    action: 'member_updated',
    username: newMember.user.tag,
    target: newMember.user.tag,
    targetId: newMember.id,
    details: `${newMember.user.tag} ${changes.join(', ')}`,
    guildId: newMember.guild.id,
    guildName: newMember.guild.name
  });
});

// MEMBER JOINED
client.on(Events.GuildMemberAdd, async member => {
  await sendServerEvent({
    action: 'member_joined',
    username: member.user.tag,
    target: member.user.tag,
    targetId: member.id,
    details: `${member.user.tag} joined the server`,
    guildId: member.guild.id,
    guildName: member.guild.name
  });
});

// MEMBER LEFT
client.on(Events.GuildMemberRemove, async member => {
  await sendServerEvent({
    action: 'member_left',
    username: member.user.tag,
    target: member.user.tag,
    targetId: member.id,
    details: `${member.user.tag} left the server`,
    guildId: member.guild.id,
    guildName: member.guild.name
  });
});

// READY
client.once(Events.ClientReady, () => {
  console.log(`[Wataszit] Discord monitor online as ${client.user.tag}`);
});

// ERROR HANDLING
client.on(Events.Error, error => {
  console.error('[Wataszit] Discord client error:', error);
});

// ENV VALIDATION
if (!token || !secret || !apiBase) {
  console.error(
    'Missing DISCORD_BOT_TOKEN, BETA_REVIEW_SECRET or WATASZIT_API_URL'
  );
  process.exit(1);
}

// LOGIN
client.login(token).catch(error => {
  console.error('[Wataszit] Discord login failed:', error);
  process.exit(1);
});
