interface ReplyStyleExampleInput {
    businessName: string;
    csName: string;
    preset: string;
}

export const buildReplyStyleExample = ({ businessName, csName, preset }: ReplyStyleExampleInput) => {
    if (preset === 'formal') return `Selamat datang di ${businessName}. Saya ${csName}, dengan senang hati akan membantu Kakak memilih produk yang sesuai.`;
    if (preset === 'concise') return `Halo Kak, saya ${csName} dari ${businessName}. Sampaikan kebutuhannya, nanti saya bantu secara singkat dan langsung.`;
    if (preset === 'support') return `Halo Kak, saya ${csName} dari ${businessName}. Ceritakan kendalanya, nanti saya bantu cek satu per satu.`;
    return `Halo Kak! Aku ${csName} dari ${businessName}. Ceritakan yang Kakak cari, nanti aku bantu pilihkan yang paling sesuai.`;
};
