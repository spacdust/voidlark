import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import pino from 'pino';
import { usePostgresAuthState } from './auth.js';
const logger = pino({ level: 'silent' });
export const startWhatsAppConnection = async () => {
    const { state, saveCreds } = await usePostgresAuthState();
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`Menggunakan WA v${version.join('.')}, isLatest: ${isLatest}`);
    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: true,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        generateHighQualityLinkPreview: true,
    });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                startWhatsAppConnection();
            }
            else {
                console.log('Sesi telah di-logout, silahkan hapus data sesi dari database dan scan ulang.');
            }
        }
        else if (connection === 'open') {
            console.log('✅ Berhasil terhubung ke WhatsApp!');
        }
    });
    // Menangkap pesan masuk (sementara untuk uji coba)
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe)
            return;
        console.log('Pesan masuk dari:', msg.key.remoteJid);
        // Cek jika ini adalah pesan teks
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (text) {
            console.log(`Isi pesan: ${text}`);
            // Menghubungi AI untuk auto-reply
            const { askAgent } = await import('../ai/agent.js');
            const aiResponse = await askAgent(text);
            await sock.sendMessage(msg.key.remoteJid, {
                text: aiResponse
            });
        }
    });
    return sock;
};
