// Webhook and poll incoming message processor extracted from server.js.

const {
    getPayloadChatId,
    getPayloadSenderId,
    isOutgoingMessage,
    rememberBotMessage,
    detectMessageTrigger,
    learnBotMentionFromIncoming,
} = require('./messageTriggers');
const { buildRuntimeChatContext, autoCategorize } = require('./aiAdvanced');
const { loadRoster, fetchAndCacheRoster } = require('./groupRoster');
const {
    shouldConsiderProactive,
    checkProactiveCooldown,
    markProactiveSent,
    PROACTIVE_SKIP_MARKER,
} = require('./proactiveGuard');
const { withChatLock } = require('../chatContext');
const { extractDMs, stripDMTags } = require('./reasoning');
const {
    collectKnownDmTargets,
    splitAllowedDMs,
    appendBlockedDmNotice,
} = require('./dmSafety');
const { extractMentionIntents, formatMentionedReply } = require('./mentionHelper');
const { previewText } = require('./webhookDebug');

const createWebhookProcessor = ({
    sendWA,
    makeAskAI,
    processCommand,
    handleNaturalLanguage,
    summarizePayload,
    resolveCanonicalSender,
    hasProcessedIncoming,
    markProcessedIncoming,
    isRateLimited,
    summarizeBotState,
    botTriggerState,
    groupRosterClient,
    lidResolver, // eslint-disable-line no-unused-vars -- kept in factory contract per Tier-2E plan
    mentionCooldownStore,
    TARGET_GROUPS,
    MENTION_COOLDOWN_MS,
}) => {
    const sendAllowedDMs = async ({ dms, knownTargets, record, source, blockedStage }) => {
        const { allowed, blocked } = splitAllowedDMs(dms, knownTargets);
        for (const dm of allowed) {
            await sendWA(dm.message, dm.target);
            record(`${source}-dm-sent`, { target: dm.target, preview: previewText(dm.message) });
        }
        if (blocked.length > 0) {
            record(`${source}-${blockedStage}`, {
                blocked: blocked.map(dm => dm.target),
            });
        }
        return { allowed, blocked };
    };

    return async ({ body, payload, record, source = 'webhook', force = false }) => {
        const _data = payload._data || {};
        const chatId = getPayloadChatId(payload);
        const isGroup = chatId.endsWith('@g.us');
        const isTargetGroup = Boolean(TARGET_GROUPS && TARGET_GROUPS.includes(chatId));
        // DM covers both legacy @c.us and modern @lid chat IDs from WAHA (not group/broadcast/newsletter).
        const isDM = !isGroup
            && !chatId.endsWith('@broadcast')
            && !chatId.endsWith('@newsletter')
            && chatId.length > 0;
        // Allow: target group OR any private DM. Drop other groups / broadcasts / channels.
        if (!isDM && !isTargetGroup) {
            record(`${source}-chat-filtered`, {
                reason: 'chat is neither target group nor DM',
                expectedGroups: TARGET_GROUPS,
                actualChatId: chatId,
                payload: summarizePayload(body, payload, chatId),
            });
            return;
        }

        if (isOutgoingMessage(payload)) {
            const tracked = rememberBotMessage(botTriggerState, {
                id: _data.id || payload.id,
                participant: payload.participant || payload.author,
                author: payload.author,
                _data,
                me: body.me,
            });
            markProcessedIncoming(payload);
            record(`${source}-outgoing-ignored`, {
                payload: summarizePayload(body, payload, chatId),
                tracked,
                state: summarizeBotState(),
            });
            return;
        }

        const msgBody = (payload.body || _data.body || '').trim();
        if (!msgBody) {
            record(`${source}-empty-body`, {
                payload: summarizePayload(body, payload, chatId),
            });
            return;
        }

        if (!force && hasProcessedIncoming(payload)) {
            record(`${source}-duplicate`, {
                payload: summarizePayload(body, payload, chatId),
            });
            return;
        }
        // Atomic mark BEFORE any await so concurrent webhook+poll cannot both pass.
        if (!force) markProcessedIncoming(payload);

        // Sender identification (notifyName lives in _data)
        const senderJid = isGroup ? getPayloadSenderId(payload, chatId) : chatId;
        const senderName = _data.notifyName || payload.notifyName || senderJid.split('@')[0];
        const chatContext = buildRuntimeChatContext({ chatId, senderJid, payload });

        // Enrich with roster summary for group chats
        let roster = null;
        if (isGroup) {
            roster = loadRoster(chatId);
            // Auto-fetch roster if not cached yet (first time in this group)
            if (!roster && groupRosterClient) {
                try {
                    roster = await fetchAndCacheRoster({ client: groupRosterClient, groupId: chatId });
                    if (roster) {
                        console.log(`[Roster] Auto-fetched roster for ${chatId}: ${roster.participants.length} members`);
                    }
                } catch (e) {
                    console.error(`[Roster] Auto-fetch failed for ${chatId}:`, e?.message);
                }
            }
            if (roster && roster.participants) {
                const names = roster.participants
                    .filter(p => p.name)
                    .map(p => `${p.name} (${p.id})`)
                    .slice(0, 20);
                chatContext.rosterSummary = names.length > 0
                    ? `${roster.participants.length} anggota (${names.join(', ')})`
                    : `${roster.participants.length} anggota`;
            }
        }

        // Trigger detection
        const learnedFromIncoming = learnBotMentionFromIncoming(botTriggerState, payload);
        if (learnedFromIncoming.length > 0) {
            record(`${source}-incoming-bot-lid-learned`, {
                learnedBotIdentifiers: learnedFromIncoming,
                payload: summarizePayload(body, payload, chatId, senderJid),
                state: summarizeBotState(),
            });
        }

        const trigger = detectMessageTrigger({ body: msgBody, payload, state: botTriggerState, isDM });
        if (!trigger) {
            // Proactive pipeline (group only)
            if (isGroup) {
                const category = autoCategorize(msgBody);
                if (shouldConsiderProactive({ groupId: chatId, category, msgBody })) {
                    const cooldown = checkProactiveCooldown(chatId);
                    if (cooldown.allowed) {
                        record(`${source}-proactive-candidate`, {
                            category,
                            senderName,
                            chatId,
                            msgPreview: previewText(msgBody),
                        });

                        await withChatLock(chatId, async () => {
                            const canonicalSenderJid = await resolveCanonicalSender(senderJid);
                            const askAI = makeAskAI(chatId, senderName, canonicalSenderJid);

                            // Inject proactive instruction into chatContext
                            chatContext.proactiveMode = true;

                            let reply = await handleNaturalLanguage(msgBody, chatId, senderName, askAI, chatContext, canonicalSenderJid);

                            if (!reply || reply.includes(PROACTIVE_SKIP_MARKER)) {
                                record(`${source}-proactive-skipped`, {
                                    reason: !reply ? 'no-reply' : 'ai-skip',
                                    chatId,
                                });
                                return;
                            }

                            markProactiveSent(chatId);

                            const dms = extractDMs(reply);
                            reply = stripDMTags(reply);

                            if (dms.length > 0) {
                                record(`${source}-proactive-dms-detected`, { count: dms.length });
                                const knownTargets = collectKnownDmTargets({
                                    chatId,
                                    senderJid,
                                    canonicalSenderJid,
                                    roster,
                                });
                                const { blocked } = await sendAllowedDMs({
                                    dms,
                                    knownTargets,
                                    record,
                                    source,
                                    blockedStage: 'proactive-dm-blocked',
                                });
                                reply = appendBlockedDmNotice(reply, blocked);
                            }

                            if (!reply) return; // If the reply was only DMs, don't send an empty message

                            // Mention pipeline (reuse Fase 6)
                            let finalReply = reply;
                            let mentions = [];
                            if (roster && roster.participants) {
                                const intents = extractMentionIntents(reply, roster.participants);
                                if (intents.length > 0) {
                                    const now = Date.now();
                                    const lastMention = mentionCooldownStore.get(chatId);
                                    if (now - lastMention >= MENTION_COOLDOWN_MS) {
                                        const formatted = formatMentionedReply(reply, intents);
                                        finalReply = formatted.text;
                                        mentions = formatted.mentions;
                                        mentionCooldownStore.set(chatId, now);
                                    }
                                }
                            }

                            record(`${source}-proactive-reply`, {
                                chatId,
                                senderName,
                                replyPreview: previewText(finalReply),
                                mentionCount: mentions.length,
                            });
                            await sendWA(finalReply, chatId, mentions);
                        });
                        return;
                    } else {
                        record(`${source}-proactive-cooldown`, {
                            chatId,
                            remainingMs: cooldown.remainingMs,
                        });
                    }
                }
            }

            record(`${source}-no-trigger`, {
                payload: summarizePayload(body, payload, chatId, senderJid),
                state: summarizeBotState(),
            });
            return;
        }
        if (isRateLimited(senderJid)) {
            record(`${source}-rate-limited`, {
                trigger,
                senderName,
                payload: summarizePayload(body, payload, chatId, senderJid),
            });
            return;
        }

        record(`${source}-trigger-detected`, {
            trigger,
            senderName,
            payload: summarizePayload(body, payload, chatId, senderJid),
            state: summarizeBotState(),
        });
        console.log(`[Msg] ${senderName} | ${trigger} | "${msgBody.substring(0, 50)}"`);

        // Process with per-chat lock to prevent race conditions
        await withChatLock(chatId, async () => {
            const canonicalSenderJid = await resolveCanonicalSender(senderJid);
            const askAI = makeAskAI(chatId, senderName, canonicalSenderJid);

            let reply = null;
            if (trigger === 'cmd') {
                reply = await processCommand(msgBody, chatId, askAI);
            } else {
                reply = await handleNaturalLanguage(msgBody, chatId, senderName, askAI, chatContext, canonicalSenderJid);
            }

            if (!reply) {
                record(`${source}-no-reply-generated`, {
                    trigger,
                    senderName,
                    payload: summarizePayload(body, payload, chatId, senderJid),
                });
                return;
            }

            const dms = extractDMs(reply);
            reply = stripDMTags(reply);

            if (dms.length > 0) {
                record(`${source}-dms-detected`, { count: dms.length });
                const knownTargets = collectKnownDmTargets({
                    chatId,
                    senderJid,
                    canonicalSenderJid,
                    roster,
                });
                const { blocked } = await sendAllowedDMs({
                    dms,
                    knownTargets,
                    record,
                    source,
                    blockedStage: 'dm-blocked',
                });
                reply = appendBlockedDmNotice(reply, blocked);
            }

            if (!reply) return; // If the reply was only DMs, don't send an empty message to the chat

            record(`${source}-reply-generated`, {
                trigger,
                senderName,
                chatId,
                replyPreview: previewText(reply),
            });

            // Mention pipeline for group chats
            let mentions = [];
            if (isGroup && roster && roster.participants) {
                const intents = extractMentionIntents(reply, roster.participants);
                if (intents.length > 0) {
                    const now = Date.now();
                    const lastMention = mentionCooldownStore.get(chatId);
                    if (now - lastMention >= MENTION_COOLDOWN_MS) {
                        const formatted = formatMentionedReply(reply, intents);
                        reply = formatted.text;
                        mentions = formatted.mentions;
                        mentionCooldownStore.set(chatId, now);
                        record(`${source}-mentions-applied`, {
                            mentionCount: mentions.length,
                            intents: intents.map(i => ({ matched: i.matchedText, id: i.participant.id })),
                        });
                    } else {
                        record(`${source}-mentions-cooldown`, {
                            chatId,
                            cooldownRemainingMs: MENTION_COOLDOWN_MS - (now - lastMention),
                        });
                    }
                }
            }

            const sendResult = await sendWA(reply, chatId, mentions);
            record(sendResult.ok ? `${source}-reply-sent` : `${source}-reply-send-failed`, {
                trigger,
                senderName,
                chatId,
                error: sendResult.error || null,
            });
        });
    };
};

module.exports = { createWebhookProcessor };
