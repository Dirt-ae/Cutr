import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials
} from 'discord.js';

const ACTIONS = {
  accept: { column: 'accept_threshold', label: 'accepted' },
  deny: { column: 'deny_threshold', label: 'denied' },
  reapply: { column: 'reapply_threshold', label: 'reapply' }
};
const DISCORD_API_BASE = 'https://discord.com/api/v10';

const EMOJI_REPAIRS = new Map([
  ['âœ…', '✅'],
  ['âŒ', '❌'],
  ['ðŸ”', '🔁']
]);

const normalizeEmoji = (value, fallback) => {
  const emoji = String(value || fallback).trim();
  return EMOJI_REPAIRS.get(emoji) || emoji;
};

const emojiMatches = (reactionEmoji, allowed) => {
  if (!allowed) return false;
  if (reactionEmoji?.id) {
    return reactionEmoji.toString() === allowed || reactionEmoji.id === allowed;
  }
  return reactionEmoji?.name === allowed;
};

const getReactionCount = (message, emoji) => {
  const reaction = message.reactions.cache.find((item) => {
    if (item.emoji.id) return item.emoji.toString() === emoji || item.emoji.id === emoji;
    return item.emoji.name === emoji;
  });
  return Math.max(0, (reaction?.count || 0) - (reaction?.me ? 1 : 0));
};

export function createDiscordService(pool, { botToken, frontendUrl, bunnyCdnHost = '' }) {
  let client = null;
  let ready = false;
  const gatewayEnabled = process.env.DISCORD_GATEWAY_ENABLED !== 'false';
  const guildSetupCache = new Map();
  const GUILD_SETUP_TTL_MS = 15_000;

  const service = {
    isReady: () => ready || Boolean(botToken && !gatewayEnabled),
    start,
    listManageableGuilds,
    isBotInGuild,
    getGuildSetup,
    sendFormLinkMessage,
    sendSubmissionMessage,
    syncSubmissionDecision,
    sendPendingVoteReminders
  };

  const removeReactionForUser = async (reaction, userId) => {
    try {
      await reaction.users.remove(userId);
      return true;
    } catch {
      return false;
    }
  };

  const discordApi = async (path, options = {}) => {
    if (!botToken) {
      throw new Error('DISCORD_BOT_TOKEN is not set; Discord bot API is disabled.');
    }

    const headers = {
      Authorization: `Bot ${botToken}`,
      ...(options.headers || {})
    };
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${DISCORD_API_BASE}${path}`, {
      ...options,
      headers
    });

    if (res.status === 204) return null;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(data?.message || `Discord API request failed (${res.status})`);
      err.statusCode = res.status;
      err.discordCode = data?.code;
      throw err;
    }
    return data;
  };

  const sendDiscordMessage = async (channelId, body) => {
    if (client && ready) {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) throw new Error('Discord channel is not a text channel the bot can see.');
      return await channel.send(body);
    }

    const { allowedMentions, ...rest } = body;
    return await discordApi(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        ...rest,
        ...(allowedMentions ? { allowed_mentions: allowedMentions } : {})
      })
    });
  };

  const addDiscordReaction = async (channelId, message, emoji) => {
    if (client && ready && typeof message.react === 'function') {
      await message.react(emoji);
      return;
    }

    await discordApi(`/channels/${channelId}/messages/${message.id}/reactions/${encodeURIComponent(emoji)}/@me`, {
      method: 'PUT'
    });
  };

  const getAllowedEmojisForFormRow = (row) => ([
    normalizeEmoji(row.accept_emoji, '✅'),
    normalizeEmoji(row.deny_emoji, '❌'),
    normalizeEmoji(row.reapply_emoji, '🔁')
  ]);

  const getPanelContextByMessage = async (messageId) => {
    const result = await pool.query(
      `SELECT id, guild_id, reviewer_role_id, accept_emoji, deny_emoji, reapply_emoji
       FROM discord_forms
       WHERE panel_message_id = $1`,
      [messageId]
    );
    return result.rows[0] || null;
  };

  const isAuthorizedReviewer = async ({ guildId, userId, reviewerRoleId }) => {
    if (!reviewerRoleId) return true;
    if (!client || !ready) return false;
    try {
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      return Boolean(member?.roles?.cache?.has(reviewerRoleId));
    } catch {
      return false;
    }
  };

  async function start() {
    if (!botToken) {
      console.warn('DISCORD_BOT_TOKEN is not set; Discord application posting is disabled.');
      return;
    }
    if (!gatewayEnabled) {
      console.log('Discord gateway is disabled; using REST API for web server Discord actions.');
      return;
    }

    client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessages
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction]
    });

    client.once('ready', () => {
      ready = true;
      console.log(`Discord bot connected as ${client.user.tag}`);
    });

    client.on('messageReactionAdd', async (reaction, user) => {
      try {
        if (user?.bot) return;
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        const messageId = reaction.message.id;
        const submissionContext = await getSubmissionContextByMessage(messageId);
        if (submissionContext) {
          const allowed = getAllowedEmojisForFormRow(submissionContext);
          const isAllowedEmoji = allowed.some((emoji) => emojiMatches(reaction.emoji, emoji));
          if (!isAllowedEmoji) {
            await removeReactionForUser(reaction, user.id);
            return;
          }

          const reviewerRoleId = submissionContext.reviewer_role_id || '';
          const okReviewer = await isAuthorizedReviewer({
            guildId: submissionContext.guild_id,
            userId: user.id,
            reviewerRoleId
          });
          if (!okReviewer) {
            await removeReactionForUser(reaction, user.id);
            return;
          }

          await syncSubmissionDecision(messageId);
          return;
        }

        const panelContext = await getPanelContextByMessage(messageId);
        if (panelContext) {
          const allowed = getAllowedEmojisForFormRow(panelContext);
          const isAllowedEmoji = allowed.some((emoji) => emojiMatches(reaction.emoji, emoji));
          if (!isAllowedEmoji) {
            await removeReactionForUser(reaction, user.id);
            return;
          }

          const okReviewer = await isAuthorizedReviewer({
            guildId: panelContext.guild_id,
            userId: user.id,
            reviewerRoleId: panelContext.reviewer_role_id || ''
          });
          if (!okReviewer) {
            await removeReactionForUser(reaction, user.id);
          }
        }
      } catch (e) {
        console.error('Failed to process Discord reaction:', e);
      }
    });

    client.on('messageReactionRemove', async (reaction, user) => {
      try {
        if (user?.bot) return;
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        const messageId = reaction.message.id;
        const submissionContext = await getSubmissionContextByMessage(messageId);
        if (!submissionContext) return;
        await syncSubmissionDecision(messageId);
      } catch (e) {
        console.error('Failed to process Discord reaction removal:', e);
      }
    });

    await client.login(botToken);
  }

  async function getSubmissionContextByMessage(messageId) {
    const result = await pool.query(
      `SELECT s.*, f.name AS form_name, f.guild_id, f.channel_id, f.accepted_role_id, f.ping_role_id, f.reviewer_role_id,
              f.accept_emoji, f.deny_emoji, f.reapply_emoji,
              f.accept_threshold, f.deny_threshold, f.reapply_threshold,
              f.deny_cooldown_days, f.reapply_cooldown_days,
              v.original_name
       FROM discord_form_submissions s
       JOIN discord_forms f ON f.id = s.form_id
       JOIN videos v ON v.id = s.video_id
       WHERE s.discord_message_id = $1`,
      [messageId]
    );
    return result.rows[0] || null;
  }

  function canManageGuild(userGuild) {
    if (userGuild.owner) return true;
    try {
      const permissions = BigInt(userGuild.permissions || 0);
      return (permissions & 0x8n) === 0x8n || (permissions & 0x20n) === 0x20n;
    } catch {
      return false;
    }
  }

  async function isBotInGuild(guildId) {
    if (client && ready && client.guilds.cache.has(guildId)) return true;

    try {
      if (client && ready) {
        await client.guilds.fetch(guildId);
      } else {
        await discordApi(`/guilds/${guildId}`);
      }
      return true;
    } catch (e) {
      if (e?.code !== 10004 && e?.discordCode !== 10004 && e?.statusCode !== 403) {
        console.warn(`Failed to verify Discord bot guild ${guildId}:`, e.message);
      }
      return false;
    }
  }

  async function listManageableGuilds(userGuilds = []) {
    const manageableGuilds = await Promise.all(
      userGuilds
        .filter(canManageGuild)
        .map(async (guild) => ({
          id: guild.id,
          name: guild.name,
          icon: guild.icon || '',
          owner: Boolean(guild.owner),
          botPresent: await isBotInGuild(guild.id)
        }))
    );

    return manageableGuilds.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function getGuildSetup(guildId) {
    const cached = guildSetupCache.get(guildId);
    if (cached && (Date.now() - cached.cachedAt) < GUILD_SETUP_TTL_MS) {
      return cached.value;
    }

    let guild;
    let channels;
    let roles;

    if (client && ready) {
      guild = await client.guilds.fetch(guildId);
      channels = [...(await guild.channels.fetch()).values()];
      roles = [...(await guild.roles.fetch()).values()];
    } else {
      guild = await discordApi(`/guilds/${guildId}`);
      channels = await discordApi(`/guilds/${guildId}/channels`);
      roles = await discordApi(`/guilds/${guildId}/roles`);
    }

    const value = {
      id: guild.id,
      name: guild.name,
      channels: channels
        .filter((channel) => channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
        .map((channel) => ({ id: channel.id, name: channel.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      roles: roles
        .filter((role) => role && !role.managed && role.name !== '@everyone')
        .map((role) => ({ id: role.id, name: role.name, position: role.position }))
        .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name))
    };
    guildSetupCache.set(guildId, { cachedAt: Date.now(), value });
    return value;
  }

  async function sendFormLinkMessage({ form, applicationUrl }) {
    const channelId = form.panelChannelId || form.panel_channel_id || form.channelId || form.channel_id;
    if (!channelId) throw new Error('Form does not have a Discord channel configured yet.');

    const extraDescription = String(form.description || '').trim();
    const shouldAppendDescription = extraDescription
      && extraDescription !== applicationUrl
      && !/^apply\s+to\b/i.test(extraDescription);

    const message = await sendDiscordMessage(channelId, {
      content: '',
      embeds: [{
        title: form.name,
        url: applicationUrl,
        description: `${applicationUrl}${shouldAppendDescription ? `\n\n${extraDescription}` : ''}`,
        color: 0xffffff,
        footer: { text: 'CUTR applications' }
      }],
      allowedMentions: { roles: [] }
    });

    return message.id;
  }

  async function sendSubmissionMessage({ form, submission, video }) {
    if (!form.channelId) {
      throw new Error('Form does not have a review channel configured. Please edit the form and select a review channel.');
    }

    console.log(`Sending submission message to channel ${form.channelId} for form ${form.name}`);
    const videoUrl = `${frontendUrl}/${video.id}`;
    const ping = form.pingRoleId ? `<@&${form.pingRoleId}> ` : '';
    const answers = Array.isArray(submission.answers) ? submission.answers : [];
    const answerLines = answers
      .slice(0, 8)
      .map((item) => `**${item.label}**\n${String(item.value || 'No answer').slice(0, 700)}`)
      .join('\n\n');

    const message = await sendDiscordMessage(form.channelId, {
      content: `${ping}New application for **${form.name}** submitted by <@${submission.discord_user_id}>.`,
      embeds: [{
        title: video.originalName || video.original_name || 'Application edit',
        url: videoUrl,
        description: `[Open submitted video](${videoUrl})`,
        color: 0xffffff,
        fields: [
          { name: 'Submitted by', value: `<@${submission.discord_user_id}>`, inline: true },
          ...(answerLines ? [{ name: 'Answers', value: answerLines.slice(0, 1024) }] : [])
        ],
        footer: { text: 'React to vote: accept, deny, or reapply.' }
      }],
      allowedMentions: { roles: form.pingRoleId ? [form.pingRoleId] : [], users: [submission.discord_user_id] }
    });

    await sendDiscordMessage(form.channelId, {
      content: videoUrl,
      allowedMentions: { parse: [] }
    });

    const emojis = [
      normalizeEmoji(form.acceptEmoji, '✅'),
      normalizeEmoji(form.denyEmoji, '❌'),
      normalizeEmoji(form.reapplyEmoji, '🔁')
    ];
    for (const emoji of emojis) {
      try {
        await addDiscordReaction(form.channelId, message, emoji);
      } catch (e) {
        console.warn(`Failed to add Discord reaction ${emoji} to submission ${submission.id}:`, e.message);
      }
    }

    await pool.query(
      'UPDATE discord_form_submissions SET discord_message_id = $1 WHERE id = $2',
      [message.id, submission.id]
    );

    console.log(`Successfully sent submission message ${message.id} to Discord`);
    return message.id;
  }

  async function syncSubmissionDecision(messageId) {
    if (!client || !ready) throw new Error('Discord bot is not connected.');
    const context = await getSubmissionContextByMessage(messageId);
    if (!context || context.status !== 'pending') return null;

    const channel = await client.channels.fetch(context.channel_id);
    const message = await channel.messages.fetch(messageId);

    const actionCounts = {
      accept: getReactionCount(message, normalizeEmoji(context.accept_emoji, '✅')),
      deny: getReactionCount(message, normalizeEmoji(context.deny_emoji, '❌')),
      reapply: getReactionCount(message, normalizeEmoji(context.reapply_emoji, '🔁'))
    };

    const decidedAction = Object.keys(ACTIONS).find((action) => {
      const threshold = Number(context[ACTIONS[action].column] || 1);
      return actionCounts[action] >= threshold;
    });

    if (!decidedAction) return { status: 'pending', counts: actionCounts };

    const now = new Date();
    let cooldownUntil = null;
    if (decidedAction === 'deny') {
      cooldownUntil = new Date(now.getTime() + Number(context.deny_cooldown_days || 30) * 24 * 60 * 60 * 1000);
    } else if (decidedAction === 'reapply') {
      cooldownUntil = new Date(now.getTime() + Number(context.reapply_cooldown_days || 14) * 24 * 60 * 60 * 1000);
    }

    await pool.query(
      `UPDATE discord_form_submissions
       SET status = $1, decided_at = NOW(), cooldown_until = $2
       WHERE id = $3 AND status = 'pending'`,
      [decidedAction, cooldownUntil ? cooldownUntil.toISOString() : null, context.id]
    );

    if (cooldownUntil) {
      await pool.query(
        `INSERT INTO discord_form_cooldowns (form_id, discord_user_id, reason, cooldown_until)
         VALUES ($1, $2, $3, $4)`,
        [context.form_id, context.discord_user_id, decidedAction, cooldownUntil.toISOString()]
      );
    }

    if (decidedAction === 'accept' && context.accepted_role_id) {
      const guild = await client.guilds.fetch(context.guild_id);
      await guild.members.addRole({
        user: context.discord_user_id,
        role: context.accepted_role_id,
        reason: `Accepted through CUTR form ${context.form_name}`
      });
    }

    const replyText = decidedAction === 'accept'
      ? `<@${context.discord_user_id}> accepted. Role granted.`
      : decidedAction === 'deny'
        ? `<@${context.discord_user_id}> denied. You can apply again <t:${Math.floor(cooldownUntil.getTime() / 1000)}:R>.`
        : `<@${context.discord_user_id}> marked for reapplication. You can apply again <t:${Math.floor(cooldownUntil.getTime() / 1000)}:R>.`;

    await message.reply({ content: replyText, allowedMentions: { users: [context.discord_user_id] } });
    return { status: decidedAction, counts: actionCounts };
  }

  async function sendPendingVoteReminders() {
    if (!client || !ready) return { checked: 0, reminded: 0 };

    const result = await pool.query(
      `SELECT s.discord_message_id
       FROM discord_form_submissions s
       WHERE s.status = 'pending'
         AND s.discord_message_id IS NOT NULL
         AND s.submitted_at < NOW() - INTERVAL '12 hours'
         AND (s.last_reminder_at IS NULL OR s.last_reminder_at < NOW() - INTERVAL '12 hours')
       ORDER BY s.submitted_at ASC
       LIMIT 25`
    );

    let reminded = 0;
    for (const row of result.rows) {
      try {
        const context = await getSubmissionContextByMessage(row.discord_message_id);
        if (!context || context.status !== 'pending') continue;

        const channel = await client.channels.fetch(context.channel_id);
        const message = await channel.messages.fetch(context.discord_message_id);
        const decision = await syncSubmissionDecision(context.discord_message_id);
        if (decision?.status && decision.status !== 'pending') continue;

        const counts = decision?.counts || {
          accept: getReactionCount(message, normalizeEmoji(context.accept_emoji, '✅')),
          deny: getReactionCount(message, normalizeEmoji(context.deny_emoji, '❌')),
          reapply: getReactionCount(message, normalizeEmoji(context.reapply_emoji, '🔁'))
        };
        const ping = context.ping_role_id ? `<@&${context.ping_role_id}> ` : '';
        await message.reply({
          content: `${ping}this edit still needs votes. Current votes: ${context.accept_emoji} ${counts.accept}/${context.accept_threshold}, ${context.deny_emoji} ${counts.deny}/${context.deny_threshold}, ${context.reapply_emoji} ${counts.reapply}/${context.reapply_threshold}.`,
          allowedMentions: { roles: context.ping_role_id ? [context.ping_role_id] : [] }
        });
        await pool.query('UPDATE discord_form_submissions SET last_reminder_at = NOW() WHERE id = $1', [context.id]);
        reminded += 1;
      } catch (e) {
        console.error('Failed to send pending vote reminder:', e);
      }
    }

    return { checked: result.rows.length, reminded };
  }

  return service;
}
