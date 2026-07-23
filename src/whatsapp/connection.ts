import makeWASocket, {
    DisconnectReason,
    downloadContentFromMessage,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    type WASocket,
    type WAMessage,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import { aliasAuthState, claimLegacyAuthState, clearAuthAlias, clearAuthState, hasAuthState, renameAuthState, usePostgresAuthState } from './auth.js';
import { pool } from '../config/db.js';
import { getWaSessionStatus, removeWaSessionStatus, setWaSessionStatus } from './status.js';
import { globalWhatsAppManager } from './whatsapp-manager.js';
import { calculateRandomDelayMs } from './anti-ban-delay.js';

import { DurableInboundWorker, DurableOutboundWorker } from './message-worker.js';
import { PermanentInboundError } from './message-worker.js';
import { messageStore } from './message-store.js';
import { mediaInputStore } from './media-input-store.js';
import {
    materializeInboundMedia,
    extractInboundInput,
    PermanentMediaInputError,
    permanentMediaCustomerResponse,
} from './media-input.js';
import { operationalMetrics } from '../operations/metrics.js';
import { appLogger } from '../config/logger.js';
import { openai } from '../ai/agent.js';
import { toFile } from 'openai/uploads';
import { PerNumberQueue } from './per-number-queue.js';

const logger = pino({ level: 'silent' });

const installLibsignalConsoleFilter = () => {
    const blocked = new Set(['Closing session:', 'Opening session:', 'Session already closed', 'Session already open']);
    for (const level of ['info', 'warn'] as const) {
        const original = console[level];
        if ((original as any).__voidlarkSignalFilter) continue;
        const filtered = (...args: unknown[]) => {
            if (!blocked.has(String(args[0] || ''))) original(...args);
        };
        Object.defineProperty(filtered, '__voidlarkSignalFilter', { value: true });
        console[level] = filtered;
    }
};

export const selectOutboundSessionId = (jid: string, onlineSessionIds: string[]) => {
    const sticky = globalWhatsAppManager.getStickyAssignment(jid);
    const assigned = sticky && onlineSessionIds.includes(sticky) ? sticky : globalWhatsAppManager.assignNumberForLead(jid)?.phone;
    return assigned && onlineSessionIds.includes(assigned) ? assigned : null;
};

const mediaRoot = process.env.INBOUND_MEDIA_ROOT || 'data/inbound-media';
const transcriptionConfigured = () => Boolean(process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY);

const transcribeVoiceNote = async (buffer: Buffer, mimeType: string, fileName: string) => {
    if (!transcriptionConfigured()) throw new PermanentMediaInputError('TRANSCRIPTION_UNAVAILABLE', 'Transkripsi voice note belum dikonfigurasi.');
    const result = await openai.audio.transcriptions.create({
        file: await toFile(buffer, fileName, { type: mimeType }),
        model: process.env.AI_TRANSCRIPTION_MODEL || 'whisper-1',
    });
    return result.text;
};

const activeSockets = new Map<string, WASocket>();
// Pending socket keeps listener identity while its runtime phone key is adopted.
const sessionAliases = new Map<string, string>();
const startingSessions = new Set<string>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const generations = new Map<string, number>();
const socketWorkerStops = new WeakMap<WASocket, () => void>();
const inboundWorkers = new Set<DurableInboundWorker>();
let shuttingDown = false;
let sharedOutboundWorker: DurableOutboundWorker | null = null;
const perNumberOutboundQueue = new PerNumberQueue();

const clearReconnectTimer = (sessionId: string) => {
    const timer = reconnectTimers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    reconnectTimers.delete(sessionId);
};

const endSocket = async (sock: WASocket | null) => {
    if (!sock) return;
    socketWorkerStops.get(sock)?.();
    socketWorkerStops.delete(sock);
    try {
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('creds.update');
        sock.ev.removeAllListeners('messages.upsert');
        sock.ev.removeAllListeners('messages.update');
    } catch {}
    try {
        sock.ws?.close();
    } catch {}
    try {
        sock.end?.(undefined);
    } catch {}
};

const scheduleReconnect = (sessionId: string, delayMs: number, reason: string) => {
    if (shuttingDown) return;
    clearReconnectTimer(sessionId);
    setWaSessionStatus(sessionId, { state: 'connecting', detail: `Reconnect: ${reason}` });
    operationalMetrics.waReconnect(reason.includes('logged out') ? 'logged_out' : reason.includes('conflict') ? 'conflict' : reason.includes('stream') ? 'stream_restart' : reason.includes('expired') ? 'timeout' : 'other');
    appLogger.info({ component: 'whatsapp', delayMs, reason }, 'whatsapp.reconnect_scheduled');
    reconnectTimers.set(sessionId, setTimeout(() => {
        reconnectTimers.delete(sessionId);
        startWhatsAppConnection(sessionId).catch((error) => {
            appLogger.error({ component: 'whatsapp', err: error }, 'whatsapp.reconnect_failed');
            scheduleReconnect(sessionId, 5000, 'retry gagal start');
        });
    }, delayMs));
};

export const startWhatsAppConnection = async (sessionId = 'legacy') => {
    installLibsignalConsoleFilter();
    shuttingDown = false;
    if (startingSessions.has(sessionId)) {
        appLogger.debug({ component: 'whatsapp' }, 'whatsapp.start_skipped');
        return activeSockets.get(sessionId) || null;
    }

    startingSessions.add(sessionId);
    sessionAliases.delete(sessionId);
    clearAuthAlias(sessionId);
    const myGen = (generations.get(sessionId) || 0) + 1;
    generations.set(sessionId, myGen);
    clearReconnectTimer(sessionId);

    try {
        const prev = activeSockets.get(sessionId) || null;
        activeSockets.delete(sessionId);
        await endSocket(prev);

        setWaSessionStatus(sessionId, { state: 'connecting', detail: 'Menyiapkan sesi Baileys' });
        const { state, saveCreds } = await usePostgresAuthState(sessionId);
        const { version, isLatest } = await fetchLatestBaileysVersion();

        if (myGen !== generations.get(sessionId)) return null;

        appLogger.info({ component: 'whatsapp', sessionId, version: version.join('.'), isLatest }, 'whatsapp.version_selected');

        const sock = makeWASocket({
            version,
            logger,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            generateHighQualityLinkPreview: true,
            markOnlineOnConnect: false,
            syncFullHistory: false,
            browser: ['Voidlark', 'Chrome', '1.0.0'],
            getMessage: async () => undefined,
        });

        activeSockets.set(sessionId, sock);
        if (!sharedOutboundWorker) sharedOutboundWorker = new DurableOutboundWorker(async (jid, payload) => {
            const onlineIds = [...activeSockets.keys()].filter((id) => getWaSessionStatus(id).state === 'open');
            const selectedId = selectOutboundSessionId(jid, onlineIds);
            const selected = selectedId ? activeSockets.get(selectedId) : undefined;
            if (!selected) throw new Error('No active WhatsApp socket');
            const config = globalWhatsAppManager.getConfig();
            const delayMs = calculateRandomDelayMs({ minDelaySeconds: config.minDelaySeconds, maxDelaySeconds: config.maxDelaySeconds, typingSpeedMsPerChar: 8 });
            setWaSessionStatus(selectedId!, { outboundQueueDepth: perNumberOutboundQueue.depth(selectedId!) + 1 });
            let sent;
            try {
                sent = await perNumberOutboundQueue.enqueue(selectedId!, delayMs, () => selected.sendMessage(jid, payload as any));
            } finally {
                setWaSessionStatus(selectedId!, { outboundQueueDepth: perNumberOutboundQueue.depth(selectedId!) });
            }
            const phone = [...activeSockets].find(([, socket]) => socket === selected)?.[0];
            if (phone) globalWhatsAppManager.recordMessageSent(phone);
            return sent?.key?.id || null;
        }, {
            postSendHandler: async (action) => {
                const pending = action as { type?: string; jid?: string; reason?: string; notificationDedupeKey?: string };
                if (pending.type !== 'handoff' || !pending.jid || !pending.reason) throw new Error('Invalid post-send handoff action');
                await (await import('../chat/handoff.js')).logHandoff(pending.jid, pending.reason, 'high');
                const operatorJid = (await import('../chat/handoff.js')).getAdminJid();
                if (operatorJid) {
                    const phone = pending.jid.endsWith('@s.whatsapp.net') ? pending.jid.slice(0, -'@s.whatsapp.net'.length) : '';
                    await messageStore.enqueueOutbound(operatorJid, {
                        text: `🚨 *HANDOFF REQUEST*\n\nDari: ${phone ? `wa.me/${phone}` : 'nomor tidak tersedia'}\nJID: ${pending.jid}\nAlasan: ${pending.reason}\n\nBot sudah berhenti auto-reply untuk customer ini.\nBalas "#resolve ${pending.jid}" untuk mengaktifkan bot kembali.`,
                    }, { dedupeKey: pending.notificationDedupeKey || `handoff-after-send:${pending.jid}` });
                } else {
                    await messageStore.enqueuePermanentOutboundFailure('ADMIN_WA_JID', {
                        notificationType: 'handoff',
                        customerJid: pending.jid,
                        reason: pending.reason,
                    }, 'Operator notification not sent: ADMIN_WA_JID is not configured', {
                        dedupeKey: pending.notificationDedupeKey || `handoff-after-send:${pending.jid}`,
                    });
                    appLogger.warn({ component: 'whatsapp', jid: pending.jid }, 'whatsapp.handoff_notification_skipped_no_admin_configured');
                }
            },
        });
        const outboundWorker = sharedOutboundWorker;
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const runtimeSessionId = sessionAliases.get(sessionId) || sessionId;
            if (myGen !== generations.get(sessionId) || activeSockets.get(runtimeSessionId) !== sock) return;

            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                let qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qr)}`;
                try {
                    qrUrl = await QRCode.toDataURL(qr, { margin: 1, width: 260 });
                } catch {}
                setWaSessionStatus(runtimeSessionId, { state: 'qr', detail: 'Scan QR di web admin', qr, qrUrl });
                appLogger.info({ component: 'whatsapp', sessionId: runtimeSessionId }, 'whatsapp.qr_ready');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const boom = lastDisconnect?.error as Boom | undefined;
                const statusCode = boom?.output?.statusCode;
                const conflictType = (boom as any)?.data?.attrs?.type as string | undefined;
                const loggedOut = statusCode === DisconnectReason.loggedOut;
                const replaced = statusCode === DisconnectReason.connectionReplaced
                    || statusCode === 440
                    || conflictType === 'replaced';

                if (statusCode === 408) {
                    setWaSessionStatus(runtimeSessionId, { state: 'qr', detail: 'QR expired, generate ulang' });
                    appLogger.info({ component: 'whatsapp' }, 'whatsapp.qr_expired');
                    scheduleReconnect(sessionId, 1000, 'QR expired');
                    return;
                }

                if (statusCode === 515) {
                    appLogger.info({ component: 'whatsapp' }, 'whatsapp.restart_requested');
                    scheduleReconnect(sessionId, 2000, 'restart stream');
                    return;
                }

                if (loggedOut) {
                    setWaSessionStatus(runtimeSessionId, { state: 'logged_out', detail: 'Logged out' });
                    appLogger.warn({ component: 'whatsapp' }, 'whatsapp.session_logged_out');
                    import('../config/db.js').then(async ({ pool }) => {
                        await clearAuthState(runtimeSessionId);
                        scheduleReconnect(runtimeSessionId, 1500, 'logged out');
                    }).catch((err) => {
                        appLogger.error({ component: 'whatsapp', err }, 'whatsapp.session_cleanup_failed');
                        scheduleReconnect(sessionId, 3000, 'gagal hapus sesi');
                    });
                    return;
                }

                if (replaced) {
                    // Instance lain / reconnect tumpang tindih ganti sesi ini.
                    // Jangan langsung reconnect agresif — biar instance tunggal menang.
                    setWaSessionStatus(runtimeSessionId, { state: 'close', detail: 'Session diganti (conflict replaced)' });
                    appLogger.warn({ component: 'whatsapp' }, 'whatsapp.session_replaced');
                    scheduleReconnect(runtimeSessionId, 8000, 'conflict replaced');
                    return;
                }

                setWaSessionStatus(runtimeSessionId, {
                    state: 'close',
                    detail: `Terputus (${statusCode ?? 'unknown'})`,
                });
                if (runtimeSessionId !== 'legacy') globalWhatsAppManager.setSessionStatus(runtimeSessionId, 'disconnected');
                appLogger.warn({ component: 'whatsapp', statusCode, ...(boom ? { err: boom } : {}) }, 'whatsapp.connection_closed');
                scheduleReconnect(runtimeSessionId, 3000, `close ${statusCode ?? 'unknown'}`);
            } else if (connection === 'open') {
                const meId = sock.user?.id || '';
                const phone = meId.split(':')[0].split('@')[0];
                if (sessionId === 'pending' && !sessionAliases.has(sessionId)) {
                    await renameAuthState('pending', phone);
                    setWaSessionStatus(sessionId, { state: 'open', detail: 'Nomor terbaca. Isi label CS lalu simpan.', phone, qr: undefined, qrUrl: undefined });
                    appLogger.info({ component: 'whatsapp', sessionId, phone }, 'whatsapp.pending_phone_detected');
                } else if (runtimeSessionId !== 'legacy' && phone !== runtimeSessionId) {
                    setWaSessionStatus(runtimeSessionId, { state: 'close', detail: `Nomor QR +${phone} tidak cocok dengan +${runtimeSessionId}` });
                    await stopWhatsAppSession(runtimeSessionId, true);
                    appLogger.error({ component: 'whatsapp', sessionId: runtimeSessionId, connectedPhone: phone }, 'whatsapp.session_phone_mismatch');
                    return;
                }
                setWaSessionStatus(runtimeSessionId, { state: 'open', detail: 'Terhubung', phone, qr: undefined, qrUrl: undefined });
                if (runtimeSessionId !== 'legacy') globalWhatsAppManager.updateSession(runtimeSessionId, { phone, status: 'online' });
                outboundWorker.wake();
                appLogger.info({ component: 'whatsapp', sessionId: runtimeSessionId, phone }, 'whatsapp.connection_open');
            } else if (connection === 'connecting') {
                setWaSessionStatus(runtimeSessionId, { state: 'connecting', detail: 'Menghubungkan...' });
            }
        });

        const processInboundMessage = async (msg: WAMessage) => {
            const runtimeSessionId = sessionAliases.get(sessionId) || sessionId;
            if (myGen !== generations.get(sessionId) || activeSockets.get(runtimeSessionId) !== sock) throw new Error('Stale WhatsApp socket generation');
            if (!msg.message || msg.key.fromMe) return;

            const jid = msg.key.remoteJid!;
            if (runtimeSessionId !== 'legacy' && runtimeSessionId !== 'pending') globalWhatsAppManager.setStickyAssignment(jid, runtimeSessionId);
            appLogger.info({ component: 'whatsapp', messageId: msg.key.id || undefined }, 'whatsapp.message_received');

            try {
                const input = await materializeInboundMedia(msg, {
                    rootDirectory: mediaRoot,
                    download: async (media) => downloadContentFromMessage(
                        media.message as any,
                        media.kind === 'voice' ? 'audio' : media.kind,
                    ),
                    transcribe: transcribeVoiceNote,
                });
                const text = input.text;
                if (input.media && msg.key.id) {
                    await mediaInputStore.save({ providerMessageId: msg.key.id, jid, ...input.media });
                }
                const { isHandoffActive, resolveHandoff, getAdminJid } = await import('../chat/handoff.js');
                const adminJid = getAdminJid();

                if (adminJid && jid === adminJid) {
                    if (text.startsWith('#resolve ')) {
                        const targetJid = text.replace('#resolve ', '').trim();
                        await resolveHandoff(targetJid);
                        await outboundWorker.enqueue(jid, { text: `✅ Handoff untuk ${targetJid} sudah di-resolve. Bot kembali aktif untuk customer tsb.` }, `resolve:${msg.key.id}`);
                        return;
                    }
                    if (text.startsWith('#paid ')) {
                        const { markOrderPaid } = await import('../chat/orders.js');
                        const parts = text.replace('#paid ', '').trim().split(/\s+/);
                        const targetJid = parts[0];
                        const orderId = parts[1] ? Number(parts[1]) : undefined;
                        const paid = await markOrderPaid(targetJid, Number.isFinite(orderId as number) ? orderId : undefined);
                        if (!paid.ok) {
                            await outboundWorker.enqueue(jid, { text: `❌ ${paid.error}` }, `paid-error:${msg.key.id}`);
                            return;
                        }
                        await outboundWorker.enqueue(jid, { text: `✅ Pesanan #${paid.order.id} ditandai lunas.\n${paid.summary}` }, `paid-admin:${msg.key.id}`);
                        await outboundWorker.enqueue(targetJid, {
                            text: `Kak, pembayaran order #${paid.order.id} sudah kami terima. Tim akan proses pesanan ya. Terima kasih!`,
                        }, `paid-customer:${paid.order.id}`);
                        return;
                    }
                }

                const { saveMessage, getChatHistory } = await import('../chat/history.js');
                await saveMessage(jid, 'user', text);

                const { consentService, detectConsentCommand } = await import('../chat/consent.js');
                const consentCommand = detectConsentCommand(text);
                if (consentCommand) {
                    const consent = (await import('../config/business.js')).getBusinessConfig().consent;
                    const optedIn = consentCommand === 'opt_in';
                    await consentService.set(jid, optedIn);
                    const response = optedIn ? consent.optInResponse : consent.optOutResponse;
                    await saveMessage(jid, 'assistant', response);
                    await outboundWorker.enqueue(jid, { text: response }, `consent:${consentCommand}:${msg.key.id}`);
                    return;
                }

                if (await isHandoffActive(jid)) {
                    appLogger.info({ component: 'whatsapp', messageId: msg.key.id || undefined }, 'whatsapp.auto_reply_skipped_handoff');
                    return;
                }

                const { getBusinessHoursState, outOfHoursReply } = await import('../chat/business-hours.js');
                const hours = (await import('../config/business.js')).getBusinessConfig().businessHours;
                if (!getBusinessHoursState(new Date(), hours).open) {
                    if (hours.handoffPolicy === 'create') await (await import('../chat/handoff.js')).logHandoff(jid, 'Pesan diterima di luar jam operasional', 'normal');
                    const response = outOfHoursReply(hours);
                    await saveMessage(jid, 'assistant', response);
                    await outboundWorker.enqueue(jid, { text: response }, `out-of-hours:${msg.key.id}`);
                    return;
                }

                const { askAgent } = await import('../ai/agent.js');
                const { getKnowledgeBase } = await import('../ai/knowledge.js');
                const { getChatState, getDraftOrder } = await import('../chat/orders.js');

                const history = await getChatHistory(jid);
                const previousHistory = history.slice(0, -1);

                const chatState = await getChatState(jid);
                const draftOrder = await getDraftOrder(jid);
                const knowledgeContext = `${getKnowledgeBase()}\n\nCUSTOMER STATE:\n${JSON.stringify({ state: chatState, draftOrder }, null, 2)}`;
                const defaultCsName = (await import('../config/business.js')).getBusinessConfig().csName;
                const effectiveCsName = runtimeSessionId === 'legacy' || runtimeSessionId === 'pending'
                    ? defaultCsName
                    : globalWhatsAppManager.getEffectiveCsName(runtimeSessionId, defaultCsName);
                const result = await askAgent(text, knowledgeContext, previousHistory, jid, effectiveCsName);

                await saveMessage(jid, 'assistant', result.text);
                await outboundWorker.enqueue(jid, { text: result.text }, `reply:${msg.key.id}`, 'transactional', result.postPaymentHandoff ? {
                    type: 'handoff',
                    jid,
                    reason: result.postPaymentHandoff.reason,
                    notificationDedupeKey: `handoff-admin:${msg.key.id}`,
                } : undefined);

                if (result.postPaymentHandoff) {
                    appLogger.info({ component: 'whatsapp', messageId: msg.key.id || undefined }, 'whatsapp.post_payment_handoff_deferred');
                }

                if (result.orderConfirmed && adminJid) {
                    const customerPhone = jid.replace('@s.whatsapp.net', '').replace(/@.+$/, '');
                    await outboundWorker.enqueue(adminJid, {
                        text: `🛒 ORDER BARU #${result.orderConfirmed.orderId}\n\nDari: wa.me/${customerPhone}\nJID: ${jid}\n\n${result.orderConfirmed.summary}\n\nStatus: awaiting_payment\nTandai lunas: #paid ${jid}`,
                    }, `order-admin:${result.orderConfirmed.orderId}`);
                    appLogger.info({ component: 'whatsapp', orderId: result.orderConfirmed.orderId }, 'whatsapp.order_notification_enqueued');
                } else if (result.orderConfirmed) {
                    await messageStore.enqueuePermanentOutboundFailure('ADMIN_WA_JID', {
                        notificationType: 'order',
                        customerJid: jid,
                        orderId: result.orderConfirmed.orderId,
                        summary: result.orderConfirmed.summary,
                    }, 'Operator notification not sent: ADMIN_WA_JID is not configured', {
                        dedupeKey: `order-admin:${result.orderConfirmed.orderId}`,
                    });
                    appLogger.error({ component: 'whatsapp', orderId: result.orderConfirmed.orderId }, 'whatsapp.order_notification_dead_lettered');
                }

                if (result.handoff && adminJid) {
                    const customerPhone = jid.replace('@s.whatsapp.net', '');
                    await outboundWorker.enqueue(adminJid, {
                        text: `🚨 *HANDOFF REQUEST*\n\nDari: wa.me/${customerPhone}\nJID: ${jid}\nAlasan: ${result.handoff.reason}\n\nBot sudah berhenti auto-reply untuk customer ini.\nBalas "#resolve ${jid}" untuk mengaktifkan bot kembali.`,
                    }, `handoff-admin:${msg.key.id}`);
                    appLogger.info({ component: 'whatsapp', messageId: msg.key.id || undefined }, 'whatsapp.handoff_notification_enqueued');
                } else if (result.handoff) {
                    await messageStore.enqueuePermanentOutboundFailure('ADMIN_WA_JID', {
                        notificationType: 'handoff',
                        customerJid: jid,
                        reason: result.handoff.reason,
                    }, 'Operator notification not sent: ADMIN_WA_JID is not configured', {
                        dedupeKey: `handoff-admin:${msg.key.id}`,
                    });
                    appLogger.error({ component: 'whatsapp', messageId: msg.key.id || undefined }, 'whatsapp.handoff_notification_dead_lettered');
                }
            } catch (error) {
                if (error instanceof PermanentMediaInputError && msg.key.id) {
                    await mediaInputStore.recordPermanentFailure(msg.key.id, jid, permanentMediaCustomerResponse, error.code);
                    try {
                        const failedInput = await extractInboundInput(msg);
                        if (failedInput.media) {
                            await mediaInputStore.save({
                                providerMessageId: msg.key.id,
                                jid,
                                ...failedInput.media,
                                status: 'failed',
                                errorCode: error.code,
                            });
                        }
                    } catch {}
                    await outboundWorker.enqueue(jid, { text: permanentMediaCustomerResponse }, `media-failure-customer:${msg.key.id}`);
                    const { getAdminJid, logHandoff } = await import('../chat/handoff.js');
                    await logHandoff(jid, `Media input gagal permanen: ${error.code}`);
                    const adminJid = getAdminJid();
                    const payload = { text: `Media customer gagal diproses.\nJID: ${jid}\nMessage: ${msg.key.id}\nError: ${error.code}` };
                    if (adminJid) await outboundWorker.enqueue(adminJid, payload, `media-failure-admin:${msg.key.id}`);
                    else await messageStore.enqueuePermanentOutboundFailure('ADMIN_WA_JID', payload, 'Operator notification not sent: ADMIN_WA_JID is not configured', { dedupeKey: `media-failure-admin:${msg.key.id}` });
                    throw new PermanentInboundError(`${error.code}: ${error.message}`);
                }
                appLogger.error({ component: 'whatsapp', err: error, messageId: msg.key.id || undefined }, 'whatsapp.message_processing_failed');
                throw error;
            }
        };

        const inboundWorker = new DurableInboundWorker(processInboundMessage);
        inboundWorkers.add(inboundWorker);
        socketWorkerStops.set(sock, () => {
            inboundWorker.stop();
            inboundWorkers.delete(inboundWorker);
        });
        inboundWorker.wake();
        sock.ev.on('messages.upsert', async (m) => {
            const runtimeSessionId = sessionAliases.get(sessionId) || sessionId;
            if (myGen !== generations.get(sessionId) || activeSockets.get(runtimeSessionId) !== sock) return;
            await inboundWorker.enqueue(m.messages);
        });
        sock.ev.on('messages.update', async (updates) => {
            for (const { key, update } of updates) {
                if (!key.id || update.status == null) continue;
                if (Number(update.status) >= 4) await messageStore.updateOutboundReceipt(key.id, 'read');
                else if (Number(update.status) >= 3) await messageStore.updateOutboundReceipt(key.id, 'delivered');
            }
        });
        sock.ev.on('connection.update', ({ connection }) => {
            if (connection === 'close') inboundWorker.stop();
        });

        return sock;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        setWaSessionStatus(sessionId, { state: 'error', detail: `Gagal menyiapkan WhatsApp: ${detail}` });
        appLogger.error({ component: 'whatsapp', sessionId, err: error }, 'whatsapp.session_start_failed');
        throw error;
    } finally {
        startingSessions.delete(sessionId);
    }
};

export const stopWhatsAppSession = async (sessionId: string, clearAuth = false) => {
    generations.set(sessionId, (generations.get(sessionId) || 0) + 1);
    clearReconnectTimer(sessionId);
    const socket = activeSockets.get(sessionId) || null;
    activeSockets.delete(sessionId);
    for (const [source, target] of sessionAliases) if (source === sessionId || target === sessionId) sessionAliases.delete(source);
    await endSocket(socket);
    removeWaSessionStatus(sessionId);
    if (clearAuth) await clearAuthState(sessionId);
};

export const adoptPendingWhatsAppSession = (phone: string) => {
    const pending = activeSockets.get('pending');
    if (!pending) return false;
    activeSockets.delete('pending');
    activeSockets.set(phone, pending);
    sessionAliases.set('pending', phone);
    aliasAuthState('pending', phone);
    generations.set(phone, generations.get('pending') || 1);
    return true;
};

export const startConfiguredWhatsAppConnections = async () => {
    const sessions = globalWhatsAppManager.getSessions();
    if (!sessions.length) {
        if (await hasAuthState('legacy')) await startWhatsAppConnection('legacy');
        return;
    }
    const ready: string[] = [];
    for (const session of sessions) {
        if (await claimLegacyAuthState(session.phone) || await hasAuthState(session.phone)) ready.push(session.phone);
    }
    await Promise.allSettled(ready.map((phone) => startWhatsAppConnection(phone)));
};

export const checkWhatsAppCredentialsExist = async () => {
    try {
        return (await Promise.all([hasAuthState('legacy'), ...globalWhatsAppManager.getSessions().map((session) => hasAuthState(session.phone))])).some(Boolean);
    } catch { return false; }
};

export const stopWhatsAppConnection = async () => {
    shuttingDown = true;
    sharedOutboundWorker?.stop();
    sharedOutboundWorker = null;
    await Promise.all([...activeSockets.keys()].map((sessionId) => stopWhatsAppSession(sessionId)));
};

export const drainWhatsAppWorkers = async (timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    const remaining = () => Math.max(1, deadline - Date.now());
    const inbound = [...inboundWorkers].map((worker) => worker.drain(remaining()));
    const outbound = sharedOutboundWorker ? [sharedOutboundWorker.drain(remaining())] : [];
    return (await Promise.all([...inbound, ...outbound])).every(Boolean);
};
