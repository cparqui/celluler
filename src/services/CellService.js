const { Service } = require('moleculer');
const Hypercore = require('hypercore');
const RAM = require('random-access-memory');

class CellService extends Service {
    constructor(broker) {
        super(broker);

        // Initialize hypercore with in-memory storage for testing
        this.core = new Hypercore((filename) => {
            return new RAM();
        });

        this.parseServiceSchema({
            name: 'cell',
            actions: {
                sendMessage: {
                    params: {
                        content: 'any',
                        type: { type: 'string', default: 'message' }
                    },
                    async handler(ctx) {
                        const message = {
                            type: ctx.params.type,
                            content: ctx.params.content,
                            timestamp: Date.now()
                        };

                        // Store message in hypercore
                        await this.core.append(JSON.stringify(message));
                        this.messages.push(message);

                        // Emit event for other services
                        this.broker.emit('cell.message', message);

                        return { success: true, message };
                    }
                },
                getMessages: {
                    async handler() {
                        return {
                            messages: this.messages,
                            length: this.core.length
                        };
                    }
                }
            },
            events: {
                'cell.message': {
                    async handler(ctx) {
                        const message = ctx.params;
                        this.logger.info('Received message:', message);
                    }
                }
            },
            created() {
                this.logger.info('Cell service created');
                this.messages = [];
            },
            async started() {
                this.logger.info('Cell service started');
                await this.core.ready();
                this.logger.info('Hypercore ready, public key:', this.core.key.toString('hex'));
            }
        });
    }
}

module.exports = CellService; 