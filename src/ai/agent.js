import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config();
export const openai = new OpenAI({
    baseURL: process.env.AI_API_BASE_URL || 'http://localhost:20128/v1',
    apiKey: process.env.AI_API_KEY || 'dummy_key',
    defaultHeaders: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Voidlark WhatsApp Bot",
    }
});
export const askAgent = async (prompt, context = '') => {
    console.log('Menghubungi AI dengan model:', process.env.AI_MODEL || 'gemini/gemini-2.5-flash');
    try {
        const response = await openai.chat.completions.create({
            model: process.env.AI_MODEL || 'gemini/gemini-2.5-flash',
            messages: [
                {
                    role: 'system',
                    content: 'Kamu adalah CS yang ramah. Jawab dengan bahasa Indonesia santai namun sopan. ' + (context ? `Informasi tambahan: ${context}` : '')
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,
        });
        return response.choices[0].message.content || 'Maaf, saya tidak bisa membalas saat ini.';
    }
    catch (error) {
        console.error('❌ Error saat menghubungi AI:', error);
        return 'Maaf, terjadi kesalahan pada sistem AI kami.';
    }
};
