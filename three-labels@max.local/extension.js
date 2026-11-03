// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
const {Gio, GLib, GObject, St} = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Audio = Me.imports.audio;

const UUID = 'three-labels@max.local';

const ThreeLabelsIndicator = GObject.registerClass(
class ThreeLabelsIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Three Labels');

        GLib.setenv('LC_ALL', 'C', true);
        GLib.setenv('LANG', 'C', true);

        this._refreshDebounceId = 0;
        this._respawnId = 0;
        this._refreshing = false;
        this._refreshQueued = false;
        this._eventProc = null;
        this._eventStream = null;
        this._eventCancellable = null;
        this._destroyed = false;

        this._outputs = [
            { label: 'label 1', available: true, active: false },
            { label: 'label 2', available: true, active: false },
            { label: 'label 3', available: true, active: false },
        ];

        const icon = new St.Icon({
            icon_name: 'utilities-terminal-symbolic',
            style_class: 'system-status-icon',
        });
        this.add_child(icon);

        this._buildMenu();
        this._refresh();
        this._startWatching();
    }

    _startWatching() {
        if (this._destroyed || this._eventProc)
            return;

        try {
            this._eventProc = Gio.Subprocess.new(
                ['pactl', 'subscribe'],
                Gio.SubprocessFlags.STDOUT_PIPE);
        } catch (e) {
            this._eventProc = null;
            log(`three-labels: impossibile avviare pactl subscribe: ${e.message}`);
            return;
        }

        const proc = this._eventProc;
        this._eventCancellable = new Gio.Cancellable();
        this._eventStream = Gio.DataInputStream.new(proc.get_stdout_pipe());
        this._readEventLine();

        proc.wait_async(null, () => {
            if (this._destroyed || this._eventProc !== proc)
                return;
            this._eventProc = null;
            this._eventStream = null;
            this._eventCancellable = null;
            this._respawnId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                this._respawnId = 0;
                this._startWatching();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _readEventLine() {
        const stream = this._eventStream;
        if (!stream)
            return;

        stream.read_line_async(GLib.PRIORITY_DEFAULT, this._eventCancellable, (source, res) => {
            let line = null;
            try {
                [line] = source.read_line_finish_utf8(res);
            } catch (e) {
                return;
            }

            if (line === null)
                return;

            if (/^Event '(new|remove|change)' on (sink|card|server) /.test(line))
                this._queueRefresh();

            if (this._eventStream === stream)
                this._readEventLine();
        });
    }

    _queueRefresh() {
        if (this._refreshDebounceId)
            GLib.source_remove(this._refreshDebounceId);

        this._refreshDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._refreshDebounceId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopWatching() {
        if (this._refreshDebounceId) {
            GLib.source_remove(this._refreshDebounceId);
            this._refreshDebounceId = 0;
        }
        if (this._respawnId) {
            GLib.source_remove(this._respawnId);
            this._respawnId = 0;
        }
        if (this._eventCancellable) {
            this._eventCancellable.cancel();
            this._eventCancellable = null;
        }

        const proc = this._eventProc;
        this._eventProc = null;
        this._eventStream = null;

        if (proc) {
            try {
                proc.force_exit();
            } catch (e) {
                // Process already gone.
            }
        }
    }

    destroy() {
        this._destroyed = true;
        this._stopWatching();
        super.destroy();
    }

    _buildMenu() {
        this.menu.removeAll();

        for (const output of this._outputs) {
            const item = new PopupMenu.PopupMenuItem(output.label);
            if (output.available) {
                item.add_style_class_name('three-labels-active');
                item.setSensitive(true);
                item.connect('activate', async () => {
                    log(`three-labels: click on ${output.label}`);
                    try {
                        await Audio.switchTo(output);
                        await this._refresh();
                    } catch (e) {
                        log(`three-labels: impossibile selezionare ${output.label}: ${e.message}`);
                    }
                });
            } else {
                item.add_style_class_name('dimmed');
                item.setSensitive(false);
            }
            item.setOrnament(output.active
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE);
            this.menu.addMenuItem(item);
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshItem = new PopupMenu.PopupImageMenuItem('aggiorna', 'view-refresh-symbolic');
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);
    }

    async _refresh() {
        if (this._refreshing) {
            this._refreshQueued = true;
            return;
        }
        this._refreshing = true;

        try {
            await this._refreshOutputs();
        } finally {
            this._refreshing = false;
            if (this._refreshQueued) {
                this._refreshQueued = false;
                this._refresh();
            }
        }
    }

    async _refreshOutputs() {
        try {
            const state = await Audio.getState();
            const rawOutputs = (state.outputs || []).filter(output =>
                !/microphone/i.test(output.label || ''));
            const byLabel = new Map();
            const outputs = [];
            for (const output of rawOutputs) {
                const existing = byLabel.get(output.label);
                if (!existing) {
                    byLabel.set(output.label, output);
                    outputs.push(output);
                    continue;
                }
                existing.available = existing.available || output.available;
                existing.active = existing.active || output.active;
                if (!existing.sink && output.sink)
                    existing.sink = output.sink;
                if (!existing.card && output.card)
                    existing.card = output.card;
                if (!existing.port && output.port)
                    existing.port = output.port;
                if (!existing.profile && output.profile)
                    existing.profile = output.profile;
            }
            this._outputs = outputs.length ? outputs : this._outputs;
        } catch (e) {
            log(`three-labels: errore lettura dispositivi: ${e.message}`);
        }
        this._buildMenu();

        log(`three-labels: dispositivi di output rilevati (${this._outputs.length}):`);
        for (const output of this._outputs) {
            log(`three-labels:   - ${output.label} [${output.available ? 'disponibile' : 'non disponibile'}]${output.active ? ' (attivo)' : ''}`);
        }
    }
});

let indicator = null;

function init() {
}

function enable() {
    indicator = new ThreeLabelsIndicator();
    Main.panel.addToStatusArea(UUID, indicator, 0, 'right');
}

function disable() {
    if (indicator) {
        indicator.destroy();
        indicator = null;
        delete Main.panel.statusArea[UUID];
    }
}
