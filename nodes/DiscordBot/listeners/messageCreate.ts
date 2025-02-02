import {
    Client,
    Message,
    Role,
} from 'discord.js';
import settings from "./../settings";
import { triggerWorkflow } from '../helper';

export default function (client: Client) {

    const onMessageCreate = async (message: Message) => {

        console.log("****************************");
        console.log("******MESSAGE RECEIVED******")
        console.log("****************************");
    
    
        // iterate through all nodes and see if we need to trigger some                
        for (const [nodeId, data] of Object.entries(settings.triggerNodes) as [string, any]) {
            console.log(nodeId, "checking", data.parameters);
    
            try {
                // ignore messages of other bots
                if (message.author.bot || message.author.system) return;
    
                const pattern = data.parameters.pattern;
    
                // check if executed by the proper role
                const userRoles = message.member?.roles.cache.map((role: Role) => role.id);
                if (data.parameters.roleIds.length) {
                    const hasRole = data.parameters.roleIds.some((role: string) => userRoles?.includes(role));
                    if (!hasRole) return;
                } else {
                    console.log("\tNo user roles found. continuing.");
                }
    
                // check if executed by the proper channel
                if (data.parameters.channelIds.length) {
                    const isInChannel = data.parameters.channelIds.some((channelId: string) => message.channel.id?.includes(channelId));
                    if (!isInChannel) return;
                } else {
                    console.log("\tNo user channels found. continuing.");
                }
    
                // escape the special chars to properly trigger the message
                const escapedTriggerValue = String(data.parameters.value)
                    .replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
                    .replace(/-/g, '\\x2d');
    
                const clientId = client.user?.id;
                const botMention = message.mentions.users.some((user: any) => user.id === clientId);
    
                let regStr = `^${escapedTriggerValue}$`;
    
                // return if we expect a bot mention, but bot is not mentioned
                if (pattern === "botMention" && !botMention)
                    return;
    
                else if (pattern === "start" && message.content)
                    regStr = `^${escapedTriggerValue}`;
                else if (pattern === 'end')
                    regStr = `${escapedTriggerValue}$`;
                else if (pattern === 'contain')
                    regStr = `${escapedTriggerValue}`;
                else if (pattern === 'regex')
                    regStr = `${data.parameters.value}`;
                else if (pattern === 'every')
                    regStr = `(.*)`;
    
                const reg = new RegExp(regStr, data.parameters.caseSensitive ? '' : 'i');
    
                if ((pattern === "botMention" && botMention) || reg.test(message.content)) {
    
                    console.log("\temitting trigger", data, data.baseUrl);

                    await triggerWorkflow(
                        data.webhookId,
                        message,
                        data.parameters.baseUrl,
                      ).catch((e) => e);
    
                    // // Emit the message data to n8n
                    // ipc.server.emit(socket, 'messageCreate', {
                    //     message,
                    //     author: message.author,
                    //     nodeId: nodeId
                    // });
                } else {
                    console.log("\tNo matching regex found.");
                }
    
            } catch (e) {
                console.log(e);
            }
        }
    };

    // Clear existing listeners for `messageCreate`
    client.removeAllListeners('messageCreate');
    // Add new listener for `messageCreate`
    client.on('messageCreate', onMessageCreate);
}