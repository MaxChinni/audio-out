# AGENTS.md

## Repository state
- GNOME Shell extension `audio-out@mx17.net`, git repo on `master`. `*.shell-extension.zip` is gitignored.
- Sources live in `audio-out@mx17.net/` (repo root is not the extension dir): `extension.js`, `audio.js`, `metadata.json`, `stylesheet.css`, `icons/`. Gettext sources live in `po/`; `audio-out@mx17.net/locale/` is generated and gitignored.
- Root `LICENSE` is GPL-2.0-or-later, copyright Massimiliano Chinni. Keep the project GPL-2.0-or-later compatible; `make pack` embeds that root file.
- No tests, lint, or typecheck exist. The `audio.js` header mentions `tests/test-audio.js`; that file does not exist, do not go looking for it.
- The README's AI disclosure and human credit are intentional: do not remove them. The README must not name the extension store or claim a publication status.

## Commands
- `make install` copies `SOURCES` plus `EXTRA` (`icons/`, `locale/`) to `~/.local/share/gnome-shell/extensions/audio-out@mx17.net`; `make uninstall` removes that dir. It runs `make translations` first.
- `make translations` compiles every `po/<lang>.po` listed in `po/LINGUAS` into `audio-out@mx17.net/locale/<lang>/LC_MESSAGES/audio-out.mo`.
- `make check-translations` fails if any supported language has an untranslated or fuzzy message. `make translations`, `make install`, and `make pack` depend on it.
- `make update-po` regenerates `po/audio-out.pot` with `xgettext` and merges new/changed msgids into every `po/<lang>.po` listed in `po/LINGUAS` with `msgmerge`.
- `make pot` only regenerates `po/audio-out.pot`; use `make update-po` when adding strings.
- `make restart` runs `pkill -nx gnome-shell` only when `XDG_SESSION_TYPE=x11`; on Wayland it prints a logout hint and exits 0. Never kill the shell on Wayland: it ends the session.
- Fresh install or new UUID: run `make install`, restart the shell on X11 (log out and back in on Wayland), wait ~10 s, then `make enable`. Enabling before the restart fails because the shell has not seen the new extension directory.
- The shell caches modules: installing alone does not reload code. On Wayland, only logout/login reloads it; `make restart` is a safe no-op there.
- After restart verify: `gnome-extensions info audio-out@mx17.net | grep State` and `journalctl --user -f | grep audio-out`.
- `make pack` builds `audio-out@mx17.net.shell-extension.zip`; `stylesheet.css` and `metadata.json` are automatic, `audio.js`, `icons/`, and the root `LICENSE` need `--extra-source` (already in the Makefile). The pack target passes `--podir=../po --gettext-domain=audio-out`, so the ZIP contains compiled catalogs for every `po/LINGUAS` language.
- New runtime files must be added to `SOURCES`, or to `EXTRA` for directories, or `make install` and `make pack` will miss them.

## Environment
- GNOME Shell 42.9, Ubuntu 22.04, X11. Uses legacy `imports.*` modules, not ESM or the `Extension` class.
- `extension.js` uses `ExtensionUtils.gettext` (`const _ = ExtensionUtils.gettext`) and `init()` calls `ExtensionUtils.initTranslations()`. GNOME Shell 42 loads `.mo` files from the extension's `locale/` directory when present; `metadata.json` must keep `"gettext-domain": "audio-out"`.
- `extension.js` sets `LC_ALL=C` and `LANG=C` before audio calls: the Italian locale makes `pactl` emit `0,00` decimals, invalid JSON.
- `extension.js` owns menu and UI and calls `Audio.getState()` / `Audio.switchTo(output)`; `audio.js` is the standalone `pactl` backend with no shell imports. Its `fetchJson()` reruns `pactl` up to 3 times on a parse failure; reparsing the same truncated text cannot recover.
- Functional checks have no test suite: use `xdotool` (wheel buttons 4/5, middle button 2) and `import -window root` plus ImageMagick. GNOME APIs (`St`, `Clutter`, `Main`) exist only inside the shell, not in plain `gjs`.
- To click the panel icon, log `indicator.container.get_transformed_position()`; `indicator` itself reports `NaN` before allocation.

## Localization
- Source strings are English. Every user-visible string must be wrapped in `_()` from `ExtensionUtils.gettext`; use `ngettext()` or `pgettext()` when a plural or context is needed. Logs and labels returned by `pactl` stay untranslated.
- `po/POTFILES.in` lists every source file with translatable strings, with paths relative to the repository root. Add new files there or their strings never reach the catalogs.
- `po/LINGUAS` is the single list of supported languages. `po/en.po` and `po/it.po` must stay complete; English is included even though it is the source language.
- When adding or changing a string, run `make update-po`. It regenerates `po/audio-out.pot` and merges the new or changed msgid into every `po/<lang>.po` in `po/LINGUAS`.
- Translate every new or fuzzy `msgstr` in every supported language, then run `make check-translations`. Never ship an untranslated or fuzzy entry: `make translations`, `make install`, and `make pack` fail until the catalog is complete.
- To add a language, create `po/<code>.po` with a valid gettext header, add `<code>` to `po/LINGUAS`, run `make update-po`, and translate every message. Do not add a language only to the code or the README.
- `audio-out@mx17.net/locale/` is generated by `make translations`: do not commit it, and do not hand-edit `.mo` files.
- The compiled catalogs are included in the extension ZIP by `gnome-extensions pack --podir=../po --gettext-domain=audio-out`; keep those two flags in the `pack` target.
- After changing translations, `make install` copies the new `locale/` tree. The running shell caches modules and translations: restart it on X11, or log out and back in on Wayland, before testing the interface.
- **Primary language**: English is the default for comments, README, in-code messages, and this file. All new strings must be added in English first, then translated.
- **Localization reminder**: every app-facing message (menu items, log output, OSD text, accessible names) must be wrapped in `_()` so it can be translated. Plain text strings outside `_()` will not be localized.
- **Bitcoin address**: the donation address `bc1q6nn4hncvk0n2zkps96pzar89nx9kx0kxl6war4` is listed in `.github/FUNDING.yml` and this file. If the address changes, update both locations immediately.

## Gotchas
- Auto-refresh is event driven: `_startWatching()` runs `pactl subscribe` as a `Gio.Subprocess`, filters `Event '...' on (sink|card|server)`, debounces 300 ms, then calls `_refresh()`. `Event 'change' on sink` only queues a volume/mute resync (`_queueVolumeSync()`) so wheel changes do not rebuild the menu or spam the device log. The subscription respawns 5 s after it dies or fails to start; `destroy()` must stop it.
- `_refresh()` is not reentrant: concurrent calls set `_refreshQueued` and rerun once after the current pass. Keep that guard.
- `_syncVolume()` reads both `pactl get-sink-volume` and `pactl get-sink-mute` and is non-reentrant; `_queueVolumeSync()` and `_refreshOutputs()` skip it while a write or resync is pending.
- Both `extension.js` and `audio.js` log with the `audio-out:` prefix.
- `ICONS` in `extension.js` holds `GIcon` objects, not names; `iconLabel()` produces the names for logs. Bluetooth is detected from `kind === 'bluetooth'` or `bluez_output.`/`bluez_card.` names. Adwaita 42 has no earbuds icon, so Bluetooth uses `bluetooth-active-symbolic` and wired headphones use `audio-headphones-symbolic`. Speakers use the bundled `icons/speaker-hifi-symbolic.svg` via `Gio.FileIcon`.
- Wheel over the panel icon changes volume in 5% steps through `pactl set-sink-volume @DEFAULT_SINK@`. `_onScroll()` handles discrete (`UP`/`DOWN`) and `SMOOTH` (touchpad) events via `_scrollAccum`. `_changeVolume()` keeps an optimistic `_volumeLevel`, shows the OSD immediately with `Main.osdWindowManager.show(-1, icon, null, level, 1)` (GNOME 42: `monitorIndex` first, level 0..1), coalesces writes with a 20 ms timer, then resyncs after 700 ms. Do not await `pactl` per wheel event: it feels laggy.
- `_updatePanelIcon()` and `_showVolumeOsd()` use `MUTED_ICON` (`audio-volume-muted-symbolic`) when `_muted || _volumeLevel === 0`, otherwise the active device icon; the OSD level is 0 when muted. Both run on every volume change and on the delayed `_syncVolume()`, so media keys and external mixers update the panel.
- Middle-click mute: `vfunc_event()` intercepts button 2 and returns `Clutter.EVENT_STOP`, because `PanelMenu.Button.vfunc_event()` opens the menu on any `BUTTON_PRESS`. `_mute()` saves the level in `_preMuteVolume`; `_unmute()` writes it back before clearing the mute. Scrolling while muted unmutes. `_muteChangedAt` stops a stale `_syncVolume()` read from undoing a just-applied local toggle.
- No extension icon in `metadata.json`: GNOME Shell 42 ignores such a field, and the extension store reads the icon from its own upload form, not from the ZIP. `icons/extension-icon.png` (128x128) is the upload asset; the store's list uses the store-side icon.
- `pgrep -n gnome-shell` also matches `gnome-shell-calendar-server`; always use `pgrep -nx` / `pkill -nx`.
- Custom style classes `audio-out-active` and `dimmed` exist only via `stylesheet.css`; keep that file installed.
