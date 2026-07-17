import { getBusinessConfig, type BusinessHoursConfig, type Weekday } from '../config/business.js';

const weekdays: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const minute = (value: string) => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return -1;
    const result = Number(match[1]) * 60 + Number(match[2]);
    return result >= 0 && result < 1440 ? result : -1;
};

export interface BusinessHoursState { open: boolean; localDate: string; localTime: string; weekday: Weekday; reason: 'open' | 'closed' | 'holiday' }

export const validateBusinessHoursConfig = (config: BusinessHoursConfig) => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }).format(); } catch { throw new Error('Timezone jam operasional tidak valid.'); }
    for (const ranges of Object.values(config.weekly)) {
        for (const range of ranges) {
            const parts = range.split('-');
            if (parts.length !== 2 || minute(parts[0]) < 0 || minute(parts[1]) < 0 || parts[0] === parts[1]) throw new Error(`Rentang jam operasional tidak valid: ${range}`);
        }
    }
    if (config.holidays.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))) throw new Error('Tanggal libur jam operasional tidak valid.');
    if (Object.values(config.slaMinutes).some((value) => !Number.isFinite(value) || value <= 0)) throw new Error('SLA handoff harus berupa menit positif.');
    return config;
};

export const getBusinessHoursState = (at = new Date(), config: BusinessHoursConfig = getBusinessConfig().businessHours): BusinessHoursState => {
    let parts: Intl.DateTimeFormatPart[];
    try {
        parts = new Intl.DateTimeFormat('en-US', {
            timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
        }).formatToParts(at);
    } catch {
        throw new Error(`Invalid business timezone: ${config.timezone}`);
    }
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
    const localDate = `${part('year')}-${part('month')}-${part('day')}`;
    const localTime = `${part('hour')}:${part('minute')}`;
    const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
    const weekday = weekdays[Math.max(0, dayIndex)];
    if (!config.enabled) return { open: true, localDate, localTime, weekday, reason: 'open' };
    if (config.holidays.includes(localDate)) return { open: false, localDate, localTime, weekday, reason: 'holiday' };
    const current = minute(localTime);
    const rangesOpen = (ranges: string[], allowAfterMidnight: boolean) => ranges.some((range) => {
        const [startText, endText] = range.split('-');
        const start = minute(startText); const end = minute(endText);
        if (start < 0 || end < 0) return false;
        if (end > start) return current >= start && current < end;
        return allowAfterMidnight ? current < end : current >= start;
    });
    const dayIndexInWeek = weekdays.indexOf(weekday);
    const previousDay = weekdays[(dayIndexInWeek + weekdays.length - 1) % weekdays.length];
    const open = rangesOpen(config.weekly[weekday] || [], false)
        || rangesOpen((config.weekly[previousDay] || []).filter((range) => minute(range.split('-')[1]) <= minute(range.split('-')[0])), true);
    return { open, localDate, localTime, weekday, reason: open ? 'open' : 'closed' };
};

export const outOfHoursReply = (config = getBusinessConfig().businessHours) =>
    `${config.outOfHoursResponse.trim()} ${config.responseEstimate.trim()}`.trim();
