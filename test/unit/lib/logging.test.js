import { jest } from '@jest/globals';
import { ServiceBroker } from 'moleculer';
import { messageFirst, withLogHooks } from '../../../src/lib/logging.js';

describe('logging', () => {
    describe('messageFirst', () => {
        const call = (...args) => {
            const method = jest.fn();
            messageFirst.call('logger', args, method);
            return method.mock.calls[0];
        };

        it('moves fields and errors into a leading object', () => {
            const err = new Error('boom');
            expect(call('Started', { cellId: 'ab', length: 2 })).toEqual([{ cellId: 'ab', length: 2 }, 'Started']);
            expect(call('Failed', err)).toEqual([{ err }, 'Failed']);
            expect(call('Failed', { name: 'x' }, err)).toEqual([{ name: 'x', err }, 'Failed']);
        });

        it('appends plain values to the message', () => {
            expect(call('Peers:', 3, 'connected')).toEqual(['Peers: 3 connected']);
            expect(call('Mixed', 'a', { n: 1 })).toEqual([{ n: 1 }, 'Mixed a']);
            expect(call('List', [1, 2])).toEqual(['List 1,2']);
        });

        it("leaves single arguments and Pino's own call style alone", () => {
            expect(call('Just a message')).toEqual(['Just a message']);
            expect(call({ cellId: 'ab' }, 'Started')).toEqual([{ cellId: 'ab' }, 'Started']);
        });

        it('calls the method with the logger as `this`', () => {
            const method = jest.fn(function () {
                return this;
            });
            expect(messageFirst.call('logger', ['a', { b: 1 }], method)).toBe('logger');
        });
    });

    describe('withLogHooks', () => {
        it('adds the hook to Pino loggers only', () => {
            const pino = withLogHooks({ type: 'Pino', options: { level: 'info' } });
            expect(pino.options.level).toBe('info');
            expect(pino.options.pino.options.hooks.logMethod).toBe(messageFirst);

            const [console, file] = withLogHooks([
                { type: 'Console' },
                { type: 'pino', options: { pino: { options: { name: 'cell' }, destination: 1 } } }
            ]);
            expect(console).toEqual({ type: 'Console' });
            expect(file.options.pino).toMatchObject({ options: { name: 'cell' }, destination: 1 });
            expect(file.options.pino.options.hooks.logMethod).toBe(messageFirst);
        });

        it('keeps a configured logMethod and passes other settings through', () => {
            const own = () => {};
            const configured = { type: 'Pino', options: { pino: { options: { hooks: { logMethod: own } } } } };
            expect(withLogHooks(configured)).toBe(configured);
            expect(withLogHooks(false)).toBe(false);
            expect(withLogHooks('Console')).toBe('Console');
            expect(withLogHooks(undefined)).toBeUndefined();
        });

        it('keeps fields and errors when Moleculer logs through Pino', async () => {
            const lines = [];
            const broker = new ServiceBroker({
                nodeID: 'pino-test',
                logger: withLogHooks({
                    type: 'Pino',
                    options: { level: 'info', pino: { destination: { write: (line) => lines.push(JSON.parse(line)) } } }
                })
            });
            const logger = broker.getLogger('test');
            logger.info('Nucleus started', { cellId: 'ab', journalLength: 4 });
            logger.error('Failed to flush journal', new Error('disk full'));

            const started = lines.find((line) => line.msg === 'Nucleus started');
            expect(started).toMatchObject({ level: 30, cellId: 'ab', journalLength: 4, mod: 'test' });
            const failed = lines.find((line) => line.msg === 'Failed to flush journal');
            expect(failed).toMatchObject({ level: 50, err: { type: 'Error', message: 'disk full' } });
            expect(failed.err.stack).toContain('disk full');
        });
    });
});
