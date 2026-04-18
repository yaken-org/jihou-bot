import { ActivityType, Client, ClientEvents, FetchMessagesOptions, TextChannel } from "discord.js";
import registerCommands from "../register";
import path from "path";
import {
    JIHOU_TIMING,
    getJihouSlotKey,
    getSecondsUntilNextJihou,
    getUpcomingJihouSlotKey,
    isJihouTiming,
} from "../config/jihouTiming";
import { playNicoInMostPopulatedVoiceChannel } from "../services/jihouVoice";

const name = 'ready' as keyof ClientEvents;
const NICO_MP4_PATH = path.resolve(__dirname, "..", "..", "src", "nico.mp4");

const handler = async (client: Client<true>) => {
    console.log('🥳Logged in as', client.user?.tag);
    client.user?.setActivity('時報', {
        type: ActivityType.Watching,
    });
    await registerCommands();

    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID ?? '') as TextChannel
    if (!channel?.isTextBased()) return;
    const defaultVoiceGuildId = "guildId" in channel ? channel.guildId ?? undefined : undefined;

    channel.messages.fetch({
        limit: 100,
    } as FetchMessagesOptions).then(messages => {
        messages.forEach(message => {
            if (message.author.id === client.user?.id) {
                message.delete();
            }
        });
    }).catch(console.error);

    const now = new Date();
    const remainder = now.getSeconds() % JIHOU_TIMING.startupAlignSeconds;
    const delaySeconds = remainder === 0 ? 0 : JIHOU_TIMING.startupAlignSeconds - remainder;
    if (delaySeconds > 0) {
        console.log(`⏳${delaySeconds}秒待機します`);
        await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));
    }

    let sentMessageId = '';
    let lastAnnouncedSlot = '';
    let lastVoicePlayedSlot = '';
    let isVoicePlaybackRunning = false;

    const triggerVoicePlaybackForSlot = (slotKey: string) => {
        if (slotKey === lastVoicePlayedSlot || isVoicePlaybackRunning) {
            return;
        }

        isVoicePlaybackRunning = true;
        void (async () => {
            try {
                const played = await playNicoInMostPopulatedVoiceChannel(client, defaultVoiceGuildId);
                if (played) {
                    lastVoicePlayedSlot = slotKey;
                    console.log(`🔊 nico.mp3 played for jihou slot ${slotKey}`);
                }
            } finally {
                isVoicePlaybackRunning = false;
            }
        })().catch((error) => {
            console.error("❌ Unexpected error while playing nico.mp3:", error);
            isVoicePlaybackRunning = false;
        });
    };

    setInterval(async() => {
        const now = new Date();
        const secondsUntilNextJihou = getSecondsUntilNextJihou(now);

        if (secondsUntilNextJihou === JIHOU_TIMING.voiceJoinLeadSeconds) {
            triggerVoicePlaybackForSlot(getUpcomingJihouSlotKey(now));
        }

        if (!isJihouTiming(now)) {
            return;
        }

        const currentSlot = getJihouSlotKey(now);
        if (currentSlot === lastAnnouncedSlot) {
            return;
        }
        lastAnnouncedSlot = currentSlot;

        // Fallback: if playback was not started before jihou, try again at the exact timing.
        triggerVoicePlaybackForSlot(currentSlot);

        const hour = now.getHours();
        const minute = now.getMinutes();
        const second = now.getSeconds();

        const message = `🕒時報BOTが${hour}時${minute}分${second}秒をお知らせします。`;
        console.log(message);

        if (sentMessageId) {
            const sentMessage = await channel.messages.fetch(sentMessageId).catch(() => null);
            if (sentMessage) {
                await sentMessage.delete().catch(console.error);
            }
        }

        if (hour === 0) {
            const sentMessage = await channel.send({
                content: message,
                files: [
                    NICO_MP4_PATH,
                ],
            });
            sentMessageId = sentMessage.id;
        } else {
            const sentMessage = await channel.send(message);
            sentMessageId = sentMessage.id;
        }
    }, JIHOU_TIMING.checkIntervalMs);
}

export {
    name,
    handler,
}
