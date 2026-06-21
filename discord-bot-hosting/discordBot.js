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
const FALLBACK_FRONTEND_URL = 'https://cutrr.xyz';
// Canonical public site used for the shareable video URL shown in Discord.
const PUBLIC_VIDEO_BASE_URL = 'https://cutrr.xyz';

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

const LINK_RE = /\bhttps?:\/\/[^\s<>()]+/gi;
const BARE_EMBED_LINK_RE = /\b(?:www\.)?(?:youtube\.com|youtu\.be|tiktok\.com|vm\.tiktok\.com|streamable\.com|vimeo\.com|x\.com|twitter\.com|instagram\.com|venmo\.com)\/[^\s<>()]+/gi;
const TRAILING_LINK_PUNCTUATION_RE = /[.,!?;:'"\]\}]+$/;

const normalizeDetectedLink = (value) => {
  const link = String(value || '').replace(TRAILING_LINK_PUNCTUATION_RE, '');
  if (!link) return '';
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
};

const collectSubmissionLinks = ({ answers = [], videoUrl = '' }) => {
  const links = [];
  const seen = new Set();
  const addLink = (value) => {
    const link = normalizeDetectedLink(value);
    if (!link || seen.has(link)) return;
    seen.add(link);
    links.push(link);
  };

  addLink(videoUrl);

  for (const answer of answers) {
    const value = Array.isArray(answer?.value)
      ? answer.value.join(' ')
      : String(answer?.value || '');
    for (const match of value.matchAll(LINK_RE)) {
      addLink(match[0]);
    }
    const valueWithoutHttpLinks = value.replace(LINK_RE, ' ');
    for (const match of valueWithoutHttpLinks.matchAll(BARE_EMBED_LINK_RE)) {
      addLink(match[0]);
    }
  }

  return links;
};

const formatSubmissionLinksMessage = (links) => {
  const chunks = [];
  let length = 0;

  for (const link of links) {
    const nextLength = length + link.length + (chunks.length ? 1 : 0);
    if (nextLength > 1900) break;
    chunks.push(link);
    length = nextLength;
  }

  return chunks.join('\n');
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

const getAbsoluteHttpUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw || /[\s<>"'`|\\^,{}]/.test(raw)) return '';
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const hostname = url.hostname.toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)) return '';
    const normalized = url.toString();
    if (/[\s<>"'`|\\^,{}]/.test(normalized)) return '';
    return normalized;
  } catch {
    return '';
  }
};

const normalizeEmbedUrl = (value) => getAbsoluteHttpUrl(value);

const buildPublicUrl = (baseUrl, path) => {
  const safeBaseUrl = getAbsoluteHttpUrl(baseUrl) || FALLBACK_FRONTEND_URL;
  if (!safeBaseUrl) return '';
  try {
    return new URL(String(path || '').replace(/^\/+/, ''), safeBaseUrl.endsWith('/') ? safeBaseUrl : `${safeBaseUrl}/`).toString();
  } catch {
    return '';
  }
};

const truncateEmbedText = (value, maxLength) => {
  const text = String(value || '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
};

const normalizeDiscordText = (value, maxLength, fallback = '') => {
  const text = truncateEmbedText(value, maxLength).trim();
  return text || fallback;
};

const normalizeDiscordContent = (value) => normalizeDiscordText(value, 2000);

const normalizeEmbedField = (field) => {
  const name = normalizeDiscordText(field?.name, 256);
  const value = normalizeDiscordText(field?.value, 1024);
  if (!name || !value) return null;
  return {
    name,
    value,
    inline: Boolean(field?.inline)
  };
};

const isDiscordSnowflake = (value) => /^\d{17,20}$/.test(String(value || ''));

const sanitizeAllowedMentions = (allowedMentions = {}) => {
  const roles = Array.isArray(allowedMentions.roles)
    ? allowedMentions.roles.filter(isDiscordSnowflake)
    : [];
  const users = Array.isArray(allowedMentions.users)
    ? allowedMentions.users.filter(isDiscordSnowflake)
    : [];
  const parse = Array.isArray(allowedMentions.parse)
    ? allowedMentions.parse.filter((item) => ['roles', 'users', 'everyone'].includes(item))
    : [];
  return {
    ...(parse.length ? { parse } : {}),
    ...(roles.length ? { roles } : {}),
    ...(users.length ? { users } : {})
  };
};

const sanitizeDiscordEmbed = (embed = {}) => {
  const title = normalizeDiscordText(embed.title, 256);
  const description = normalizeDiscordText(embed.description, 4096);
  const url = normalizeEmbedUrl(embed.url);
  const imageUrl = normalizeEmbedUrl(embed.image?.url);
  const thumbnailUrl = normalizeEmbedUrl(embed.thumbnail?.url);
  const fields = Array.isArray(embed.fields)
    ? embed.fields.map(normalizeEmbedField).filter(Boolean).slice(0, 25)
    : [];
  return {
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    ...(description ? { description } : {}),
    ...(Number.isInteger(embed.color) ? { color: embed.color } : {}),
    ...(imageUrl ? { image: { url: imageUrl } } : {}),
    ...(thumbnailUrl ? { thumbnail: { url: thumbnailUrl } } : {}),
    ...(fields.length ? { fields } : {}),
    ...(embed.footer?.text ? { footer: { text: normalizeDiscordText(embed.footer.text, 2048) } } : {})
  };
};

const sanitizeDiscordMessageBody = (body = {}) => {
  const content = normalizeDiscordContent(body.content);
  const embeds = Array.isArray(body.embeds)
    ? body.embeds.map(sanitizeDiscordEmbed).filter((embed) => Object.keys(embed).length).slice(0, 10)
    : [];
  const allowedMentions = sanitizeAllowedMentions(body.allowedMentions);
  return {
    ...(content ? { content } : {}),
    ...(embeds.length ? { embeds } : {}),
    ...(Object.keys(allowedMentions).length ? { allowedMentions } : {})
  };
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

  const safeApplicationUrl = normalizeEmbedUrl(applicationUrl);
  const safeImageUrl = normalizeEmbedUrl(panel.imageUrl);
  const safeThumbnailUrl = normalizeEmbedUrl(panel.thumbnailUrl);
  const safeFooterText = truncateEmbedText(footerText, 2048);

  return {
    content: renderTemplate(panel.messageText, values),
    embeds: [{
      title: truncateEmbedText(renderTemplate(panel.embedTitle, values) || values.formName, 256),
      ...(safeApplicationUrl ? { url: safeApplicationUrl } : {}),
      description: truncateEmbedText(renderedDescription || safeApplicationUrl, 4096),
      color: discordColorFromHex(panel.accentColor),
      ...(safeImageUrl && panel.showLargeImage
        ? { image: { url: safeImageUrl } }
        : {}),
      ...(safeThumbnailUrl && panel.showThumbnail
        ? { thumbnail: { url: safeThumbnailUrl } }
        : {}),
      ...(safeFooterText ? { footer: { text: safeFooterText } } : {})
    }],
    allowedMentions: { parse: [] }
  };
};

export function createDiscordService(pool, { botToken, frontendUrl, embedUrl = '', bunnyCdnHost = '', videoBaseUrl = '' }) {
  const publicVideoBaseUrl = getAbsoluteHttpUrl(videoBaseUrl) || PUBLIC_VIDEO_BASE_URL;
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
    updateFormPanelMessage,
    getMemberRoles,
    hasGuildRole,
    hasAnyGuildRole,
    editChannelMessage
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
      const details = data?.errors ? `: ${JSON.stringify(data.errors).slice(0, 800)}` : '';
      const err = new Error(`${data?.message || `Discord API request failed (${res.status})`}${details}`);
      err.statusCode = res.status;
      err.discordCode = data?.code;
      err.discordErrors = data?.errors;
      throw err;
    }
    return data;
  };

  const sendDiscordMessage = async (channelId, body) => {
    const payload = sanitizeDiscordMessageBody(body);
    if (!payload.content && !payload.embeds?.length) {
      payload.content = 'Application submitted.';
    }

    if (client && ready) {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) throw new Error('Discord channel is not a text channel the bot can see.');
      return await channel.send(payload);
    }

    const { allowedMentions, ...rest } = payload;
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
      const unsentResult = await pool.query(
        `SELECT s.*, f.name AS form_name, f.guild_id, f.channel_id, f.accepted_role_id, f.ping_role_id, f.ping_role_ids,
                f.reviewer_role_id, f.voting_enabled, f.accept_emoji, f.deny_emoji, f.reapply_emoji,
                f.accept_threshold, f.deny_threshold, f.reapply_threshold, f.review_panel,
                v.id AS video_id, v.original_name
         FROM discord_form_submissions s
         JOIN discord_forms f ON f.id = s.form_id
         LEFT JOIN videos v ON v.id = s.video_id
         WHERE s.status = 'pending'
           AND s.discord_message_id IS NULL
         ORDER BY s.submitted_at ASC
         LIMIT 10`
      );

      let resent = 0;
      for (const row of unsentResult.rows) {
        try {
          const answers = Array.isArray(row.answers) ? row.answers : [];
          const externalVideoUrl =
            answers.find((answer) => answer?.id === 'external_video_url')?.value || '';
          await sendSubmissionMessage({
            form: {
              id: row.form_id,
              name: row.form_name,
              guildId: row.guild_id,
              channelId: row.channel_id,
              acceptedRoleId: row.accepted_role_id || '',
              pingRoleId: row.ping_role_id || '',
              pingRoleIds: row.ping_role_ids || [],
              reviewerRoleId: row.reviewer_role_id || '',
              votingEnabled: row.voting_enabled !== false,
              acceptEmoji: row.accept_emoji,
              denyEmoji: row.deny_emoji,
              reapplyEmoji: row.reapply_emoji,
              acceptThreshold: row.accept_threshold,
              denyThreshold: row.deny_threshold,
              reapplyThreshold: row.reapply_threshold,
              reviewPanel: row.review_panel || {}
            },
            submission: { ...row, answers },
            video: row.video_id ? { id: row.video_id, original_name: row.original_name } : null,
            externalVideoUrl
          });
          resent += 1;
        } catch (e) {
          console.warn(`Discord resend failed for saved submission ${row.id}:`, e.message);
        }
      }

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
      if (resent > 0) {
        console.log(`Discord resent ${resent} saved submission message(s).`);
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
      const code = e?.code ?? e?.discordCode;
      const status = e?.statusCode;
      // 10004 = Unknown Guild => the bot is genuinely NOT a member.
      if (code === 10004 || status === 404) {
        return false;
      }
      // 401/403/429/network/missing-token are NOT proof the bot is absent.
      // Treating them as "absent" produces a misleading "bot not in this server"
      // message (e.g. when the web server has a stale/invalid bot token).
      console.warn(
        `Could not verify Discord bot presence in guild ${guildId} (status ${status ?? "n/a"}): ${e.message}`,
      );
      throw e;
    }
  }

  async function listManageableGuilds(userGuilds = []) {
    const manageableGuilds = await Promise.all(
      userGuilds
        .filter(canManageGuild)
        .map(async (guild) => {
          let botPresent = false;
          let botPresenceUnknown = false;
          try {
            botPresent = await isBotInGuild(guild.id);
          } catch {
            // Could not verify (e.g. invalid token / rate limit). Don't claim absence.
            botPresenceUnknown = true;
          }
          return {
            id: guild.id,
            name: guild.name,
            icon: guild.icon || '',
            owner: Boolean(guild.owner),
            botPresent,
            botPresenceUnknown
          };
        })
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
    const videoUrl = video?.id ? buildPublicUrl(publicVideoBaseUrl, video.id) : normalizeEmbedUrl(externalVideoUrl);
    const pingRoleIds = getPingRoleIds(form);
    const ping = pingRoleIds.length ? `${formatRolePings(pingRoleIds)} ` : '';
    const hasDiscordUser = /^\d{17,20}$/.test(String(submission.discord_user_id || ''));
    const applicantLabel = hasDiscordUser
      ? `<@${submission.discord_user_id}>`
      : (submission.discord_username || 'Anonymous applicant');
    const answers = Array.isArray(submission.answers) ? submission.answers : [];
    const submissionLinks = collectSubmissionLinks({ answers, videoUrl });
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

    const safeVideoUrl = normalizeEmbedUrl(videoUrl);
    const safeImageUrl = normalizeEmbedUrl(reviewPanel.imageUrl);
    const safeThumbnailUrl = normalizeEmbedUrl(thumbnailUrl);
    const safeFooterText = normalizeDiscordText(renderTemplate(reviewPanel.footerText, templateValues), 2048);
    const safeTitle = normalizeDiscordText(renderedTitle, 256, 'Application');
    const safeDescription = normalizeDiscordText(
      reviewPanel.showVideoLink
        ? (description || (safeVideoUrl ? `[Open submitted video](${safeVideoUrl})` : 'No video was required for this application.'))
        : (description || 'No video link shown.'),
      4096,
      'Application submitted.'
    );
    const fields = [
      ...(reviewPanel.showApplicant ? [{ name: 'Submitted by', value: applicantLabel, inline: true }] : []),
      ...(reviewPanel.showVideoLink && safeVideoUrl ? [{ name: 'Video link', value: safeVideoUrl }] : []),
      ...(reviewPanel.showAnswers && answerLines ? [{ name: 'Answers', value: answerLines }] : [])
    ].map(normalizeEmbedField).filter(Boolean);

    const embedPayload = {
      title: safeTitle,
      ...(reviewPanel.showVideoLink && safeVideoUrl ? { url: safeVideoUrl } : {}),
      description: safeDescription,
      color: discordColorFromHex(reviewPanel.accentColor),
      ...(safeImageUrl && reviewPanel.showLargeImage
        ? { image: { url: safeImageUrl } }
        : {}),
      ...(safeThumbnailUrl && reviewPanel.showThumbnail
        ? { thumbnail: { url: safeThumbnailUrl } }
        : {}),
      ...(fields.length ? { fields } : {}),
      ...(form.votingEnabled !== false && safeFooterText
        ? { footer: { text: safeFooterText } }
        : {})
    };

    const message = await sendDiscordMessage(form.channelId, {
      content: normalizeDiscordContent(`${ping}${renderedContent}`),
      embeds: [embedPayload],
      allowedMentions: {
        roles: pingRoleIds,
        users: hasDiscordUser ? [submission.discord_user_id] : []
      }
    });

    await pool.query(
      'UPDATE discord_form_submissions SET discord_message_id = $1 WHERE id = $2',
      [message.id, submission.id]
    );

    const judgingEnabled = form.judgingEnabled === true;
    const judgingNote = judgingEnabled
      ? `Judging is open for this submission. Judges with the configured role can score it here: ${frontendUrl.replace(/\/+$/, '')}/judge/${form.slug}`
      : '';

    // Keep the judging note directly above the public video URL by sending them
    // together in a single message (note first, then the links).
    if (submissionLinks.length || judgingNote) {
      try {
        const linkText = formatSubmissionLinksMessage(submissionLinks);
        const content = [judgingNote, linkText].filter(Boolean).join('\n');
        if (content) {
          await sendDiscordMessage(form.channelId, {
            content,
            allowedMentions: { parse: [] }
          });
        }
      } catch (e) {
        console.warn(`Failed to send supplemental links for submission ${submission.id}:`, e.message);
      }
    }

    if (!judgingEnabled && form.votingEnabled !== false) {
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

  async function getMemberRoles({ guildId, discordUserId }) {
    if (!/^\d{17,20}$/.test(String(guildId || '')) || !/^\d{17,20}$/.test(String(discordUserId || ''))) {
      return { isMember: false, roles: [] };
    }
    try {
      const member = await discordApi(`/guilds/${guildId}/members/${discordUserId}`);
      return { isMember: true, roles: Array.isArray(member?.roles) ? member.roles : [] };
    } catch (e) {
      if (e.statusCode === 404) return { isMember: false, roles: [] };
      throw e;
    }
  }

  async function hasGuildRole({ guildId, discordUserId, roleId }) {
    if (!roleId) return false;
    const { roles } = await getMemberRoles({ guildId, discordUserId });
    return roles.includes(String(roleId));
  }

  async function hasAnyGuildRole({ guildId, discordUserId, roleIds }) {
    const wanted = (Array.isArray(roleIds) ? roleIds : [roleIds])
      .map((id) => String(id || ''))
      .filter(Boolean);
    if (!wanted.length) return false;
    const { roles } = await getMemberRoles({ guildId, discordUserId });
    const owned = new Set(roles.map((id) => String(id)));
    return wanted.some((id) => owned.has(id));
  }

  async function editChannelMessage({ channelId, messageId, body }) {
    const payload = sanitizeDiscordMessageBody(body);
    if (client && ready) {
      const channel = await client.channels.fetch(channelId);
      const message = await channel.messages.fetch(messageId);
      return await message.edit(payload);
    }
    const { allowedMentions, ...rest } = payload;
    return await discordApi(`/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...rest,
        allowed_mentions: allowedMentions || { parse: [] }
      })
    });
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
