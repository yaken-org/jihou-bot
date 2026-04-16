import {
    AudioPlayerStatus,
    DiscordGatewayAdapterCreator,
    NoSubscriberBehavior,
    VoiceConnectionStatus,
    createAudioPlayer,
    createAudioResource,
    entersState,
    joinVoiceChannel,
} from "@discordjs/voice";
import { ChannelType, Client, Guild, VoiceChannel } from "discord.js";
import fs from "fs";
import path from "path";

const NICO_MP3_PATH = path.resolve(__dirname, "..", "..", "src", "nico.mp3");

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

export async function playNicoInMostPopulatedVoiceChannel(client: Client<true>, fallbackGuildId?: string): Promise<boolean> {
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

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

        const player = createAudioPlayer({
            behaviors: { noSubscriber: NoSubscriberBehavior.Play },
        });
        const resource = createAudioResource(NICO_MP3_PATH);

        connection.subscribe(player);

        player.play(resource);
        await entersState(player, AudioPlayerStatus.Playing, 10_000);
        await entersState(player, AudioPlayerStatus.Idle, 120_000);
        return true;
    } catch (error) {
        console.error("❌ Failed to play nico.mp3 in voice channel:", error);
        return false;
    } finally {
        connection.destroy();
    }
}
