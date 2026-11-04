UUID    := audio-out@max.local
SRCDIR  := $(UUID)
DESTDIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SOURCES := extension.js audio.js metadata.json stylesheet.css

.PHONY: all install uninstall enable disable restart pack clean

all: pack

install:
	mkdir -p "$(DESTDIR)"
	cp $(addprefix $(SRCDIR)/,$(SOURCES)) "$(DESTDIR)/"

uninstall:
	rm -rf "$(DESTDIR)"

enable:
	gnome-extensions enable "$(UUID)"

disable:
	gnome-extensions disable "$(UUID)"

restart:
	pkill -nx gnome-shell

pack:
	gnome-extensions pack "$(SRCDIR)" --extra-source=audio.js --force

clean:
	rm -f "$(UUID).shell-extension.zip"