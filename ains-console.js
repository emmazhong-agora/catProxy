(function () {
    const token = new URLSearchParams(location.search).get('token');
    const secrets = token ? [...new Set([token, encodeURIComponent(token)])].sort((a, b) => b.length - a.length) : [];
    const methods = ['log', 'info', 'warn', 'error', 'debug'];
    const maxBytes = 32 * 1024 * 1024;
    const entries = [];
    let bytes = 0;
    let firstSequence = 0;
    let nextSequence = 0;
    let started = false;

    function redact(value) {
        let text = String(value);
        for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
        return text.replace(/([?&]token=)[^&\s]+/gi, '$1[REDACTED]');
    }

    function stringify(value) {
        if (typeof value === 'string') return value;
        if (value instanceof Error) return value.stack || value.message;
        try {
            const seen = new WeakSet();
            return JSON.stringify(value, (key, item) => {
                if (item instanceof Error) return item.stack || item.message;
                if (typeof item === 'object' && item !== null) {
                    if (seen.has(item)) return '[Circular]';
                    seen.add(item);
                }
                return item;
            }) ?? String(value);
        } catch {
            return String(value);
        }
    }

    function capture(level, args) {
        const message = redact(args.map(stringify).join(' ')).slice(0, 16384).replace(/\r?\n/g, '\\n');
        const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}\n`;
        entries.push(line);
        bytes += line.length;
        nextSequence += 1;
        while (bytes > maxBytes && entries.length > 1) {
            bytes -= entries.shift().length;
            firstSequence += 1;
        }
    }

    for (const method of methods) {
        const original = console[method].bind(console);
        console[method] = (...args) => {
            try { capture(method, args); } catch { /* Logging must not interrupt the test. */ }
            original(...args);
        };
    }

    addEventListener('error', event => {
        console.error('[AINS TEST] Uncaught error:', event.error || event.message);
    });
    addEventListener('unhandledrejection', event => {
        console.error('[AINS TEST] Unhandled rejection:', event.reason);
    });

    window.ainsConsoleLog = {
        beginRun() {
            if (!started) {
                started = true;
                return firstSequence;
            }
            return nextSequence;
        },
        textSince(sequence) {
            const dropped = Math.max(0, firstSequence - sequence);
            const header = 'AINS Field Test browser console (UTC). Token values redacted.\n'
                + (dropped ? `[Older log entries truncated: ${dropped}]\n` : '');
            return header + entries.slice(Math.max(0, sequence - firstSequence)).join('');
        }
    };
})();
