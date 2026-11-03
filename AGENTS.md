# AGENTS.md

## Repository state
- GNOME Shell extension `three-labels@max.local`, single extension, no git repo.
- Sources live in `three-labels@max.local/`: `extension.js`, `audio.js`, `metadata.json`, `stylesheet.css`.
- `Makefile` is the only task runner. No tests, lint, or typecheck exist; do not invent them.

## Commands
- `make install` copies the four sources to `~/.local/share/gnome-shell/extensions/three-labels@max.local`.
- `make enable` / `make disable` toggle the extension; `make uninstall` removes the installed copy.
- `make restart` runs `pkill -nx gnome-shell`; the user systemd unit restarts the shell.
- `make pack` builds `three-labels@max.local.shell-extension.zip`. `stylesheet.css` is packed automatically; `audio.js` needs `--extra-source=audio.js`.
- `make install` alone does not reload code: the shell caches modules, so always `make install && make restart`.

## Environment
- GNOME Shell 42 on X11, Ubuntu 22.04. Uses legacy imports (`imports.misc.extensionUtils`), not ESM.
- The extension sets `LC_ALL=C` and `LANG=C` in `_init`: the Italian locale makes `pactl` emit `0,00` decimals, which breaks `JSON.parse`.
- `pactl` JSON output written to `/tmp/opencode/` is only a probe artifact; `audio.js` is the real backend (`Audio.getState()`, `Audio.switchTo(output)`).

## Gotchas
- `pgrep -n gnome-shell` also matches `gnome-shell-calendar-server`; use `pgrep -nx` / `pkill -nx`.
- Extension logs: `journalctl --user -u org.gnome.Shell@x11.service -f | grep three-labels`.
- Custom style classes are `three-labels-active` and `dimmed`, defined in `stylesheet.css`; without that file they have no effect.
- `/home/max/projects/three-labels` is an older flat copy of these files, not the source of truth.
