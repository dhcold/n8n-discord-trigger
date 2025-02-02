import type {
    INodeType,
    INodeTypeDescription,
    ITriggerFunctions,
    ITriggerResponse,
    INodePropertyOptions,
    IWebhookFunctions,
    IWebhookResponseData,
    IExecuteFunctions,
    INodeExecutionData,
} from 'n8n-workflow';
import { options } from './DiscordTrigger.node.options';
import bot from '../DiscordBot/bot';
import ipc from 'node-ipc';
import {
    connection,
    ICredentials,
    checkWorkflowStatus,
    getChannels as getChannelsHelper,
    getRoles as getRolesHelper,
} from '../DiscordBot/helper';
import settings from '../DiscordBot/settings';
import { Attachment } from 'discord.js';

// we start the bot if we are in the main process
if (!process.send) bot();

export class DiscordTrigger implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Discord Trigger',
        name: 'discordTrigger',
        group: ['trigger', 'discord'],
        version: 1,
        description: 'Discord Trigger on message',
        defaults: {
            name: 'Discord Trigger',
        },
        icon: 'file:discord-logo.svg',
        inputs: [],
        outputs: ['main'],
        credentials: [
            {
                name: 'discordBotTriggerApi',
                required: true,
            },
        ],
        webhooks: [
            {
              name: 'default',
              httpMethod: 'POST',
              responseMode: 'onReceived',
              path: 'webhook',
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
        },
    };

    async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
        const req = this.getRequestObject();
    
        return {
          workflowData: [this.helpers.returnJsonArray(req.body)],
        };
      }

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {

        const credentials = (await this.getCredentials('discordBotTriggerApi').catch((e) => e)) as any as ICredentials;
        const node = this.getNode();
        const webhookData = this.getWorkflowStaticData('node');
        let baseUrl = '';

        try {
            const regex = /^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^\/\n?]+)/gim;
            let match;
            while ((match = regex.exec(credentials.baseUrl)) != null) {
              baseUrl = match[0];
            }
          } catch (e) {
            console.log(e);
          }
    

        if (!credentials?.token) {
            console.log("No token given.");
            
            return {};
        }

        await connection(credentials).catch((e) => e);

        ipc.connectTo('bot', () => {
            console.log('Connected to IPC server');

            const parameters: any = {};
            Object.keys(node.parameters).forEach((key) => {
                parameters[key] = this.getNodeParameter(key, '') as any;
            });


            console.log("registering node... ", webhookData);
            

            ipc.of.bot.emit('triggerNodeRegistered', {
                parameters,
                baseUrl,
                active: this.getWorkflow().active,
                credentials,
                nodeId: node.id,
                webhookId: webhookData.webhookId,
            });

            ipc.of.bot.on('messageCreate', ({ message, author, nodeId }: any) => {
                if( node.id === nodeId) {
                    this.emit([
                        this.helpers.returnJsonArray({
                            id: message.id,
                            content: message.content,
                            channelId: message.channelId,
                            authorId: author.id,
                            authorName: author.username,
                            timestamp: message.createdTimestamp,
                            listenValue: this.getNodeParameter('value', ''),
                        }),
                    ]);
                } else {
                    console.log("another node triggered",  node.id, " != ", nodeId);
                }
            });
        });

        ipc.of.bot.on('disconnect', () => {
            console.error('Disconnected from IPC server');
        });

        // Return the cleanup function
        return {
            closeFunction: async () => {
                console.log('close function called on ' + this.getNode().id);
                
                const credentials = (await this.getCredentials('discordBotTriggerApi').catch((e) => e)) as any as ICredentials;
                const isActive = await checkWorkflowStatus(credentials.baseUrl, credentials.apiKey, String(this.getWorkflow().id));

                // remove the node from being executed
                console.log("removing trigger node");
                delete settings.triggerNodes[this.getNode().id];

                // disable the node if the workflow is not activated, but keep it running if it was just the test node
                if (!isActive || this.getActivationMode() !== 'manual') {
                    console.log('Workflow stopped. Disconnecting bot...');
                    ipc.disconnect('bot');
                }
            },
        };
    }

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        // @ts-ignore
        const executionId = this.getExecutionId();
        const input = this.getInputData();
        const channelId = input[0].json?.channelId as string;
        const userId = input[0].json?.userId as string;
        const userName = input[0].json?.userName as string;
        const userTag = input[0].json?.userTag as string;
        const messageId = input[0].json?.messageId as string;
        const content = input[0].json?.content as string;
        const presence = input[0].json?.presence as string;
        const addedRoles = input[0].json?.addedRoles as string;
        const removedRoles = input[0].json?.removedRoles as string;
        const interactionMessageId = input[0].json?.interactionMessageId as string;
        const interactionValues = input[0].json?.interactionValues as string[];
        const userRoles = input[0].json?.userRoles as string[];
        const attachments = input[0].json?.attachments as Attachment[];
        
        const returnData: INodeExecutionData[] = [];
        returnData.push({
          json: {
            content,
            channelId,
            userId,
            userName,
            userTag,
            messageId,
            presence,
            addedRoles,
            removedRoles,
            interactionMessageId,
            interactionValues,
            userRoles,
            ...(attachments?.length ? { attachments } : {}),
          },
        });
        return this.prepareOutputData(returnData);
      }
}
