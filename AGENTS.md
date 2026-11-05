# AGENTS.md

## Repository state
- GNOME Shell extension `audio-out@max.local`. Not a git repo.
- Extension sources live in `audio-out@max.local/` (repo root is not the extension dir): `extension.js`, `audio.js`, `metadata.json`, `stylesheet.css`.
- No tests, lint, or typecheck exist. `audio.js` mentions `tests/test-audio.js` in a comment; that file does not exist.

## Commands
- `make install` copies `SOURCES` to `~/.local/share/gnome-shell/extensions/audio-out@max.local`. `make uninstall` removes that dir.
- `make enable` / `make disable` toggle the extension.
- `make restart` runs `pkill -nx gnome-shell`; the systemd user unit respawns the shell.
- `make pack` builds `audio-out@max.local.shell-extension.zip`; `stylesheet.css` and `metadata.json` are packed automatically, `audio.js` needs `--extra-source=audio.js`.
- Deploy order: `make install && make restart`. The shell caches modules, so installing alone does not reload code.
- New runtime files must be added to `SOURCES` (or `EXTRA` for directories such as `icons/`) in the `Makefile`, or `make install` and `make pack` will miss them.

## Environment
- GNOME Shell 42, Ubuntu 22.04, X11. Uses legacy `imports.*` modules, not ESM/`Extension` class.
- `extension.js` sets `LC_ALL=C` and `LANG=C` before touching audio: the Italian locale makes `pactl` emit `0,00` decimals, invalid JSON.
- Stack: `extension.js` builds the menu and calls `Audio.getState()` / `Audio.switchTo(output)`; `audio.js` is the standalone `pactl` backend (no shell imports, keeps retry logic for truncated JSON).

## Gotchas
- Auto-refresh is event driven: `_startWatching()` runs `pactl subscribe` as a `Gio.Subprocess`, filters `Event '...' on (sink|card|server)`, debounces 300 ms, then calls `_refresh()`. It respawns the subscription 5 s after it dies; `destroy()` must stop it.
- `_refresh()` is not reentrant: concurrent calls set `_refreshQueued` and rerun once after the current pass. Keep that guard when editing refresh logic.
- Log prefixes differ: `audio-out:` from the menu, `sound-selector:` from `audio.js`. Use `journalctl --user -u org.gnome.Shell@x11.service -f | grep -E 'audio-out|sound-selector'`.
- Icons come from Adwaita symbolic set via the `ICONS` map in `extension.js`; Bluetooth is detected from `kind === 'bluetooth'` or `bluez_output.`/`bluez_card.` names. Adwaita 42 has no earbuds icon, so Bluetooth uses `bluetooth-active-symbolic` and wired headphones use `audio-headphones-symbolic`. The speakers icon is the bundled `icons/speaker-hifi-symbolic.svg`, loaded as a `Gio.FileIcon`; `ICONS` therefore holds `GIcon` objects, not names, and `iconLabel()` produces the names for logs.
- Wheel over the panel icon changes volume in 5% steps through `pactl set-sink-volume @DEFAULT_SINK@`. `_onScroll()` handles both discrete (`UP`/`DOWN`) and `SMOOTH` (touchpad) events, accumulating fractional deltas in `_scrollAccum`. `_changeVolume()` keeps an optimistic `_volumeLevel` cache, shows the OSD immediately with `Main.osdWindowManager.show(-1, icon, null, level, 1)` (GNOME 42: `monitorIndex` first, 0..1 level), coalesces writes with a 20 ms timer, then resyncs from `pactl get-sink-volume` 700 ms later. Do not make it await `pactl` per wheel event: that feels laggy.
- `_updatePanelIcon()` picks the icon: `MUTED_ICON` (`audio-volume-muted-symbolic`) when `_volumeLevel === 0`, otherwise the active device icon. `_showVolumeOsd()` applies the same rule. Both run on every volume change and on the delayed `_syncVolume()`, so external volume changes (media keys) also flip the mute icon.
- Middle-click mute: `vfunc_event()` intercepts button 2 and returns `Clutter.EVENT_STOP`, because `PanelMenu.Button.vfunc_event()` opens the menu on any `BUTTON_PRESS`. `_mute()` saves the current level in `_preMuteVolume` and calls `pactl set-sink-mute @DEFAULT_SINK@ 1`; `_unmute()` writes that level back before clearing the mute. Scrolling while muted unmutes. `_muteChangedAt` keeps a stale `_syncVolume()` read from undoing a just-applied local toggle.
- `pgrep -n gnome-shell` also matches `gnome-shell-calendar-server`; always use `pgrep -nx` / `pkill -nx`.
- Custom style classes `audio-out-active` and `dimmed` only exist via `stylesheet.css`; keep that file installed.
- `/home/max/projects/three-labels` is an older flat copy, not the source of truth.
