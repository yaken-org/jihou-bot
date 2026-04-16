const JIHOU_HOURS = [0, 6, 12, 18] as const;

export const JIHOU_TIMING = {
    hours: JIHOU_HOURS,
    minute: 0,
    second: 0,
    checkIntervalMs: 1000,
    startupAlignSeconds: 30,
    voiceJoinLeadSeconds: 3,
} as const;

const sortedHours = [...JIHOU_TIMING.hours].sort((a, b) => a - b);

const pad2 = (value: number) => value.toString().padStart(2, "0");

export function isJihouTiming(date: Date): boolean {
    return (
        JIHOU_TIMING.hours.includes(date.getHours() as (typeof JIHOU_HOURS)[number])
        && date.getMinutes() === JIHOU_TIMING.minute
        && date.getSeconds() === JIHOU_TIMING.second
    );
}

export function getNextJihouDate(base: Date): Date {
    for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
        for (const hour of sortedHours) {
            const candidate = new Date(base);
            candidate.setDate(base.getDate() + dayOffset);
            candidate.setHours(hour, JIHOU_TIMING.minute, JIHOU_TIMING.second, 0);

            if (candidate.getTime() >= base.getTime()) {
                return candidate;
            }
        }
    }

    // JIHOU_HOURS has valid values, so this should be unreachable.
    throw new Error("next jihou timing could not be calculated");
}

export function getSecondsUntilNextJihou(base: Date): number {
    const next = getNextJihouDate(base);
    return Math.ceil((next.getTime() - base.getTime()) / 1000);
}

export function getJihouSlotKey(date: Date): string {
    return [
        date.getFullYear(),
        pad2(date.getMonth() + 1),
        pad2(date.getDate()),
        pad2(date.getHours()),
    ].join("-");
}

export function getUpcomingJihouSlotKey(base: Date): string {
    return getJihouSlotKey(getNextJihouDate(base));
}
