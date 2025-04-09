const { ServiceBroker } = require('moleculer');
const CellService = require('./services/CellService');

async function startCell(id) {
    const broker = new ServiceBroker({
        nodeID: id,
        transporter: 'TCP',
        logLevel: 'info'
    });

    // Create and add cell service
    broker.createService(CellService);

    // Start the broker
    await broker.start();

    return broker;
}

async function main() {
    try {
        // Start two cells
        const cell1 = await startCell('cell-1');
        const cell2 = await startCell('cell-2');

        // Test sending a message from cell1 to cell2
        const result = await cell1.call('cell.sendMessage', {
            content: 'Hello from cell 1!',
            type: 'greeting'
        });

        console.log('Message sent:', result);

        // Get messages from cell2
        const messages = await cell2.call('cell.getMessages');
        console.log('Cell 2 messages:', messages);

        // Keep the cells running for a while
        setTimeout(async () => {
            await cell1.stop();
            await cell2.stop();
            process.exit(0);
        }, 5000);

    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

main(); 