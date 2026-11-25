// Log calls in this codebase put the message first, then structured fields or an error:
//
//     this.logger.info('Nucleus started', { cellId, journalLength });
//     this.logger.error('Failed to flush journal', err);
//
// Moleculer's Console and File loggers print every argument. Pino instead reads only the
// first argument as the message and drops the rest unless the first one is an object, so
// for Pino loggers this hook moves the fields and error into Pino's merging object.

/** Pino `hooks.logMethod`: turns `(message, ...fieldsOrErrors)` into `(fields, message)`. */
export function messageFirst(args, method) {
    if (args.length < 2 || typeof args[0] !== 'string') return method.apply(this, args);
    const [message, ...rest] = args;
    const fields = {};
    const words = [];
    for (const arg of rest) {
        if (arg instanceof Error) fields.err = arg;
        else if (arg && typeof arg === 'object' && !Array.isArray(arg)) Object.assign(fields, arg);
        else words.push(String(arg));
    }
    const text = words.length > 0 ? `${message} ${words.join(' ')}` : message;
    return Object.keys(fields).length > 0 ? method.call(this, fields, text) : method.call(this, text);
}

const isPino = (entry) => typeof entry === 'object' && entry !== null && /^pino$/i.test(entry.type ?? '');

function withHook(entry) {
    const pino = entry.options?.pino ?? {};
    const options = pino.options ?? {};
    if (options.hooks?.logMethod) return entry;
    return {
        ...entry,
        options: {
            ...entry.options,
            pino: { ...pino, options: { ...options, hooks: { ...options.hooks, logMethod: messageFirst } } }
        }
    };
}

/** Adds the `messageFirst` hook to each Pino logger in a Moleculer `logger` setting. */
export function withLogHooks(logger) {
    if (Array.isArray(logger)) return logger.map((entry) => (isPino(entry) ? withHook(entry) : entry));
    return isPino(logger) ? withHook(logger) : logger;
}
