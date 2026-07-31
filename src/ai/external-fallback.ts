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
    if (!snippets) return `Aku sudah mencari referensi ${product}, Kak, tetapi detailnya belum cukup untuk mencocokkan dengan katalog ${businessName} tanpa berisiko salah.`;
    const detail = snippets.replace(/[.!?]+$/, '');
    return `Aku sudah menemukan referensi ${product}, Kak: ${detail}. Produk referensi itu tidak dijual langsung; datanya hanya dipakai untuk mencocokkan karakter dengan produk di katalog ${businessName}. Untuk kandidat internalnya, aku belum mau menebak sebelum hasil pencocokannya cukup jelas.`;
};
