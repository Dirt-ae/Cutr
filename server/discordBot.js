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

const getAcceptedRoleFailureMessage = (error) => {
  if (error?.code === 50013 || error?.status === 403) {
    return 'I could not grant the configured role. Give me Manage Roles and move my bot role above the accepted role.';
  }
  return 'I could not grant the configured role.';
};

const DEFAULT_REVIEW_PANEL = {
  messageText: 'New application for **{{formName}}** submitted by {{applicantName}}.',
  embedTitle: '{{videoTitle}}',
  embedDescription: '[Open submitted video]({{videoUrl}})',
  accentColor: '#ffffff',
  imageUrl: '',
  thumbnailUrl: '',
  thumbnailSource: 'custom',
  showLargeImage: false,
  showThumbnail: false,
  footerText: 'React to vote: accept, deny, or reapply.',
  showApplicant: true,
  showAnswers: true,
  showVideoLink: true
};

const DEFAULT_APPLICATION_PANEL = {
  messageText: '',
  embedTitle: '{{formName}}',
  embedDescription: '{{applicationUrl}}\n\n{{formDescription}}',
  accentColor: '#ffffff',
  imageUrl: '',
  thumbnailUrl: '',
  showLargeImage: false,
  showThumbnail: false,
  footerText: 'CUTRR applications'
};

const getReviewPanelConfig = (form) => ({
  ...DEFAULT_REVIEW_PANEL,
  ...(form.reviewPanel || form.review_panel || {})
});

const getApplicationPanelConfig = (form) => {
  const reviewPanel = form.reviewPanel || form.review_panel || {};
  return {
    ...DEFAULT_APPLICATION_PANEL,
    ...(reviewPanel.applicationPanel || {})
  };
};

const renderTemplate = (template, values) =>
  String(template || '').replace(/\{\{(formName|applicantName|videoTitle|videoUrl|formDescription|applicationUrl)\}\}/g, (_, key) =>
    values[key] || ''
  );

const discordColorFromHex = (value) => {
  const normalized = String(value || '').replace('#', '');
  return /^[0-9a-f]{6}$/i.test(normalized)
    ? Number.parseInt(normalized, 16)
    : 0xffffff;
};

const getDiscordAvatarUrl = (userId, avatarHash) => {
  if (!/^\d{17,20}$/.test(String(userId || ''))) return '';
  if (avatarHash) {
    const ext = String(avatarHash).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=256`;
  }
  const defaultIndex = Number((BigInt(userId) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${defaultIndex}.png`;
};

const getDefaultApplicationDescription = ({ formDescription, applicationUrl }) => {
  const extraDescription = String(formDescription || '').trim();
  const shouldAppendDescription = extraDescription
    && extraDescription !== applicationUrl
    && !/^apply\s+to\b/i.test(extraDescription);
  return `${applicationUrl}${shouldAppendDescription ? `\n\n${extraDescription}` : ''}`;
};

const buildApplicationPanelMessage = ({ form, applicationUrl }) => {
  const panel = getApplicationPanelConfig(form);
  const values = {
    formName: form.name || form.display_name || 'Application',
    formDescription: form.description || '',
    applicationUrl
  };
  const renderedDescription =
    panel.embedDescription === DEFAULT_APPLICATION_PANEL.embedDescription
      ? getDefaultApplicationDescription(values)
      : renderTemplate(panel.embedDescription, values);
  const footerText = renderTemplate(panel.footerText, values);

  return {
    content: renderTemplate(panel.messageText, values),
    embeds: [{
      title: renderTemplate(panel.embedTitle, values) || values.formName,
      url: applicationUrl,
      description: renderedDescription || applicationUrl,
      color: discordColorFromHex(panel.accentColor),
      ...(panel.imageUrl && panel.showLargeImage
        ? { image: { url: panel.imageUrl } }
        : {}),
      ...(panel.thumbnailUrl && panel.showThumbnail
        ? { thumbnail: { url: panel.thumbnailUrl } }
        : {}),
      ...(footerText ? { footer: { text: footerText } } : {})
    }],
    allowedMentions: { parse: [] }
  };
};

export function createDiscordService(pool, { botToken, frontendUrl, bunnyCdnHost = '' }) {
  let client = null;
  let ready = false;
  let reconciliationTimer = null;
  let reconciliationRunning = false;
  const gatewayEnabled = process.env.DISCORD_GATEWAY_ENABLED !== 'false';
  const guildSetupCache = new Map();
  const GUILD_SETUP_TTL_MS = 15_000;
  const RECONCILE_INTERVAL_MS = Math.max(
    5_000,
    Number.parseInt(process.env.DISCORD_RECONCILE_INTERVAL_MS || '15000', 10) || 15_000
  );

  const service = {
    isReady: () => ready || Boolean(botToken && !gatewayEnabled),
    start,
    listManageableGuilds,
    isBotInGuild,
    getGuildSetup,
    sendFormLinkMessage,
    sendSubmissionMessage,
    syncSubmissionDecision,
    grantAcceptedRole,
    sendPendingVoteReminders,
    updateFormPanelMessage
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

  const reactionMatchesAllowedEmoji = (reaction, allowedEmoji) => {
    if (!reaction?.emoji) return false;
    return emojiMatches(reaction.emoji, allowedEmoji);
  };

  const ensureVoteReactions = async (message, context) => {
    const allowed = getAllowedEmojisForFormRow(context);
    for (const emoji of allowed) {
      const existing = message.reactions.cache.find((reaction) =>
        reactionMatchesAllowedEmoji(reaction, emoji)
      );
      if (!existing || !existing.me) {
        await message.react(emoji);
      }
    }
  };

  const pruneReactionUsers = async (message, context) => {
    const allowed = getAllowedEmojisForFormRow(context);
    for (const reaction of message.reactions.cache.values()) {
      const isAllowedReaction = allowed.some((emoji) =>
        reactionMatchesAllowedEmoji(reaction, emoji)
      );

      if (!isAllowedReaction) {
        const users = await reaction.users.fetch();
        for (const user of users.values()) {
          if (!user.bot) await removeReactionForUser(reaction, user.id);
        }
        continue;
      }

      if (!context.reviewer_role_id) continue;
      const users = await reaction.users.fetch();
      for (const user of users.values()) {
        if (user.bot) continue;
        const okReviewer = await isAuthorizedReviewer({
          guildId: context.guild_id,
          userId: user.id,
          reviewerRoleId: context.reviewer_role_id
        });
        if (!okReviewer) await removeReactionForUser(reaction, user.id);
      }
    }
  };

  const getAllowedEmojisForFormRow = (row) => ([
    normalizeEmoji(row.accept_emoji, '✅'),
    normalizeEmoji(row.deny_emoji, '❌'),
    normalizeEmoji(row.reapply_emoji, '🔁')
  ]);

  const getPingRoleIds = (formLike) => {
    if (Array.isArray(formLike.pingRoleIds) && formLike.pingRoleIds.length) {
      return formLike.pingRoleIds;
    }
    if (Array.isArray(formLike.ping_role_ids) && formLike.ping_role_ids.length) {
      return formLike.ping_role_ids;
    }
    const fallback = formLike.pingRoleId || formLike.ping_role_id;
    return fallback ? [fallback] : [];
  };

  const formatRolePings = (roleIds) =>
    roleIds.map((roleId) => `<@&${roleId}>`).join(' ');

  const getPanelContextByMessage = async (messageId) => {
    const result = await pool.query(
      `SELECT id, guild_id, reviewer_role_id, voting_enabled, accept_emoji, deny_emoji, reapply_emoji
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

  const reconcileSubmissionMessage = async (messageId) => {
    const context = await getSubmissionContextByMessage(messageId);
    if (!context || context.status !== 'pending' || context.voting_enabled === false) return false;

    const channel = await client.channels.fetch(context.channel_id);
    const message = await channel.messages.fetch(messageId);
    await ensureVoteReactions(message, context);
    await pruneReactionUsers(message, context);
    await syncSubmissionDecision(messageId);
    return true;
  };

  const reconcilePendingSubmissionMessages = async () => {
    if (!client || !ready || reconciliationRunning) return;
    reconciliationRunning = true;
    try {
      const result = await pool.query(
        `SELECT discord_message_id
         FROM discord_form_submissions
         WHERE status = 'pending'
           AND discord_message_id IS NOT NULL
         ORDER BY submitted_at DESC
         LIMIT 50`
      );

      let fixed = 0;
      for (const row of result.rows) {
        try {
          if (await reconcileSubmissionMessage(row.discord_message_id)) fixed += 1;
        } catch (e) {
          console.warn(`Discord reconcile failed for message ${row.discord_message_id}:`, e.message);
        }
      }
      if (fixed > 0) {
        console.log(`Discord reconcile checked ${fixed} pending submission message(s).`);
      }
    } catch (e) {
      console.error('Discord reconcile job failed:', e);
    } finally {
      reconciliationRunning = false;
    }
  };

  const startReconciliationLoop = () => {
    if (reconciliationTimer) clearInterval(reconciliationTimer);
    reconcilePendingSubmissionMessages().catch((e) => {
      console.error('Initial Discord reconcile failed:', e);
    });
    reconciliationTimer = setInterval(() => {
      reconcilePendingSubmissionMessages().catch((e) => {
        console.error('Discord reconcile interval failed:', e);
      });
    }, RECONCILE_INTERVAL_MS);
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

    client.once('clientReady', () => {
      ready = true;
      console.log(`Discord bot connected as ${client.user.tag}`);
      console.log(`Discord reconcile loop running every ${RECONCILE_INTERVAL_MS}ms.`);
      startReconciliationLoop();
    });

    client.on('messageReactionAdd', async (reaction, user) => {
      try {
        if (user?.bot) return;
        if (reaction.partial) await reaction.fetch();
        if (reaction.message.partial) await reaction.message.fetch();

        const messageId = reaction.message.id;
        const submissionContext = await getSubmissionContextByMessage(messageId);
        if (submissionContext) {
          if (submissionContext.voting_enabled === false) {
            await removeReactionForUser(reaction, user.id);
            return;
          }
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
          if (panelContext.voting_enabled === false) {
            await removeReactionForUser(reaction, user.id);
            return;
          }
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
        if (!submissionContext || submissionContext.voting_enabled === false) return;
        await syncSubmissionDecision(messageId);
      } catch (e) {
        console.error('Failed to process Discord reaction removal:', e);
      }
    });

    await client.login(botToken);
  }

  async function getSubmissionContextByMessage(messageId) {
    const result = await pool.query(
      `SELECT s.*, f.name AS form_name, f.guild_id, f.channel_id, f.accepted_role_id, f.ping_role_id, f.ping_role_ids, f.reviewer_role_id,
              f.voting_enabled, f.accept_emoji, f.deny_emoji, f.reapply_emoji,
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

    const message = await sendDiscordMessage(
      channelId,
      buildApplicationPanelMessage({ form, applicationUrl })
    );

    return message.id;
  }

  async function sendSubmissionMessage({ form, submission, video, externalVideoUrl = '' }) {
    if (!form.channelId) {
      throw new Error('Form does not have a review channel configured. Please edit the form and select a review channel.');
    }

    console.log(`Sending submission message to channel ${form.channelId} for form ${form.name}`);
    const videoUrl = video?.id ? `${frontendUrl}/${video.id}` : String(externalVideoUrl || '');
    const pingRoleIds = getPingRoleIds(form);
    const ping = pingRoleIds.length ? `${formatRolePings(pingRoleIds)} ` : '';
    const hasDiscordUser = /^\d{17,20}$/.test(String(submission.discord_user_id || ''));
    const applicantLabel = hasDiscordUser
      ? `<@${submission.discord_user_id}>`
      : (submission.discord_username || 'Anonymous applicant');
    const answers = Array.isArray(submission.answers) ? submission.answers : [];
    const answerLines = answers
      .slice(0, 8)
      .map((item) => `**${item.label}**\n${String(item.value || 'No answer').slice(0, 700)}`)
      .join('\n\n');
    const reviewPanel = getReviewPanelConfig(form);
    const applicantAvatarUrl = getDiscordAvatarUrl(
      submission.discord_user_id,
      submission.discord_avatar
    );
    const thumbnailUrl =
      reviewPanel.thumbnailSource === 'applicant_avatar'
        ? applicantAvatarUrl
        : reviewPanel.thumbnailUrl;
    const templateValues = {
      formName: form.name || 'Application',
      applicantName: applicantLabel,
      videoTitle: video?.originalName || video?.original_name || (externalVideoUrl ? 'External video link' : 'Application'),
      videoUrl
    };
    const renderedContent = renderTemplate(reviewPanel.messageText, templateValues);
    const renderedTitle = renderTemplate(reviewPanel.embedTitle, templateValues);
    const renderedDescription = renderTemplate(
      reviewPanel.embedDescription,
      templateValues
    );
    const description =
      !videoUrl && reviewPanel.embedDescription === DEFAULT_REVIEW_PANEL.embedDescription
        ? 'No video was required for this application.'
        : renderedDescription;

    const message = await sendDiscordMessage(form.channelId, {
      content: `${ping}${renderedContent}`,
      embeds: [{
        title: renderedTitle || 'Application',
        ...(reviewPanel.showVideoLink && videoUrl ? { url: videoUrl } : {}),
        description: reviewPanel.showVideoLink
          ? (description || (videoUrl ? `[Open submitted video](${videoUrl})` : 'No video was required for this application.'))
          : (description || 'No video link shown.'),
        color: discordColorFromHex(reviewPanel.accentColor),
        ...(reviewPanel.imageUrl && reviewPanel.showLargeImage
          ? { image: { url: reviewPanel.imageUrl } }
          : {}),
        ...(thumbnailUrl && reviewPanel.showThumbnail
          ? { thumbnail: { url: thumbnailUrl } }
          : {}),
        fields: [
          ...(reviewPanel.showApplicant ? [{ name: 'Submitted by', value: applicantLabel, inline: true }] : []),
          ...(reviewPanel.showAnswers && answerLines ? [{ name: 'Answers', value: answerLines.slice(0, 1024) }] : [])
        ],
        ...(form.votingEnabled !== false && reviewPanel.footerText
          ? { footer: { text: renderTemplate(reviewPanel.footerText, templateValues) } }
          : {})
      }],
      allowedMentions: {
        roles: pingRoleIds,
        users: hasDiscordUser ? [submission.discord_user_id] : []
      }
    });

    if (videoUrl) {
      await sendDiscordMessage(form.channelId, {
        content: videoUrl,
        allowedMentions: { parse: [] }
      });
    }

    if (form.votingEnabled !== false) {
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
    if (!context || context.status !== 'pending' || context.voting_enabled === false) return null;

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

    const hasDiscordUser = /^\d{17,20}$/.test(String(context.discord_user_id || ''));
    const applicantLabel = hasDiscordUser
      ? `<@${context.discord_user_id}>`
      : (context.discord_username || 'Anonymous applicant');

    let roleGranted = false;
    let roleGrantError = null;
    if (decidedAction === 'accept' && context.accepted_role_id && hasDiscordUser) {
      try {
        roleGranted = await grantAcceptedRole({
          guildId: context.guild_id,
          discordUserId: context.discord_user_id,
          acceptedRoleId: context.accepted_role_id,
          formName: context.form_name
        });
      } catch (error) {
        roleGrantError = error;
        console.error(`Failed to grant accepted role ${context.accepted_role_id} to ${context.discord_user_id}:`, error);
      }
    }

    const replyText = decidedAction === 'accept'
      ? `${applicantLabel} accepted${roleGranted ? '. Role granted.' : roleGrantError ? `. ${getAcceptedRoleFailureMessage(roleGrantError)}` : '.'}`
      : decidedAction === 'deny'
        ? `${applicantLabel} denied. You can apply again <t:${Math.floor(cooldownUntil.getTime() / 1000)}:R>.`
        : `${applicantLabel} marked for reapplication. You can apply again <t:${Math.floor(cooldownUntil.getTime() / 1000)}:R>.`;

    await message.reply({ content: replyText, allowedMentions: { users: hasDiscordUser ? [context.discord_user_id] : [] } });
    return { status: decidedAction, counts: actionCounts, roleGranted, roleGrantError };
  }

  async function grantAcceptedRole({ guildId, discordUserId, acceptedRoleId, formName = 'application form' }) {
    if (!acceptedRoleId || !/^\d{17,20}$/.test(String(discordUserId || ''))) return false;

    if (client && ready) {
      const guild = await client.guilds.fetch(guildId);
      await guild.members.addRole({
        user: discordUserId,
        role: acceptedRoleId,
        reason: `Accepted through CUTRR form ${formName}`
      });
      return true;
    }

    await discordApi(`/guilds/${guildId}/members/${discordUserId}/roles/${acceptedRoleId}`, {
      method: 'PUT'
    });
    return true;
  }

  async function sendPendingVoteReminders() {
    if (!client || !ready) return { checked: 0, reminded: 0 };

    const result = await pool.query(
      `SELECT s.discord_message_id
       FROM discord_form_submissions s
       JOIN discord_forms f ON f.id = s.form_id
       WHERE s.status = 'pending'
         AND f.voting_enabled IS DISTINCT FROM false
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
        if (!context || context.status !== 'pending' || context.voting_enabled === false) continue;

        const channel = await client.channels.fetch(context.channel_id);
        const message = await channel.messages.fetch(context.discord_message_id);
        const decision = await syncSubmissionDecision(context.discord_message_id);
        if (decision?.status && decision.status !== 'pending') continue;

        const counts = decision?.counts || {
          accept: getReactionCount(message, normalizeEmoji(context.accept_emoji, '✅')),
          deny: getReactionCount(message, normalizeEmoji(context.deny_emoji, '❌')),
          reapply: getReactionCount(message, normalizeEmoji(context.reapply_emoji, '🔁'))
        };
        const pingRoleIds = getPingRoleIds(context);
        const ping = pingRoleIds.length ? `${formatRolePings(pingRoleIds)} ` : '';
        await message.reply({
          content: `${ping}this edit still needs votes. Current votes: ${context.accept_emoji} ${counts.accept}/${context.accept_threshold}, ${context.deny_emoji} ${counts.deny}/${context.deny_threshold}, ${context.reapply_emoji} ${counts.reapply}/${context.reapply_threshold}.`,
          allowedMentions: { roles: pingRoleIds }
        });
        await pool.query('UPDATE discord_form_submissions SET last_reminder_at = NOW() WHERE id = $1', [context.id]);
        reminded += 1;
      } catch (e) {
        console.error('Failed to send pending vote reminder:', e);
      }
    }

    return { checked: result.rows.length, reminded };
  }

  async function updateFormPanelMessage({ form, applicationUrl }) {
    const channelId = form.panel_channel_id || form.panelChannelId;
    const messageId = form.panel_message_id || form.panelMessageId;
    const formName = form.name || form.display_name || 'Application';
    
    if (!channelId || !messageId) {
      console.log(`[Discord] Skip update: No message/channel ID for form "${formName}"`);
      return false;
    }

    console.log(`[Discord] Updating panel message ${messageId} (Channel: ${channelId}) for "${formName}"`);

    try {
      const body = buildApplicationPanelMessage({ form, applicationUrl });

      if (client && ready) {
        const channel = await client.channels.fetch(channelId);
        if (!channel) throw new Error(`Channel ${channelId} not found or inaccessible`);
        const message = await channel.messages.fetch(messageId);
        if (!message) throw new Error(`Message ${messageId} not found in channel ${channelId}`);
        await message.edit(body);
        console.log(`[Discord] Successfully edited message ${messageId} (Gateway)`);
      } else {
        await discordApi(`/channels/${channelId}/messages/${messageId}`, {
          method: 'PATCH',
          body: JSON.stringify(body)
        });
        console.log(`[Discord] Successfully patched message ${messageId} (REST)`);
      }
      return true;
    } catch (e) {
      console.error(`[Discord] Failed to update panel message ${messageId}:`, e.message);
      if (e.discordCode) console.error(`[Discord] Discord Error Code: ${e.discordCode}`);
      return false;
    }
  }

  return service;
}
