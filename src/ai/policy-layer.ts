// ============================================================================
// Policy Layer for AI Tool Mutations (Fase 8: AI Safety)
// ============================================================================

import { appLogger } from '../config/logger.js';
import type { ToolName } from './tool-validation.js';

export type PolicyDecision = 'allow' | 'deny' | 'require_confirmation';

export interface PolicyContext {
    toolName: ToolName;
    customerJid: string;
    arguments: Record<string, unknown>;
    conversationTurn: number;
    isFirstInteraction: boolean;
}

export interface PolicyResult {
    decision: PolicyDecision;
    reason?: string;
    requiresAudit?: boolean;
}

/**
 * Policy rules for AI tool mutations
 */
export class PolicyEngine {
    private rules: Map<ToolName, (context: PolicyContext) => PolicyResult> = new Map();

    constructor() {
        this.registerDefaultPolicies();
    }

    private registerDefaultPolicies() {
        // Policy: simpanDraftPesanan
        this.rules.set('simpanDraftPesanan', (context) => {
            // Allow draft orders, but require audit
            return {
                decision: 'allow',
                requiresAudit: true,
            };
        });

        // Policy: konfirmasiPesanan
        this.rules.set('konfirmasiPesanan', (context) => {
            // Require confirmation for first-time orders
            if (context.isFirstInteraction) {
                return {
                    decision: 'require_confirmation',
                    reason: 'First order from customer requires validation',
                    requiresAudit: true,
                };
            }
            return {
                decision: 'allow',
                requiresAudit: true,
            };
        });

        // Policy: tandaiSudahBayar
        this.rules.set('tandaiSudahBayar', (context) => {
            // ALWAYS deny AI-initiated payment marking
            return {
                decision: 'deny',
                reason: 'Payment confirmation must be done by admin or webhook only',
                requiresAudit: true,
            };
        });

        // Policy: buatHandoff
        this.rules.set('buatHandoff', (context) => {
            // Allow handoffs, audit high-priority ones
            const priority = context.arguments.priority as string | undefined;
            return {
                decision: 'allow',
                requiresAudit: priority === 'high' || priority === 'urgent',
            };
        });

        // Policy: cekOngkir
        this.rules.set('cekOngkir', (context) => {
            // Rate limit: max 5 shipping checks per conversation
            if (context.conversationTurn > 10) {
                return {
                    decision: 'deny',
                    reason: 'Too many shipping checks in conversation',
                };
            }
            return { decision: 'allow' };
        });

        // Policy: lupakanPercakapan
        this.rules.set('lupakanPercakapan', (context) => {
            // Allow memory reset, but audit it
            return {
                decision: 'allow',
                requiresAudit: true,
            };
        });

        // Policy: cariProdukEksternal
        this.rules.set('cariProdukEksternal', (context) => {
            // Rate limit: max 3 external lookups per conversation
            if (context.conversationTurn > 6) {
                return {
                    decision: 'deny',
                    reason: 'Too many external product lookups',
                };
            }
            return { decision: 'allow' };
        });
    }

    /**
     * Evaluate policy for a tool invocation
     */
    evaluate(context: PolicyContext): PolicyResult {
        const rule = this.rules.get(context.toolName);
        
        if (!rule) {
            // Default: allow read-only tools, require confirmation for mutations
            const mutationTools: ToolName[] = ['simpanDraftPesanan', 'konfirmasiPesanan', 'tandaiSudahBayar', 'buatHandoff', 'lupakanPercakapan'];
            if (mutationTools.includes(context.toolName)) {
                appLogger.warn({ component: 'policy-layer', tool: context.toolName }, 'policy.no_rule_for_mutation');
                return {
                    decision: 'require_confirmation',
                    reason: 'No explicit policy for mutation tool',
                    requiresAudit: true,
                };
            }
            return { decision: 'allow' };
        }

        const result = rule(context);
        
        if (result.decision === 'deny') {
            appLogger.warn(
                { component: 'policy-layer', tool: context.toolName, reason: result.reason },
                'policy.denied'
            );
        }

        return result;
    }

    /**
     * Register custom policy rule
     */
    registerPolicy(toolName: ToolName, rule: (context: PolicyContext) => PolicyResult) {
        this.rules.set(toolName, rule);
    }
}

// Singleton instance
const policyEngine = new PolicyEngine();

export const evaluatePolicy = (context: PolicyContext): PolicyResult => {
    return policyEngine.evaluate(context);
};

export const registerCustomPolicy = (toolName: ToolName, rule: (context: PolicyContext) => PolicyResult) => {
    policyEngine.registerPolicy(toolName, rule);
};
