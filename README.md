# Three Labels

GNOME Shell extension that lists audio output devices in the top panel menu and
switches the default output when an available device is clicked.

## Requirements

- GNOME Shell 42 on X11
- `pactl` (PulseAudio or PipeWire PulseAudio compatibility)

## Layout

```
three-labels@max.local/   extension sources (packed and installed as-is)
Makefile                  install / pack / enable / restart helpers
```

`audio.js` is the audio backend: it reads `pactl` JSON and switches sinks and
card profiles. `extension.js` builds the menu.

## Install

```sh
make install     # copy sources to ~/.local/share/gnome-shell/extensions/three-labels@max.local
make enable      # enable the extension
make restart     # restart GNOME Shell (X11 only)
```

`make pack` builds `three-labels@max.local.shell-extension.zip` for publication
on extensions.gnome.org. `make uninstall` removes the installed copy.

## Behaviour

- Menu items list every output port reported by the sound cards, including
  unavailable ones (HDMI, Bluetooth, S/PDIF).
- Available devices use `three-labels-active`; unavailable ones use `dimmed`
  and are not clickable.
- The current default output is marked with a check.
- Clicking an available output logs `three-labels: click on <label>` and then
  switches the default output.
- `aggiorna` rescans the devices.

## Logs

```sh
journalctl --user -u org.gnome.Shell@x11.service -f | grep three-labels
```

## Notes

- The extension sets `LC_ALL=C` and `LANG=C` before calling `pactl`, because
  localized decimal separators produce JSON that `JSON.parse` rejects.
- Devices whose label contains `microphone` are filtered out, and duplicate
  labels are merged.
