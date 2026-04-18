import {
    AudioPlayerState,
    AudioPlayerStatus,
    DiscordGatewayAdapterCreator,
    NoSubscriberBehavior,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    generateDependencyReport,
    joinVoiceChannel,
} from "@discordjs/voice";
import { ChannelType, Client, Guild, VoiceChannel } from "discord.js";
import fs from "fs";
import path from "path";

const NICO_MP3_PATH = path.resolve(__dirname, "..", "..", "src", "nico.mp3");
const DEFAULT_CONNECTION_READY_TIMEOUT_MS = 20_000;
const DEFAULT_CONNECTION_RETRY_TIMEOUT_MS = 10_000;
const DEFAULT_PLAYBACK_START_TIMEOUT_MS = 15_000;
const DEFAULT_PLAYBACK_FINISH_TIMEOUT_MS = 120_000;
let hasLoggedDependencyReport = false;

type PlayNicoOptions = {
    fallbackGuildId?: string;
    playbackDelayMs?: number;
    connectionReadyTimeoutMs?: number;
    connectionRetryTimeoutMs?: number;
    playbackStartTimeoutMs?: number;
    playbackFinishTimeoutMs?: number;
};

const getTargetGuildId = (fallbackGuildId?: string): string | null => {
    return process.env.DISCORD_TARGET_GUILD_ID ?? fallbackGuildId ?? process.env.DISCORD_GUILD_ID ?? null;
};

const pickMostPopulatedVoiceChannel = (guild: Guild): VoiceChannel | null => {
    const channels = guild.channels.cache
        .filter((channel): channel is VoiceChannel => channel.type === ChannelType.GuildVoice)
        .map((channel) => ({
            channel,
            humanCount: channel.members.filter((member) => !member.user.bot).size,
        }))
        .filter(({ humanCount }) => humanCount > 0)
        .sort((a, b) => {
            if (b.humanCount !== a.humanCount) {
                return b.humanCount - a.humanCount;
            }
            return a.channel.id.localeCompare(b.channel.id);
        });

    return channels[0]?.channel ?? null;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const logDependencyReportOnce = () => {
    if (hasLoggedDependencyReport) {
        return;
    }
    hasLoggedDependencyReport = true;
    console.warn("ℹ️ Voice dependency report:\n" + generateDependencyReport());
};

const waitForConnectionReady = async (
    connection: ReturnType<typeof joinVoiceChannel>,
    readyTimeoutMs: number,
    retryTimeoutMs: number,
): Promise<boolean> => {
    try {
        await entersState(connection, VoiceConnectionStatus.Ready, readyTimeoutMs);
        return true;
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            console.warn("⚠️ Voice connection was not ready in time. Retrying with rejoin...");
            connection.rejoin();
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, retryTimeoutMs);
                return true;
            } catch (retryError) {
                if (retryError instanceof Error && retryError.name === "AbortError") {
                    console.error("❌ Voice connection was still not ready after rejoin retry.");
                } else {
                    console.error("❌ Voice connection failed during retry:", retryError);
                }
                return false;
            }
        }

        console.error("❌ Voice connection failed before playback:", error);
        return false;
    }
};

const playAudioInConnection = (
    connection: ReturnType<typeof joinVoiceChannel>,
    playbackStartTimeoutMs: number,
    playbackFinishTimeoutMs: number,
): Promise<boolean> => {
    const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });
    const resource = createAudioResource(NICO_MP3_PATH);
    const subscription = connection.subscribe(player);

    if (!subscription) {
        console.warn("⚠️ Could not subscribe audio player to voice connection.");
        return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
        let started = false;
        let settled = false;
        let finishTimer: NodeJS.Timeout | null = null;

        const cleanup = () => {
            clearTimeout(startTimer);
            if (finishTimer) {
                clearTimeout(finishTimer);
            }
        };

        const settle = (result: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve(result);
        };

        const startTimer = setTimeout(() => {
            console.warn("⚠️ Audio playback did not start before timeout.");
            logDependencyReportOnce();
            player.stop(true);
            settle(false);
        }, playbackStartTimeoutMs);

        const onStateChange = (oldState: AudioPlayerState, newState: AudioPlayerState) => {
            if (!started && newState.status === AudioPlayerStatus.Playing) {
                started = true;
                clearTimeout(startTimer);

                finishTimer = setTimeout(() => {
                    console.warn("⚠️ Audio playback did not finish before timeout.");
                    player.stop(true);
                    settle(false);
                }, playbackFinishTimeoutMs);
                return;
            }

            if (started && oldState.status === AudioPlayerStatus.Playing && newState.status === AudioPlayerStatus.Idle) {
                settle(true);
                return;
            }

            if (!started && newState.status === AudioPlayerStatus.Idle) {
                console.warn("⚠️ Audio player returned to idle before playback started.");
                logDependencyReportOnce();
                settle(false);
            }
        };

        const onError = (error: Error) => {
            console.error("❌ Audio player error:", error);
            logDependencyReportOnce();
            settle(false);
        };

        player.on("stateChange", onStateChange);
        player.on("error", onError);
        player.play(resource);
    });
};

export async function playNicoInMostPopulatedVoiceChannel(client: Client<true>, options: PlayNicoOptions = {}): Promise<boolean> {
    const {
        fallbackGuildId,
        playbackDelayMs = 0,
        connectionReadyTimeoutMs = DEFAULT_CONNECTION_READY_TIMEOUT_MS,
        connectionRetryTimeoutMs = DEFAULT_CONNECTION_RETRY_TIMEOUT_MS,
        playbackStartTimeoutMs = DEFAULT_PLAYBACK_START_TIMEOUT_MS,
        playbackFinishTimeoutMs = DEFAULT_PLAYBACK_FINISH_TIMEOUT_MS,
    } = options;
    const guildId = getTargetGuildId(fallbackGuildId);
    if (!guildId) {
        console.warn("⚠️ DISCORD_TARGET_GUILD_ID is not set and fallback guild was unavailable.");
        return false;
    }

    if (!fs.existsSync(NICO_MP3_PATH)) {
        console.warn(`⚠️ Audio file not found: ${NICO_MP3_PATH}`);
        return false;
    }

    const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
        console.warn(`⚠️ Guild not found: ${guildId}`);
        return false;
    }

    await guild.channels.fetch();

    const targetVoiceChannel = pickMostPopulatedVoiceChannel(guild);
    if (!targetVoiceChannel) {
        return false;
    }

    const connection = joinVoiceChannel({
        channelId: targetVoiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator,
        selfDeaf: true,
    });

    connection.on("stateChange", (oldState, newState) => {
        if (process.env.VOICE_DEBUG === "1") {
            console.log(`🎙️ Voice state changed: ${oldState.status} -> ${newState.status}`);
        }
    });

    try {
        const scheduledPlaybackStartAt = Date.now() + Math.max(0, playbackDelayMs);

        const isReady = await waitForConnectionReady(
            connection,
            connectionReadyTimeoutMs,
            connectionRetryTimeoutMs,
        );
        if (!isReady) {
            console.warn("⚠️ Proceeding with playback attempt even though connection is not marked Ready.");
        }

        const waitBeforePlayMs = scheduledPlaybackStartAt - Date.now();
        if (waitBeforePlayMs > 0) {
            await sleep(waitBeforePlayMs);
        }

        return playAudioInConnection(connection, playbackStartTimeoutMs, playbackFinishTimeoutMs);
    } catch (error) {
        console.error("❌ Failed to play nico.mp3 in voice channel:", error);
        return false;
    } finally {
        connection.destroy();
    }
}
