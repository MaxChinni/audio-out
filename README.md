# Audio Out

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-42-blue)
![Backend](https://img.shields.io/badge/backend-PulseAudio%20%7C%20PipeWire-informational)

A GNOME Shell extension that lists every audio output device in the top panel
and switches the default output with one click. It shows a device-specific icon,
follows the active output in the panel, and controls volume and mute from the
panel icon.

> [!IMPORTANT]
> **AI-generated project.** The code and documentation were written by an AI
> coding agent (OpenCode). The project idea, requirements, architecture, prompt
> design, review, and functional testing are the work of
> **Massimiliano Chinni**, who directed the implementation.

## Features

- Lists all output ports reported by the sound cards, including unavailable ones
  (HDMI, Bluetooth, S/PDIF).
- Device icons for stereo speakers, headphones, Bluetooth, HDMI/DisplayPort, and
  generic audio cards.
- The panel icon mirrors the active output and becomes a muted speaker at volume
  0 or while muted.
- Scroll over the panel icon to change volume in 5% steps, with a GNOME OSD.
- Middle-click the panel icon to toggle mute. Unmuting restores the level used
  before the mute.
- Marks the current default output with a check.
- Refreshes the device list automatically when sinks, cards, or the sound server
  change (USB or Bluetooth headset plugged in, card profile change).
- Picks up volume and mute changes made outside the extension (media keys,
  another mixer).
- Clicking an available device switches to it; unavailable devices are dimmed
  and disabled.

## Compatibility

- GNOME Shell 42
- PulseAudio, or PipeWire with PulseAudio compatibility
- `pactl` 15 or newer (the extension reads `pactl -f json` output)

Tested on Ubuntu 22.04 with GNOME Shell 42.9 on X11.

## Installation

### From source

The repository contains the extension sources in `audio-out@mx17.net/` and a
`Makefile` that installs, enables, restarts, and packages them. Run every target
as your desktop user, without `sudo`: the install target writes only inside your
home directory.

1. Clone the repository and enter its directory:

   ```sh
   git clone <repository-url>
   cd audio-out
   ```

2. Install the extension files:

   ```sh
   make install
   ```

   This copies `extension.js`, `audio.js`, `metadata.json`, `stylesheet.css`,
   and `icons/` to:

   ```text
   ~/.local/share/gnome-shell/extensions/audio-out@mx17.net/
   ```

3. Reload GNOME Shell:

   ```sh
   make restart
   ```

   On X11 this runs `pkill -nx gnome-shell`; the systemd user unit restarts the
   shell. On Wayland it does not kill the shell: it prints a reminder and exits
   successfully. Log out and back in to reload Wayland.

4. Wait about 10 seconds after the restart, then enable the extension:

   ```sh
   make enable
   ```

   Run `make enable` only after the shell has started again. Enabling earlier
   fails because the shell has not seen the new extension directory yet.

5. Verify that the extension is loaded:

   ```sh
   gnome-extensions info audio-out@mx17.net | grep State
   ```

   Expected result:

   ```text
   State: ENABLED
   ```

   The panel icon appears in the top bar. If it does not, check the logs:

   ```sh
   journalctl --user -f | grep audio-out
   ```

### Updating

After changing the sources, install them again and reload the shell:

```sh
make install
make restart     # on Wayland: make restart prints a hint, then log out and back in
```

The extension stays enabled across the reload. Run `make enable` again only if
it was disabled.

### Uninstall

```sh
make disable
make uninstall
```

`make uninstall` removes `~/.local/share/gnome-shell/extensions/audio-out@mx17.net/`.
On Wayland, log out and back in afterwards.

### Makefile targets

| Target | Effect |
| --- | --- |
| `make install` | Copy the extension sources and `icons/` to the user extension directory |
| `make uninstall` | Remove the installed extension directory |
| `make enable` | Enable `audio-out@mx17.net` |
| `make disable` | Disable `audio-out@mx17.net` |
| `make restart` | Restart GNOME Shell on X11; on Wayland print a logout hint and exit 0 |
| `make pack` | Build `audio-out@mx17.net.shell-extension.zip`, including the root `LICENSE` |
| `make clean` | Delete the built ZIP |
| `make` or `make all` | Same as `make pack` |

## Usage

| Action | Result |
| --- | --- |
| Left-click the panel icon | Open the output device menu |
| Click an available device | Make it the default output |
| Scroll over the panel icon | Volume up/down in 5% steps |
| Middle-click the panel icon | Toggle mute |
| Click `aggiorna` | Force a rescan of output devices |

Devices reported by the card but not currently connected stay in the menu,
dimmed and disabled.

## Repository layout

```text
audio-out@mx17.net/          extension sources, installed and packed as-is
├── extension.js             menu, panel icon, volume, mute, event watcher
├── audio.js                 standalone pactl backend (no GNOME Shell imports)
├── metadata.json            UUID, name, GNOME Shell version
├── stylesheet.css           active/dimmed menu styles
└── icons/                   custom speaker icon and store icon
Makefile                     install, pack, enable, restart, clean helpers
```

## Development

```sh
make install     # install to the user extension directory
make restart     # restart GNOME Shell on X11; no-op with logout hint on Wayland
make pack        # build audio-out@mx17.net.shell-extension.zip
make clean       # remove the built ZIP
```

The shell caches JavaScript modules, so editing a file and running `make install`
alone does not reload the extension: also restart the shell. There is no test
suite, linter, or type checker.

Useful checks:

```sh
gnome-extensions info audio-out@mx17.net | grep State
journalctl --user -f | grep audio-out
```

## How it works

`extension.js` builds the menu and owns the panel icon, volume, and mute
handling. `audio.js` is the audio backend: it reads `pactl` JSON, switches sinks
and card profiles, and has no GNOME Shell imports so it can run under plain
`gjs`.

The device list is event driven. The extension keeps a `pactl subscribe`
subprocess open and refreshes when sinks, cards, or the sound server change. The
extension sets `LC_ALL=C` and `LANG=C` before calling `pactl`, because localized
decimal separators produce JSON that `JSON.parse` rejects.

Both `extension.js` and `audio.js` log with the `audio-out:` prefix.

## Packaging

`make pack` builds `audio-out@mx17.net.shell-extension.zip` for distribution.
`icons/extension-icon.png` is a 128×128, transparent-background extension icon
included in the package.

## License

Copyright (C) 2026 Massimiliano Chinni.

This project is licensed under the GNU General Public License, version 2 or
later (GPL-2.0-or-later). See [LICENSE](LICENSE) for the full text.

You may use, study, share, and modify the code under the terms of that license.
If you distribute a modified version, keep the copyright notice and the license,
and make the source available under the same terms.
