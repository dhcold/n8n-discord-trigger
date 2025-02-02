import {
    Client, GatewayIntentBits, Role, GuildBasedChannel, ChannelType,Guild,
    EmbedBuilder,
    ColorResolvable,
    AttachmentBuilder,
    TextChannel,
} from 'discord.js';
import ipc from 'node-ipc';
import {
    ICredentials,
} from './helper';
import setupOnMessageCreate from './listeners/messageCreate';
import { IDiscordInteractionMessageParameters, IDiscordNodeActionParameters } from '../DiscordInteraction/DiscordInteraction.node';
import settings from './settings';

export default function () {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildMembers,
            GatewayIntentBits.GuildPresences,
            GatewayIntentBits.GuildModeration,
            GatewayIntentBits.GuildMessageReactions,
            GatewayIntentBits.GuildMessageTyping,
        ],
        allowedMentions: {
            parse: ['roles', 'users', 'everyone'],
        },
    });

    client.once('ready', () => {
        console.log(`Logged in as ${client.user?.tag}`);
    });



    ipc.config.id = 'bot';
    ipc.config.retry = 1500;
    ipc.config.silent = true;

    // nodes are executed in a child process, the Discord bot is executed in the main process
    // so it's not stopped when a node execution end
    // we use ipc to communicate between the node execution process and the bot
    // ipc is serving in the main process & childs connect to it using the ipc client
    ipc.serve(function () {
        console.log(`ipc bot server started`);

        ipc.server.on('triggerNodeRegistered', (data: any, socket: any) => {

            // set the specific node parameters for a later iteration when we get messages
            settings.triggerNodes[data.nodeId] = data;
            console.log(`registering ${data.nodeId}:`, data);

            setupOnMessageCreate(client);
        });



        ipc.server.on('list:roles', (data: undefined, socket: any) => {
            try {
                if (settings.ready) {
                    const guild = client.guilds.cache.first();
                    const roles = guild?.roles.cache ?? ([] as any);

                    const rolesList = roles.map((role: Role) => {
                        return {
                            name: role.name,
                            value: role.id,
                        };
                    });
                    
                    ipc.server.emit(socket, 'list:roles', rolesList);
                }
            } catch (e) {
                console.log(`${e}`);
            }
        });



        ipc.server.on('list:guilds', (data: undefined, socket: any) => {
            try {
                if (settings.ready) {

                    const guilds = client.guilds.cache ?? ([] as any);
                    const guildsList = guilds.map((guild: Guild) => {
                        return {
                            name: guild.name,
                            value: guild.id,
                        };
                    });

                    ipc.server.emit(socket, 'list:guilds', guildsList);
                }
            } catch (e) {
                console.log(`${e}`);
            }
        });



        ipc.server.on('list:channels', (data: undefined, socket: any) => {
            try {
                if (settings.ready) {
                    const guild = client.guilds.cache.first();
                    const channels =
                        guild?.channels.cache.filter((c) => c.type === ChannelType.GuildText) ?? ([] as any);

                    const channelsList = channels.map((channel: GuildBasedChannel) => {
                        return {
                            name: channel?.name,
                            value: channel.id,
                        };
                    });

                    ipc.server.emit(socket, 'list:channels', channelsList);
                }
            } catch (e) {
                console.log(`${e}`);
            }
        });




        ipc.server.on('credentials', (data: ICredentials, socket: any) => {
            try {
                if (
                    (!settings.login && !settings.ready) ||
                    (settings.ready && (settings.clientId !== data.clientId || settings.token !== data.token))
                ) {
                    if (data.token && data.clientId) {
                        settings.login = true;
                        client.destroy();
                        client
                            .login(data.token)
                            .then(() => {
                                // set token for rest api aswell
                                client.rest.setToken(data.token);

                                settings.ready = true;
                                settings.login = false;
                                settings.clientId = data.clientId;
                                settings.token = data.token;
                                console.log("Client token2: ", client.isReady());
                                ipc.server.emit(socket, 'credentials', 'ready');
                            })
                            .catch((e) => {
                                settings.login = false;
                                ipc.server.emit(socket, 'credentials', 'error');
                            });
                    } else {
                        ipc.server.emit(socket, 'credentials', 'missing');
                        console.log(`credentials missing`);
                    }
                } else if (settings.login) {
                    ipc.server.emit(socket, 'credentials', 'login');
                    console.log(`credentials login`);
                } else {
                    ipc.server.emit(socket, 'credentials', 'already');
                }
            } catch (e) {
                console.log(`${e}`);
            }
        });

        ipc.server.on('send:message', async (nodeParameters: IDiscordInteractionMessageParameters, socket: any) => {
            try {
                if (settings.ready) {

                    // fetch channel
                    const channel = <TextChannel>client.channels.cache.get(nodeParameters.channelId);
                    if (!channel || !channel.isTextBased()) return;

                    // prepare embed messages, if they are set by the client
                    const embedFiles = [];
                    let embed: EmbedBuilder | undefined;
                    if (nodeParameters.embed) {
                        embed = new EmbedBuilder();
                        if (nodeParameters.title) embed.setTitle(nodeParameters.title);
                        if (nodeParameters.url) embed.setURL(nodeParameters.url);
                        if (nodeParameters.description) embed.setDescription(nodeParameters.description);
                        if (nodeParameters.color) embed.setColor(nodeParameters.color as ColorResolvable);
                        if (nodeParameters.timestamp)
                            embed.setTimestamp(Date.parse(nodeParameters.timestamp));
                        if (nodeParameters.footerText) {
                            let iconURL = nodeParameters.footerIconUrl;
                            if (iconURL && iconURL.match(/^data:/)) {
                                const buffer = Buffer.from(iconURL.split(',')[1], 'base64');
                                const reg = new RegExp(/data:image\/([a-z]+);base64/gi);
                                let mime = reg.exec(nodeParameters.footerIconUrl) ?? [];
                                const file = new AttachmentBuilder(buffer, { name: `footer.${mime[1]}` });
                                embedFiles.push(file);
                                iconURL = `attachment://footer.${mime[1]}`;
                            }
                            embed.setFooter({
                                text: nodeParameters.footerText,
                                ...(iconURL ? { iconURL } : {}),
                            });
                        }
                        if (nodeParameters.imageUrl) {
                            if (nodeParameters.imageUrl.match(/^data:/)) {
                                const buffer = Buffer.from(nodeParameters.imageUrl.split(',')[1], 'base64');
                                const reg = new RegExp(/data:image\/([a-z]+);base64/gi);
                                let mime = reg.exec(nodeParameters.imageUrl) ?? [];
                                const file = new AttachmentBuilder(buffer, { name: `image.${mime[1]}` });
                                embedFiles.push(file);
                                embed.setImage(`attachment://image.${mime[1]}`);
                            } else embed.setImage(nodeParameters.imageUrl);
                        }
                        if (nodeParameters.thumbnailUrl) {
                            if (nodeParameters.thumbnailUrl.match(/^data:/)) {
                                const buffer = Buffer.from(nodeParameters.thumbnailUrl.split(',')[1], 'base64');
                                const reg = new RegExp(/data:image\/([a-z]+);base64/gi);
                                let mime = reg.exec(nodeParameters.thumbnailUrl) ?? [];
                                const file = new AttachmentBuilder(buffer, { name: `thumbnail.${mime[1]}` });
                                embedFiles.push(file);
                                embed.setThumbnail(`attachment://thumbnail.${mime[1]}`);
                            } else embed.setThumbnail(nodeParameters.thumbnailUrl);
                        }
                        if (nodeParameters.authorName) {
                            let iconURL = nodeParameters.authorIconUrl;
                            if (iconURL && iconURL.match(/^data:/)) {
                                const buffer = Buffer.from(iconURL.split(',')[1], 'base64');
                                const reg = new RegExp(/data:image\/([a-z]+);base64/gi);
                                let mime = reg.exec(nodeParameters.authorIconUrl) ?? [];
                                const file = new AttachmentBuilder(buffer, { name: `author.${mime[1]}` });
                                embedFiles.push(file);
                                iconURL = `attachment://author.${mime[1]}`;
                            }
                            embed.setAuthor({
                                name: nodeParameters.authorName,
                                ...(iconURL ? { iconURL } : {}),
                                ...(nodeParameters.authorUrl ? { url: nodeParameters.authorUrl } : {}),
                            });
                        }
                        if (nodeParameters.fields?.field) {
                            nodeParameters.fields.field.forEach(
                                (field: { name?: string; value?: string; inline?: boolean }) => {
                                    if (embed && field.name && field.value)
                                        embed.addFields({
                                            name: field.name,
                                            value: field.value,
                                            inline: field.inline,
                                        });
                                    else if (embed) embed.addFields({ name: '\u200B', value: '\u200B' });
                                },
                            );
                        }
                    }

                    // add all the mentions at the end of the message
                    let mentions = '';
                    nodeParameters.mentionRoles.forEach((role: string) => {
                        mentions += ` <@&${role}>`;
                    });

                    let content = '';
                    if (nodeParameters.content) content += nodeParameters.content;
                    if (mentions) content += mentions;

                    // if there are files, add them aswell
                    let files: any[] = [];
                    if (nodeParameters.files?.file) {
                        files = nodeParameters.files?.file.map((file: { url: string }) => {
                            if (file.url.match(/^data:/)) {
                                return Buffer.from(file.url.split(',')[1], 'base64');
                            }
                            return file.url;
                        });
                    }
                    if (embedFiles.length) files = files.concat(embedFiles);

                    // prepare the message object how discord likes it
                    const sendObject = {
                        content: content ?? '',
                        ...(embed ? { embeds: [embed] } : {}),
                        ...(files.length ? { files } : {}),
                    };

                    // finally send the message and report back to the listener
                    const message = await channel.send(sendObject);
                    ipc.server.emit(socket, 'callback:send:message', {
                        channelId: channel.id,
                        messageId: message.id
                    });
                }
            } catch (e) {
                console.log(`${e}`);
                ipc.server.emit(socket, 'callback:send:message', false);
            }
        });


        ipc.server.on('send:action', async (nodeParameters: IDiscordNodeActionParameters, socket: any) => {
            try {
                if (settings.ready) {
                    const performAction = async () => {
                        // remove messages
                        if (nodeParameters.actionType === 'removeMessages') {
                            const channel = <TextChannel>client.channels.cache.get(nodeParameters.channelId);
                            if (!channel || !channel.isTextBased()) {
                                ipc.server.emit(socket, `callback:send:action`, false);;
                                return;
                            }

                            await channel.bulkDelete(nodeParameters.removeMessagesNumber).catch((e: any) => console.log(`${e}`, client));
                        }

                        // add or remove roles
                        else if (['addRole', 'removeRole'].includes(nodeParameters.actionType)) {
                            const guild = await client.guilds.cache.get(nodeParameters.guildId);
                            if (!guild) {
                                ipc.server.emit(socket, `callback:send:action`, false);
                                return;
                            }

                            const user = await client.users.fetch(nodeParameters.userId as string);
                            const guildMember = await guild.members.fetch(user);
                            const roles = guildMember.roles;

                            // Split the roles that are set in the parameters into individual ones or initialize as empty if no roles are set.
                            const roleUpdateIds = (typeof nodeParameters.roleUpdateIds === 'string' ? nodeParameters.roleUpdateIds.split(',') : nodeParameters.roleUpdateIds) ?? [];
                            for (const roleId of roleUpdateIds) {
                                if (!roles.cache.has(roleId) && nodeParameters.actionType === 'addRole')
                                    roles.add(roleId);
                                else if (roles.cache.has(roleId) && nodeParameters.actionType === 'removeRole')
                                    roles.remove(roleId);
                            }
                        }
                    };

                    await performAction();
                    console.log("action done");
                    
                    ipc.server.emit(socket, `callback:send:action`, {
                        action: nodeParameters.actionType,
                    });
                }

            } catch (e) {
                console.log(`${e}`);
                ipc.server.emit(socket, `callback:send:action`, false);
            }
        });
    });

    ipc.server.start();
}