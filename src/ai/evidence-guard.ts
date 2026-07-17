const GUARDED_CLAIMS = [
    { label: 'roll on', pattern: /\broll[\s-]*on\b/i },
    { label: 'spray', pattern: /\bspray\b/i },
] as const;

export const findUnsupportedCatalogClaims = (answer: string, evidence: string) => GUARDED_CLAIMS
    .filter(({ pattern }) => pattern.test(answer) && !pattern.test(evidence))
    .map(({ label }) => label);
