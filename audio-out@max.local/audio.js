// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
/* Audio backend for the Sound Selector extension.
 *
 * Talks to PulseAudio / PipeWire through `pactl` (JSON output, pactl >= 15).
 * This module deliberately has no gnome-shell imports so it can be exercised
 * with plain gjs: see tests/test-audio.js.
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

/* Run a subprocess, capture stdout+stderr into a temp file via /bin/sh.
 *
 * Using STDOUT_PIPE with async communication races against fd flushing under
 * gnome-shell load and occasionally truncates pactl JSON around ~431 bytes
 * ("expected double-quoted property name at line 1 column 431"). The temp-file
 * path avoids both races and any gnome-shell stdout suppression that breaks
 * STDOUT_FILENO inheritance. */
function run(argv) {
    return new Promise((resolve, reject) => {
        let proc;
        try {
            // Pipe stdout only. stderr carries diagnostic noise and opening a
            // second pipe risks deadlock when pactl emits lots of errors.
            // Piping stdio can race against fd flushing and occasionally
            // truncate pactl JSON at column ~431 — parseWithRetry recovers most
            // of these transient truncations.
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE);
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
        description: card.properties?.['device.description'] || card.name,
        activeProfile: card.active_profile,
        profiles: Object.entries(card.profiles || {}).map(([name, profile]) => ({
            name,
            description: profile.description,
            sinks: profile.sinks,
            sources: profile.sources,
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
                id: `${card.name}|${port.name}`,
                kind,
                label: port.description,
                cardLabel: card.description,
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
            id: `sink|${sink.name}`,
            kind: isBluetooth ? 'bluetooth' : 'other',
            label: sink.description || sink.name,
            cardLabel: '',
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

function buildState(cardsJson, sinksJson, defaultSink, drmConnected) {
    const cards = normalizeCards(cardsJson);
    const sinks = normalizeSinks(sinksJson);
    return {
        cards,
        sinks,
        defaultSink,
        outputs: buildOutputs(cards, sinks, defaultSink),
        drmConnected: !!drmConnected,
    };
}

/* True when the kernel reports an HDMI or DisplayPort connector as connected.
 * E-ports (internal laptop panel) are ignored. */
function drmHdmiConnected() {
    try {
        const dir = Gio.File.new_for_path('/sys/class/drm');
        const iter = dir.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = iter.next_file(null)) !== null) {
            const match = /^card\d+-(.+)$/.exec(info.get_name());
            if (!match || !/^(HDMI|DP)-/.test(match[1]))
                continue;
            const path = `/sys/class/drm/${info.get_name()}/status`;
            const [, bytes] = GLib.file_get_contents(path);
            if (new TextDecoder().decode(bytes).trim() === 'connected') {
                iter.close(null);
                return true;
            }
        }
        iter.close(null);
    } catch (e) {
        // sysfs is not available on every system; pactl data is the fallback.
    }
    return false;
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

async function parseWithRetry(text) {
    // Tolerate transient pipe truncation under gnome-shell load: pactl writes
    // plenty of bytes but the async stdout reader occasionally loses ~431
    // bytes around column 431 ("expected double-quoted property name at line
    // 1 column 431"). Retrying a few times usually recovers the full payload.
    for (let attempt = 0; attempt < 10; attempt++) {
        try {
            return JSON.parse(text);
        } catch (e) {
            if (attempt === 9) {
                warn(`sound-selector: pactl output length: ${text.length}`);
                warn(`sound-selector: JSON parse error: ${e.message}`);
            }
            await sleep(200);
        }
    }
    throw new Error('Invalid audio server output');
}

async function getState() {
    try {
        const [cardsJson, sinksJson, defaultSink] = await Promise.all([
            runWithRetry([...PACTL, 'list', 'cards'], 2).then(t => parseWithRetry(t)),
            runWithRetry([...PACTL, 'list', 'sinks'], 2).then(t => parseWithRetry(t)),
            getDefaultSink(),
        ]);
        return buildState(cardsJson, sinksJson, defaultSink, drmHdmiConnected());
    } catch (e) {
        warn(`sound-selector: primary parse failed: ${e.message}`);
        try {
            const [cardsText, sinksText] = await Promise.all([
                run([...PACTL, 'list', 'cards']),
                run([...PACTL, 'list', 'sinks']),
            ]);
            const cardsJson = await parseWithRetry(cardsText);
            const sinksJson = await parseWithRetry(sinksText);
            return buildState(cardsJson || [], sinksJson || [], getDefaultSink(), drmHdmiConnected());
        } catch (e2) {
            return {
                cards: [],
                sinks: [],
                defaultSink: getDefaultSink(),
                outputs: [],
                drmConnected: false,
            };
        }
    }
}

/* HDMI presence.
 *
 * Trust ordering, weakest first:
 *   1. HDMI port availability reported by the sound server ("available")
 *   2. an HDMI-type sink already active/running on that card
 *   3. kernel DRM connector state ("connected"), used when the server
 *      reports the port as unknown
 *
 * The returned `port` always carries the owning `card` name so it can be
 * handed straight to `outputForPort`.
 */
function hdmiPresence(state) {
    const candidates = [];
    for (const card of state.cards) {
        for (const port of card.ports) {
            if (PORT_KINDS[port.type] === 'hdmi')
                candidates.push({ cardName: card.name, port });
        }
    }
    if (!candidates.length)
        return { present: false, port: null };

    candidates.sort((a, b) => b.port.priority - a.port.priority);

    let present, port;

    // Port explicitly available.
    const available = candidates.find(candidate =>
        candidate.port.availability === 'available');
    if (available) {
        port = Object.assign({}, available.port, { card: available.cardName });
        present = true;
    } else if (state.sinks.some(sink =>
        sink.card === (available ? available.cardName : null))) {
        // An HDMI-type sink is running: the display is effectively connected
        // even if the port itself is reported unavailable.
        const first = candidates[0];
        port = Object.assign({}, first.port, { card: first.cardName });
        present = true;
    } else if (state.drmConnected &&
        candidates.some(candidate => candidate.port.availability === 'unknown')) {
        const first = candidates[0];
        port = Object.assign({}, first.port, { card: first.cardName });
        present = true;
    } else {
        const first = candidates[0];
        port = Object.assign({}, first.port, { card: first.cardName });
        present = false;
    }

    return { present, port };
}

function outputForPort(outputs, cardName, portName) {
    return outputs.find(output => output.card === cardName && output.port === portName) || null;
}

function selectHdmiOutput(state, presence) {
    if (presence.port) {
        const output = outputForPort(state.outputs, presence.port.card, presence.port.name);
        if (output)
            return output;
    }
    return state.outputs
        .filter(output => output.kind === 'hdmi' && output.available)
        .sort((a, b) => b.priority - a.priority)[0] || null;
}

function selectSpeakerOutput(state) {
    const speaker = state.outputs
        .filter(output => output.kind === 'speaker' && output.available)
        .sort((a, b) => b.priority - a.priority)[0];
    if (speaker)
        return speaker;

    return state.outputs
        .filter(output => output.available && output.kind !== 'hdmi' &&
            output.kind !== 'bluetooth')
        .sort((a, b) => b.priority - a.priority)[0] || null;
}

/* Decide whether an automatic switch is needed.
 *
 * Returns the output to switch to, or null when nothing should change.
 * HDMI wins whenever it is connected; speakers are restored only when the
 * current output was HDMI (a manually selected Bluetooth sink is left alone).
 */
function planAutoSwitch(state) {
    const current = state.outputs.find(output => output.active) || null;
    const presence = hdmiPresence(state);

    if (presence.present) {
        if (current && current.kind === 'hdmi')
            return null;
        return selectHdmiOutput(state, presence);
    }

    if (!current || current.kind === 'hdmi')
        return selectSpeakerOutput(state);

    return null;
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
            warn(`sound-selector: cannot move stream ${id}: ${e.message}`);
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
            warn(`sound-selector: cannot select port ${output.port}: ${e.message}`);
        }
    }

    await run(['pactl', 'set-default-sink', sink.name]);
    await moveStreams(sink.name);
}
