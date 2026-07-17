export const buildExternalLookupFallback = (product: string, reference: string, businessName = 'toko kami') => {
    const snippets = reference
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line
            && !/^https?:\/\//i.test(line)
            && !/^\d+\./.test(line)
            && !/^(?:REFERENSI|Sumber:|Pakai |Jangan )/i.test(line)
            && !/Search by|Perfume Finder|Fragrantica Pulse|Compare Colors/i.test(line))
        .slice(0, 1)
        .join(' ')
        .slice(0, 360);
    if (!snippets) return `Aku sudah mencari referensi ${product}, Kak, tetapi detailnya belum cukup untuk mencocokkan dengan katalog secara aman. Aku bantu teruskan ke admin ya.`;
    return `Aku sudah mencari referensi ${product}, Kak. ${snippets} Untuk kandidat dari katalog ${businessName}, aku belum mau menebak agar rekomendasinya tidak salah. Aku bantu teruskan ke admin untuk mencocokkan pilihan terdekat ya.`;
};
