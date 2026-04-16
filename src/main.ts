import { Client, GatewayIntentBits } from "discord.js";
import dotenv from "dotenv";
import events from "./events";

dotenv.config();


const client = new Client({
    intents: [
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
    ]
})

console.group('📚Loading events');
events.forEach((event) => {
    console.log(`📖Loading event: ${event.name}`);
    client.on(event.name, event.handler);
    console.log(`✅Loaded event: ${event.name}`);
});
console.groupEnd();

client.login(process.env.DISCORD_BOT_TOKEN ?? '');
