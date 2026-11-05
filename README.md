# Audio Out

GNOME Shell extension that lists audio output devices in the top panel menu and
switches the default output when an available device is clicked.

## Requirements

- GNOME Shell 42 on X11
- `pactl` (PulseAudio or PipeWire PulseAudio compatibility)

## Layout

```
audio-out@max.local/   extension sources (packed and installed as-is)
Makefile                  install / pack / enable / restart helpers
```

`audio.js` is the audio backend: it reads `pactl` JSON and switches sinks and
card profiles. `extension.js` builds the menu.

## Install

```sh
make install     # copy sources to ~/.local/share/gnome-shell/extensions/audio-out@max.local
make enable      # enable the extension
make restart     # restart GNOME Shell (X11 only)
```

`make pack` builds `audio-out@max.local.shell-extension.zip` for publication
on extensions.gnome.org. `make uninstall` removes the installed copy.

## Behaviour

- Menu items list every output port reported by the sound cards, including
  unavailable ones (HDMI, Bluetooth, S/PDIF).
- Each item shows a device icon: stereo hi-fi speakers (bundled
  `icons/speaker-hifi-symbolic.svg`), headphones, Bluetooth,
  HDMI/DisplayPort, or a generic audio card.
- The panel icon follows the active output. Scroll the wheel over it to change
  the volume in 5% steps (up louder, down quieter), with a GNOME OSD.
- At volume 0 the panel and OSD icons become the muted-speaker symbol.
- Middle-click the panel icon to toggle mute. Unmuting restores the volume
  used before the mute.
- Available devices use `audio-out-active`; unavailable ones use `dimmed`
  and are not clickable.
- The current default output is marked with a check.
- Clicking an available output logs `audio-out: click on <label>` and then
  switches the default output.
- The device list refreshes by itself when sinks, cards, or the sound server
  change (USB or Bluetooth headphones plugged in, card profile change).
- `aggiorna` forces a rescan.

## Logs

```sh
journalctl --user -u org.gnome.Shell@x11.service -f | grep audio-out
```

## Notes

- The extension sets `LC_ALL=C` and `LANG=C` before calling `pactl`, because
  localized decimal separators produce JSON that `JSON.parse` rejects.
- Devices whose label contains `microphone` are filtered out, and duplicate
  labels are merged.
