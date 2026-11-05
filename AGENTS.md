# AGENTS.md

## Repository state
- GNOME Shell extension `audio-out@max.local`, git repo on `master` (origin `http://gitea.fritz.box:3000/max/audio-out.git`). `*.shell-extension.zip` is gitignored.
- Sources live in `audio-out@max.local/` (repo root is not the extension dir): `extension.js`, `audio.js`, `metadata.json`, `stylesheet.css`, `icons/`.
- No tests, lint, or typecheck exist. The `audio.js` header mentions `tests/test-audio.js`; that file does not exist, do not go looking for it.

## Commands
- `make install` copies `SOURCES` plus `EXTRA` (`icons/`) to `~/.local/share/gnome-shell/extensions/audio-out@max.local`; `make uninstall` removes that dir.
- `make restart` runs `pkill -nx gnome-shell`; the systemd user unit respawns the shell.
- Deploy with `make install && make restart`: the shell caches modules, so installing alone does not reload code.
- After restart wait ~10 s, then verify: `gnome-extensions info audio-out@max.local | grep State` and `journalctl --user -u org.gnome.Shell@x11.service -f | grep -E 'audio-out|sound-selector'`.
- `make pack` builds `audio-out@max.local.shell-extension.zip`; `stylesheet.css` and `metadata.json` are automatic, `audio.js` and `icons/` need `--extra-source` (already in the Makefile).
- New runtime files must be added to `SOURCES`, or to `EXTRA` for directories, or `make install` and `make pack` will miss them.
- `gnome-extensions enable` fails until a shell restart after a new UUID directory appears.

## Environment
- GNOME Shell 42.9, Ubuntu 22.04, X11. Uses legacy `imports.*` modules, not ESM or the `Extension` class.
- `extension.js` sets `LC_ALL=C` and `LANG=C` before audio calls: the Italian locale makes `pactl` emit `0,00` decimals, invalid JSON.
- `extension.js` owns menu and UI and calls `Audio.getState()` / `Audio.switchTo(output)`; `audio.js` is the standalone `pactl` backend with no shell imports. Its `fetchJson()` reruns `pactl` up to 3 times on a parse failure; reparsing the same truncated text cannot recover.
- Functional checks have no test suite: use `xdotool` (wheel buttons 4/5, middle button 2) and `import -window root` plus ImageMagick. GNOME APIs (`St`, `Clutter`, `Main`) exist only inside the shell, not in plain `gjs`.
- To click the panel icon, log `indicator.container.get_transformed_position()`; `indicator` itself reports `NaN` before allocation.

## Gotchas
- Auto-refresh is event driven: `_startWatching()` runs `pactl subscribe` as a `Gio.Subprocess`, filters `Event '...' on (sink|card|server)`, debounces 300 ms, then calls `_refresh()`. `Event 'change' on sink` only queues a volume/mute resync (`_queueVolumeSync()`) so wheel changes do not rebuild the menu or spam the device log. The subscription respawns 5 s after it dies or fails to start; `destroy()` must stop it.
- `_refresh()` is not reentrant: concurrent calls set `_refreshQueued` and rerun once after the current pass. Keep that guard.
- `_syncVolume()` reads both `pactl get-sink-volume` and `pactl get-sink-mute` and is non-reentrant; `_queueVolumeSync()` and `_refreshOutputs()` skip it while a write or resync is pending.
- Log prefixes differ: `audio-out:` from the menu, `sound-selector:` from `audio.js`.
- `ICONS` in `extension.js` holds `GIcon` objects, not names; `iconLabel()` produces the names for logs. Bluetooth is detected from `kind === 'bluetooth'` or `bluez_output.`/`bluez_card.` names. Adwaita 42 has no earbuds icon, so Bluetooth uses `bluetooth-active-symbolic` and wired headphones use `audio-headphones-symbolic`. Speakers use the bundled `icons/speaker-hifi-symbolic.svg` via `Gio.FileIcon`.
- Wheel over the panel icon changes volume in 5% steps through `pactl set-sink-volume @DEFAULT_SINK@`. `_onScroll()` handles discrete (`UP`/`DOWN`) and `SMOOTH` (touchpad) events via `_scrollAccum`. `_changeVolume()` keeps an optimistic `_volumeLevel`, shows the OSD immediately with `Main.osdWindowManager.show(-1, icon, null, level, 1)` (GNOME 42: `monitorIndex` first, level 0..1), coalesces writes with a 20 ms timer, then resyncs after 700 ms. Do not await `pactl` per wheel event: it feels laggy.
- `_updatePanelIcon()` and `_showVolumeOsd()` use `MUTED_ICON` (`audio-volume-muted-symbolic`) when `_muted || _volumeLevel === 0`, otherwise the active device icon; the OSD level is 0 when muted. Both run on every volume change and on the delayed `_syncVolume()`, so media keys and external mixers update the panel.
- Middle-click mute: `vfunc_event()` intercepts button 2 and returns `Clutter.EVENT_STOP`, because `PanelMenu.Button.vfunc_event()` opens the menu on any `BUTTON_PRESS`. `_mute()` saves the level in `_preMuteVolume`; `_unmute()` writes it back before clearing the mute. Scrolling while muted unmutes. `_muteChangedAt` stops a stale `_syncVolume()` read from undoing a just-applied local toggle.
- `pgrep -n gnome-shell` also matches `gnome-shell-calendar-server`; always use `pgrep -nx` / `pkill -nx`.
- Custom style classes `audio-out-active` and `dimmed` exist only via `stylesheet.css`; keep that file installed.
