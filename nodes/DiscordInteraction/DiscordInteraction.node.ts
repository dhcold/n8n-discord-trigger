import type {
    INodeType,
    INodeExecutionData,
    INodeTypeDescription,
    INodePropertyOptions,
    IExecuteFunctions,
} from 'n8n-workflow';
import { options } from './DiscordInteraction.node.options';
import ipc from 'node-ipc';
import {
    connection,
    ICredentials,
    getChannels as getChannelsHelper,
    getRoles as getRolesHelper,
    getGuilds as getGuildsHelper,
} from '../DiscordBot/helper';


export interface IDiscordInteractionMessageParameters {
    executionId: string;
    triggerPlaceholder: boolean;
    triggerChannel: boolean;
    channelId: string;
    embed: boolean;
    title: string;
    description: string;
    url: string;
    color: string;
    timestamp: string;
    footerText: string;
    footerIconUrl: string;
    imageUrl: string;
    thumbnailUrl: string;
    authorName: string;
    authorIconUrl: string;
    authorUrl: string;
    fields: {
        field?: {
            name: string;
            value: string;
            inline: boolean;
        }[];
    };
    mentionRoles: string[];
    content: string;
    files: {
        file?: {
            url: string;
        }[];
    };
}


export interface IDiscordNodeActionParameters {
    executionId: string;
    triggerPlaceholder: boolean;
    triggerChannel: boolean;
    channelId: string;
    guildId: string;
    apiKey: string;
    baseUrl: string;
    actionType: string;
    removeMessagesNumber: number;
    userId?: string;
    roleUpdateIds?: string[] | string;
}


export class DiscordInteraction implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Discord Interaction',
        name: 'discordInteraction',
        group: ['discord'],
        version: 1,
        description: 'Sends messages, embeds and prompts to Discord',
        defaults: {
            name: 'Discord Interaction',
        },
        icon: 'file:discord-logo.svg',
        inputs: ['main'],
        outputs: ['main'],
        credentials: [
            {
                name: 'discordBotTriggerApi',
                required: true,
            },
        ],
        properties: options,
    };

    methods = {
        loadOptions: {
            async getChannels(): Promise<INodePropertyOptions[]> {
                return await getChannelsHelper(this).catch((e) => e);
            },
            async getRoles(): Promise<INodePropertyOptions[]> {
                return await getRolesHelper(this).catch((e) => e);
            },
            async getGuilds(): Promise<INodePropertyOptions[]> {
                return await getGuildsHelper(this).catch((e) => e);
            },
        },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {

        // @ts-ignore
        const executionId = this.getExecutionId();
        const returnData: INodeExecutionData[] = [];

        // fetch credentials
        const credentials = (await this.getCredentials('discordBotTriggerApi').catch((e) => e)) as any as ICredentials;

        // create connection to bot. 
        await connection(credentials).catch((e) => {
            console.log(e);
            return this.prepareOutputData(this.getInputData());
        });

        // iterate over all nodes
        const items: INodeExecutionData[] = this.getInputData();
        for (let itemIndex: number = 0; itemIndex < items.length; itemIndex++) {
            const nodeParameters: any = {};
            Object.keys(this.getNode().parameters).forEach((key) => {
                nodeParameters[key] = this.getNodeParameter(key, itemIndex, '') as any;
            });
            nodeParameters.executionId = executionId;

            if (nodeParameters.channelId || nodeParameters.executionId) {
                // return the interaction result if there is one
                const res: any = new Promise((resolve) => {
                    ipc.config.retry = 1500;
                    console.log("connecting to bot");
                    ipc.connectTo('bot', () => {
                        const type = `send:${nodeParameters.type}`;
                        ipc.of.bot.on(`callback:${type}`, (data: any) => {
                            console.log("response fired", data);
                            resolve(data);
                        });

                        // send event to bot
                        ipc.of.bot.emit(type, nodeParameters);
                    });
                }).catch((e) => {
                    console.log(e);
                    return this.prepareOutputData(this.getInputData());
                });

                returnData.push({
                    json: {
                        value: res?.value,
                        channelId: res?.channelId,
                        userId: res?.userId,
                        userName: res?.userName,
                        userTag: res?.userTag,
                        messageId: res?.messageId,
                        action: res?.action,
                    },
                });
            }
        }

        return this.prepareOutputData(returnData);
    }
}
