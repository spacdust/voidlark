export interface TextToolCall {
    name: string;
    arguments: Record<string, unknown>;
}

const parseValue = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed;
};

export const parseTextToolCalls = (content: string): TextToolCall[] => {
    if (!content.includes('DSML') || !content.includes('tool_calls')) return [];
    const calls: TextToolCall[] = [];
    const invokePattern = /<｜｜DSML｜｜invoke\s+name="([^"]+)">([\s\S]*?)<\/｜｜DSML｜｜invoke>/g;
    for (const invoke of content.matchAll(invokePattern)) {
        const args: Record<string, unknown> = {};
        const parameterPattern = /<｜｜DSML｜｜parameter\s+name="([^"]+)"(?:\s+string="[^"]*")?>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g;
        for (const parameter of invoke[2].matchAll(parameterPattern)) args[parameter[1]] = parseValue(parameter[2]);
        calls.push({ name: invoke[1], arguments: args });
    }
    return calls;
};

export const parseToolArguments = (value: string): Record<string, unknown> => {
    try {
        return JSON.parse(value || '{}') as Record<string, unknown>;
    } catch {
        const result: Record<string, unknown> = {};
        const pairPattern = /"([^"\\]+)"\s*:\s*(?:"((?:\\.|[^"\\])*)"|(true|false|null|-?\d+(?:\.\d+)?))/g;
        for (const pair of value.matchAll(pairPattern)) {
            const raw = pair[2] !== undefined ? pair[2].replace(/\\"/g, '"') : pair[3];
            result[pair[1]] = raw === 'true' ? true : raw === 'false' ? false : raw === 'null' ? null : /^-?\d/.test(raw) ? Number(raw) : raw;
        }
        return result;
    }
};

export const containsInternalMarkup = (content: string) => /(?:<\/?｜｜DSML｜｜|<environment_details>)/i.test(content);

export const stripInternalMarkup = (content: string) => content
    .replace(/<｜｜DSML｜｜tool_calls>[\s\S]*?<\/｜｜DSML｜｜tool_calls>/gi, '')
    .replace(/<environment_details>[\s\S]*?<\/environment_details>/gi, '')
    .replace(/<environment_details>[\s\S]*$/gi, '')
    .trim();
