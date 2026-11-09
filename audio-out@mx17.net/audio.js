// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
/* Audio backend for the Audio Out extension.
 *
 * Talks to PulseAudio / PipeWire through `pactl` (JSON output, pactl >= 15).
 * This module deliberately has no gnome-shell imports so it can be loaded
 * from plain gjs.
 */

const {Gio, GLib} = imports.gi;

const PACTL = ['pactl', '-f', 'json'];

const PORT_KINDS = {
    'Speaker': 'speaker',
    'Headphones': 'headphones',
    'Headset': 'headphones',
    'HDMI': 'hdmi',
    'Line': 'other',
    'Aux': 'other',
    'SPDIF': 'other',
};

const OUTPUT_KIND_ORDER = {
    speaker: 0,
    headphones: 1,
    hdmi: 2,
    bluetooth: 3,
    other: 4,
};

function warn(message) {
    if (typeof log === 'function')
        log(message);
    else
        print(message);
}

/* Run a subprocess and capture stdout.
 *
 * stderr is silenced: opening a second pipe risks a deadlock when pactl emits
 * lots of diagnostics. Piping stdout can still race against fd flushing under
 * gnome-shell load and truncate the JSON around ~431 bytes, so callers use
 * fetchJson(), which reruns the command when parsing fails. */
function run(argv) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            reject(e);
            return;
        }
        proc.communicate_utf8_async(null, null, (p, res) => {
            let stdout = '';
            try {
                [, stdout] = p.communicate_utf8_finish(res);
            } catch (e) {
                reject(e);
                return;
            }
            if (!p.get_successful()) {
                const status = p.get_exit_status();
                reject(new Error(`${argv.join(' ')} exited with status ${status}`));
                return;
            }
            resolve(stdout ?? '');
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

async function runWithRetry(argv, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await run(argv);
        } catch (e) {
            if (attempt === maxRetries)
                throw e;
            await sleep(300);
        }
    }
    throw new Error(`${argv.join(' ')} failed after ${maxRetries + 1} attempts`);
}

function cardNameForSink(sinkName) {
    for (const prefix of ['alsa_output.', 'bluez_output.']) {
        if (!sinkName.startsWith(prefix))
            continue;
        const cardPrefix = prefix.replace('_output.', '_card.');
        const rest = sinkName.substring(prefix.length);
        const dot = rest.lastIndexOf('.');
        if (dot > 0)
            return cardPrefix + rest.substring(0, dot);
    }
    return null;
}

function normalizeCards(cardsJson) {
    return (cardsJson || []).map(card => ({
        name: card.name,
        activeProfile: card.active_profile,
        profiles: Object.entries(card.profiles || {}).map(([name, profile]) => ({
            name,
            sinks: profile.sinks,
            priority: profile.priority,
            available: profile.available,
        })),
        ports: Object.entries(card.ports || {}).map(([name, port]) => ({
            name,
            description: port.description,
            type: port.type,
            priority: port.priority,
            availability: port.availability,
            profiles: port.profiles || [],
        })),
    }));
}

function normalizeSinks(sinksJson) {
    return (sinksJson || []).map(sink => ({
        name: sink.name,
        description: sink.description,
        activePort: sink.active_port || null,
        card: cardNameForSink(sink.name),
    }));
}

/* Build the list of selectable outputs.
 *
 * A card port is selectable only if at least one available profile with a sink
 * contains that port. Sinks not backed by a card port (Bluetooth, virtual
 * devices) become sink-only entries.
 */
function buildOutputs(cards, sinks, defaultSink) {
    const outputs = [];
    const usedSinks = new Set();

    for (const card of cards) {
        for (const port of card.ports) {
            const kind = PORT_KINDS[port.type];
            if (!kind)
                continue;

            const candidates = card.profiles
                .filter(profile => profile.available && profile.sinks > 0 &&
                    port.profiles.includes(profile.name))
                .sort((a, b) => b.priority - a.priority);
            if (!candidates.length)
                continue;

            const profile = candidates[0];
            const sink = sinks.find(candidate =>
                candidate.card === card.name && candidate.activePort === port.name);
            if (sink)
                usedSinks.add(sink.name);

            outputs.push({
                kind,
                label: port.description,
                card: card.name,
                port: port.name,
                profile: profile.name,
                sink: sink ? sink.name : null,
                available: port.availability !== 'not available',
                active: !!sink && sink.name === defaultSink,
                priority: port.priority,
                sinkOnly: false,
            });
        }
    }

    for (const sink of sinks) {
        if (usedSinks.has(sink.name))
            continue;
        const isBluetooth = sink.name.startsWith('bluez_output.') ||
            (sink.card || '').startsWith('bluez_card.');
        outputs.push({
            kind: isBluetooth ? 'bluetooth' : 'other',
            label: sink.description || sink.name,
            card: null,
            port: null,
            profile: null,
            sink: sink.name,
            available: true,
            active: sink.name === defaultSink,
            priority: 0,
            sinkOnly: true,
        });
    }

    outputs.sort((a, b) => {
        const ka = OUTPUT_KIND_ORDER[a.kind] ?? 99;
        const kb = OUTPUT_KIND_ORDER[b.kind] ?? 99;
        if (ka !== kb)
            return ka - kb;
        if (a.priority !== b.priority)
            return b.priority - a.priority;
        return (a.label || '').localeCompare(b.label || '');
    });

    return outputs;
}

function buildState(cardsJson, sinksJson, defaultSink) {
    const cards = normalizeCards(cardsJson);
    const sinks = normalizeSinks(sinksJson);
    return { outputs: buildOutputs(cards, sinks, defaultSink) };
}

async function getDefaultSink() {
    try {
        return (await runWithRetry(['pactl', 'get-default-sink'], 1)).trim();
    } catch (e) {
        const info = await run(['pactl', 'info']);
        const match = /^Default Sink: (.+)$/m.exec(info);
        return match ? match[1].trim() : null;
    }
}

/* Run a pactl JSON command and parse it, rerunning the command on failure.
 * Parsing the same truncated payload again cannot recover, so the retry has
 * to fetch it again. */
async function fetchJson(argv, maxAttempts = 3) {
    let lastError = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            return JSON.parse(await run(argv));
        } catch (e) {
            lastError = e;
            if (attempt < maxAttempts - 1)
                await sleep(200);
        }
    }
    warn(`audio-out: cannot parse ${argv.join(' ')}: ${lastError.message}`);
    throw lastError;
}

async function getState() {
    try {
        const [cardsJson, sinksJson, defaultSink] = await Promise.all([
            fetchJson([...PACTL, 'list', 'cards']),
            fetchJson([...PACTL, 'list', 'sinks']),
            getDefaultSink(),
        ]);
        return buildState(cardsJson, sinksJson, defaultSink);
    } catch (e) {
        warn(`audio-out: cannot read audio state: ${e.message}`);
        return { outputs: [] };
    }
}

async function moveStreams(sinkName) {
    const text = await runWithRetry(['pactl', 'list', 'short', 'sink-inputs'], 2);
    const ids = text.split('\n')
        .map(line => line.trim())
        .filter(line => line.length)
        .map(line => line.split('\t')[0]);
    for (const id of ids) {
        try {
            await run(['pactl', 'move-sink-input', id, sinkName]);
        } catch (e) {
            warn(`audio-out: cannot move stream ${id}: ${e.message}`);
        }
    }
}

async function waitForCardSink(cardName) {
    for (let attempt = 0; attempt < 25; attempt++) {
        try {
            const sinksJson = await runWithRetry([...PACTL, 'list', 'sinks'], 2);
            const sink = normalizeSinks(JSON.parse(sinksJson)).find(candidate => candidate.card === cardName);
            if (sink)
                return sink;
        } catch (e) {
            // Not fatal: keep waiting for the card to come up.
        }
        await sleep(120);
    }
    return null;
}

/* Activate an output: profile change when needed, port selection, default
 * sink, then move running streams so playback does not stop.
 *
 * Switching between HDMI and analog ports of the same card requires a card
 * profile change; switching between two ports of one profile only needs
 * set-sink-port. */
async function switchTo(output) {
    if (!output)
        throw new Error('No output selected');

    if (output.sinkOnly) {
        await run(['pactl', 'set-default-sink', output.sink]);
        await moveStreams(output.sink);
        return;
    }

    const cardsJson = await runWithRetry([...PACTL, 'list', 'cards'], 2);
    const card = normalizeCards(JSON.parse(cardsJson)).find(candidate => candidate.name === output.card);
    if (!card)
        throw new Error(`Card ${output.card} not found`);

    if (card.activeProfile !== output.profile)
        await run(['pactl', 'set-card-profile', output.card, output.profile]);

    const sink = await waitForCardSink(output.card);
    if (!sink)
        throw new Error(`No sink available for ${output.label}`);

    if (sink.activePort !== output.port) {
        try {
            await run(['pactl', 'set-sink-port', sink.name, output.port]);
        } catch (e) {
            warn(`audio-out: cannot select port ${output.port}: ${e.message}`);
        }
    }

    await run(['pactl', 'set-default-sink', sink.name]);
    await moveStreams(sink.name);
}
