// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-
const {GObject, St} = imports.gi;

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

        const GLib = imports.gi.GLib;
        GLib.setenv('LC_ALL', 'C', true);
        GLib.setenv('LANG', 'C', true);

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
