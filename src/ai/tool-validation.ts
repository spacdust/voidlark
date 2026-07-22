import { z } from 'zod';

// ============================================================================
// Zod Schemas for Tool Input Validation (Fase 8: AI Safety)
// ============================================================================

export const CekOngkirSchema = z.object({
    cityName: z.string()
        .min(3, 'Tujuan pengiriman minimal 3 karakter')
        .max(200, 'Tujuan pengiriman maksimal 200 karakter')
        .describe('Tujuan pengiriman (kota/kecamatan/kelurahan/alamat lengkap)'),
});

export const SimpanDataPelangganSchema = z.object({
    name: z.string().max(100).optional(),
    phone: z.string().regex(/^(\+?62|0)\d{7,15}$/, 'Format nomor HP tidak valid').optional(),
    address: z.string().max(500).optional(),
    preferences: z.string().max(1000).optional(),
    status: z.enum(['new', 'interested', 'checkout', 'paid', 'shipped', 'completed', 'lost']).optional(),
    notes: z.string().max(1000).optional(),
}).refine(
    (data) => Object.values(data).some((val) => val !== undefined),
    { message: 'Minimal satu field harus diisi' }
);

export const SimpanDraftPesananSchema = z.object({
    stage: z.enum([
        'consulting',
        'aroma_selected',
        'variant_selected',
        'quality_selected',
        'checkout_data',
        'shipping_selected',
        'awaiting_payment',
        'completed',
    ]),
    productName: z.string().max(200).optional(),
    aroma: z.string().max(200).optional(),
    variant: z.string().max(200).optional(),
    quality: z.string().max(100).optional(),
    sizeMl: z.number().int().positive().max(100000).optional(),
    packageSize: z.string().max(100).optional(),
    quantity: z.number().int().positive().max(10000).optional(),
    productPrice: z.number().nonnegative().max(1_000_000_000).optional(),
    options: z.record(z.any()).optional(),
    customerData: z.record(z.any()).optional(),
    customerName: z.string().max(100).optional(),
    phone: z.string().regex(/^(\+?62|0)\d{7,15}$/, 'Format nomor HP tidak valid').optional(),
    address: z.string().max(500).optional(),
    shippingOption: z.string().max(200).optional(),
    shippingCost: z.number().nonnegative().max(10_000_000).optional(),
});

export const KonfirmasiPesananSchema = z.object({
    note: z.string().max(1000).optional(),
});

export const CariReferensiProdukSchema = z.object({
    query: z.string()
        .min(3, 'Query minimal 3 karakter')
        .max(300, 'Query maksimal 300 karakter'),
    forceExternal: z.boolean().optional().default(false),
});

export const EscalateToHumanSchema = z.object({
    reason: z.string()
        .min(10, 'Alasan eskalasi minimal 10 karakter')
        .max(500, 'Alasan eskalasi maksimal 500 karakter'),
});

// ============================================================================
// Validation Function
// ============================================================================

export type ToolName =
    | 'cekOngkir'
    | 'simpanDataPelanggan'
    | 'simpanDraftPesanan'
    | 'konfirmasiPesanan'
    | 'cariReferensiProduk'
    | 'escalateToHuman';

const TOOL_SCHEMAS: Record<ToolName, z.ZodSchema> = {
    cekOngkir: CekOngkirSchema,
    simpanDataPelanggan: SimpanDataPelangganSchema,
    simpanDraftPesanan: SimpanDraftPesananSchema,
    konfirmasiPesanan: KonfirmasiPesananSchema,
    cariReferensiProduk: CariReferensiProdukSchema,
    escalateToHuman: EscalateToHumanSchema,
};

export interface ValidationResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    fieldErrors?: Record<string, string>;
}

/**
 * Validate tool call arguments against Zod schema
 * Returns validated data or error details
 */
export const validateToolArguments = <T = any>(
    toolName: string,
    args: unknown
): ValidationResult<T> => {
    const schema = TOOL_SCHEMAS[toolName as ToolName];
    
    if (!schema) {
        return {
            success: false,
            error: `Tool "${toolName}" tidak memiliki schema validasi`,
        };
    }

    try {
        const result = schema.safeParse(args);
        
        if (!result.success) {
            const fieldErrors: Record<string, string> = {};
            for (const issue of result.error.issues) {
                const path = issue.path.join('.');
                fieldErrors[path] = issue.message;
            }
            
            return {
                success: false,
                error: `Validasi gagal: ${result.error.issues.map(i => i.message).join(', ')}`,
                fieldErrors,
            };
        }

        return {
            success: true,
            data: result.data as T,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown validation error',
        };
    }
};

/**
 * Get the Zod schema for a tool (useful for runtime introspection)
 */
export const getToolSchema = (toolName: ToolName) => TOOL_SCHEMAS[toolName];
