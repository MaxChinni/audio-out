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

```sh
git clone http://gitea.fritz.box:3000/max/audio-out.git
cd audio-out
make install     # copy sources to ~/.local/share/gnome-shell/extensions/audio-out@mx17.net
make restart     # restart GNOME Shell (X11 only)
make enable      # enable the extension
```

Wait about 10 seconds after restarting the shell before enabling the extension:
the shell must see the new extension directory first. On Wayland, log out and
back in instead of running `make restart`.

To remove the installed copy:

```sh
make uninstall
```

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
make restart     # restart GNOME Shell (X11 only)
make pack        # build audio-out@mx17.net.shell-extension.zip
make clean       # remove the built ZIP
```

The shell caches JavaScript modules, so editing a file and running `make install`
alone does not reload the extension: also restart the shell. There is no test
suite, linter, or type checker.

Useful checks:

```sh
gnome-extensions info audio-out@mx17.net | grep State
journalctl --user -u org.gnome.Shell@x11.service -f | grep -E 'audio-out|sound-selector'
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

Log prefixes:

- `audio-out:` from `extension.js`
- `sound-selector:` from `audio.js`

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
