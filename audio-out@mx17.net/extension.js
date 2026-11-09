// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
const {Clutter, Gio, GLib, GObject, St} = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Audio = Me.imports.audio;
const _ = ExtensionUtils.gettext;

const UUID = 'audio-out@mx17.net';

function themedIcon(name) {
    return Gio.ThemedIcon.new(name);
}

function fileIcon(path) {
    return Gio.FileIcon.new(Gio.File.new_for_path(`${Me.path}/${path}`));
}

function iconLabel(icon) {
    if (icon.get_names)
        return icon.get_names()[0];
    if (icon.get_file)
        return icon.get_file().get_basename();
    return 'icon';
}

const ICONS = {
    speaker: fileIcon('icons/speaker-hifi-symbolic.svg'),
    headphones: themedIcon('audio-headphones-symbolic'),
    bluetooth: themedIcon('bluetooth-active-symbolic'),
    hdmi: themedIcon('video-display-symbolic'),
    other: themedIcon('audio-card-symbolic'),
};

function iconForOutput(output) {
    if (output.kind === 'bluetooth' ||
        (output.sink || '').startsWith('bluez_output.') ||
        (output.card || '').startsWith('bluez_card.'))
        return ICONS.bluetooth;
    return ICONS[output.kind] || ICONS.other;
}

const VOLUME_STEP = 5;
const MIDDLE_BUTTON = 2;
const MUTED_ICON = themedIcon('audio-volume-muted-symbolic');

function runCapture(argv) {
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
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                resolve(stdout || '');
            } catch (e) {
                reject(e);
            }
        });
    });
}

const AudioOutIndicator = GObject.registerClass(
class AudioOutIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Audio Out'));

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
        this._scrollAccum = 0;
        this._volumeLevel = null;
        this._pendingVolume = null;
        this._volumeApplyId = 0;
        this._volumeSyncId = 0;
        this._volumeSyncDebounceId = 0;
        this._volumeSyncing = false;
        this._muted = false;
        this._preMuteVolume = 0;
        this._muteChangedAt = 0;

        this._outputs = [];

        this._panelIcon = null;
        this._icon = new St.Icon({
            gicon: ICONS.speaker,
            style_class: 'system-status-icon',
        });
        this.add_child(this._icon);

        this._buildMenu();
        this._refresh();
        this._syncVolume();
        this._startWatching();

        this.connect('scroll-event', (actor, event) => this._onScroll(event));
    }

    vfunc_event(event) {
        // Middle button toggles mute; PanelMenu.Button opens the menu on any press.
        if (event.type() === Clutter.EventType.BUTTON_PRESS &&
            event.get_button() === MIDDLE_BUTTON) {
            this._toggleMute();
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_event(event);
    }

    _toggleMute() {
        if (this._muted)
            this._unmute();
        else
            this._mute();
    }

    _mute() {
        const level = Math.round((this._volumeLevel ?? 0.5) * 100);
        if (level > 0)
            this._preMuteVolume = level;
        this._muted = true;
        this._muteChangedAt = Date.now();
        this._setMute(true);
        this._updatePanelIcon();
        this._showVolumeOsd();
        log('audio-out: mute on');
    }

    _unmute() {
        const level = this._preMuteVolume > 0 ? this._preMuteVolume : 50;
        this._volumeLevel = level / 100;
        this._muted = false;
        this._muteChangedAt = Date.now();
        // Set the volume first, then unmute, so the old level does not play.
        this._setVolume(level);
        this._setMute(false);
        this._updatePanelIcon();
        this._showVolumeOsd();
        log(`audio-out: mute off, volume ${level}%`);
    }

    _setMute(muted) {
        try {
            Gio.Subprocess.new(
                ['pactl', 'set-sink-mute', '@DEFAULT_SINK@', muted ? '1' : '0'],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            log(`audio-out: cannot change mute: ${e.message}`);
        }
    }

    _setVolume(percent) {
        try {
            Gio.Subprocess.new(
                ['pactl', 'set-sink-volume', '@DEFAULT_SINK@', `${percent}%`],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            log(`audio-out: cannot change volume: ${e.message}`);
        }
    }

    _onScroll(event) {
        const direction = event.get_scroll_direction();
        let steps = 0;

        if (direction === Clutter.ScrollDirection.SMOOTH) {
            let [, dy] = event.get_scroll_delta();
            this._scrollAccum += dy;
            steps = Math.trunc(this._scrollAccum);
            this._scrollAccum -= steps;
            steps = -steps;
        } else if (direction === Clutter.ScrollDirection.UP) {
            steps = 1;
        } else if (direction === Clutter.ScrollDirection.DOWN) {
            steps = -1;
        } else {
            return Clutter.EVENT_PROPAGATE;
        }

        if (steps !== 0)
            this._changeVolume(steps * VOLUME_STEP);

        return Clutter.EVENT_STOP;
    }

    _changeVolume(delta) {
        const current = Math.round((this._volumeLevel ?? 0.5) * 100);
        const target = Math.max(0, Math.min(100, current + delta));
        this._volumeLevel = target / 100;
        this._pendingVolume = target;
        if (this._muted) {
            this._muted = false;
            this._muteChangedAt = Date.now();
            this._setMute(false);
        }
        this._updatePanelIcon();
        this._showVolumeOsd();

        if (this._volumeApplyId)
            return;

        this._volumeApplyId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => {
            this._volumeApplyId = 0;
            this._setVolume(this._pendingVolume);

            if (this._volumeSyncId)
                GLib.source_remove(this._volumeSyncId);
            this._volumeSyncId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
                this._volumeSyncId = 0;
                this._syncVolume();
                return GLib.SOURCE_REMOVE;
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _currentIcon() {
        if (this._muted || this._volumeLevel === 0)
            return MUTED_ICON;
        const active = this._outputs.find(output => output.active);
        return active ? iconForOutput(active) : ICONS.other;
    }

    _updatePanelIcon() {
        const icon = this._currentIcon();
        if (this._panelIcon === icon)
            return;
        this._panelIcon = icon;
        this._icon.gicon = icon;
        log(`audio-out: panel icon -> ${iconLabel(icon)}`);
    }

    _showVolumeOsd() {
        const muted = this._muted || this._volumeLevel === 0;
        const icon = this._currentIcon();
        const level = muted ? 0 : Math.max(0, Math.min(1, this._volumeLevel ?? 0));
        Main.osdWindowManager.show(-1, icon, null, level, 1);
    }

    async _syncVolume() {
        if (this._volumeSyncing)
            return;
        this._volumeSyncing = true;
        try {
            const [text, muteText] = await Promise.all([
                runCapture(['pactl', 'get-sink-volume', '@DEFAULT_SINK@']),
                runCapture(['pactl', 'get-sink-mute', '@DEFAULT_SINK@']),
            ]);
            const match = text.match(/(\d+)%/);
            const muted = /Mute:\s*yes/i.test(muteText);
            if (match)
                this._volumeLevel = Math.min(parseInt(match[1], 10), 100) / 100;
            if (muted && !this._muted && this._volumeLevel > 0)
                this._preMuteVolume = Math.round(this._volumeLevel * 100);
            // Ignore a stale read while a local mute toggle is still applying.
            if (Date.now() - this._muteChangedAt > 1000)
                this._muted = muted;
            this._updatePanelIcon();
        } catch (e) {
            // Volume read is best effort.
        } finally {
            this._volumeSyncing = false;
        }
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
            log(`audio-out: cannot start pactl subscribe: ${e.message}`);
            this._scheduleRespawn();
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
            this._scheduleRespawn();
        });
    }

    _scheduleRespawn() {
        if (this._destroyed || this._respawnId)
            return;

        this._respawnId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._respawnId = 0;
            this._startWatching();
            return GLib.SOURCE_REMOVE;
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

            const event = /^Event '(new|remove|change)' on (sink|card|server) /.exec(line);
            if (event) {
                const [type, object] = [event[1], event[2]];
                // A sink "change" is usually just volume or mute: resync the
                // level instead of rebuilding the whole device list.
                if (object === 'sink' && type === 'change')
                    this._queueVolumeSync();
                else
                    this._queueRefresh();
            }

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

    _queueVolumeSync() {
        if (this._volumeSyncDebounceId)
            GLib.source_remove(this._volumeSyncDebounceId);

        this._volumeSyncDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._volumeSyncDebounceId = 0;
            // A pending write or an already scheduled resync covers this event.
            if (!this._volumeApplyId && !this._volumeSyncId)
                this._syncVolume();
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
        if (this._volumeApplyId) {
            GLib.source_remove(this._volumeApplyId);
            this._volumeApplyId = 0;
        }
        if (this._volumeSyncId) {
            GLib.source_remove(this._volumeSyncId);
            this._volumeSyncId = 0;
        }
        if (this._volumeSyncDebounceId) {
            GLib.source_remove(this._volumeSyncDebounceId);
            this._volumeSyncDebounceId = 0;
        }
        this._stopWatching();
        super.destroy();
    }

    _buildMenu() {
        this.menu.removeAll();

        for (const output of this._outputs) {
            const item = new PopupMenu.PopupMenuItem(output.label);
            const icon = new St.Icon({
                gicon: iconForOutput(output),
                style_class: 'popup-menu-icon',
            });
            item.insert_child_at_index(icon, 0);
            if (output.available) {
                item.add_style_class_name('audio-out-active');
                item.setSensitive(true);
                item.connect('activate', async () => {
                    log(`audio-out: click on ${output.label}`);
                    try {
                        await Audio.switchTo(output);
                        await this._refresh();
                    } catch (e) {
                        log(`audio-out: cannot select ${output.label}: ${e.message}`);
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

        const refreshItem = new PopupMenu.PopupImageMenuItem(_('Refresh'), 'view-refresh-symbolic');
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
            const rawOutputs = state.outputs.filter(output =>
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
            log(`audio-out: error reading output devices: ${e.message}`);
        }

        const active = this._outputs.find(output => output.active);
        const label = active ? active.label : _('no output');
        this.accessible_name = _('Audio Out: %s').replace('%s', label);
        this._updatePanelIcon();

        if (!this._volumeApplyId && !this._volumeSyncId)
            this._syncVolume();

        this._buildMenu();

        log(`audio-out: output devices detected (${this._outputs.length}):`);
        for (const output of this._outputs) {
            log(`audio-out:   - ${output.label} [${output.available ? 'available' : 'unavailable'}]${output.active ? ' (active)' : ''} icon=${iconLabel(iconForOutput(output))}`);
        }
    }
});

let indicator = null;

function init() {
    ExtensionUtils.initTranslations();
}

function enable() {
    indicator = new AudioOutIndicator();
    Main.panel.addToStatusArea(UUID, indicator, 0, 'right');
}

function disable() {
    if (indicator) {
        indicator.destroy();
        indicator = null;
        delete Main.panel.statusArea[UUID];
    }
}
