UUID    := audio-out@mx17.net
SRCDIR  := $(UUID)
DESTDIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SOURCES := extension.js audio.js metadata.json stylesheet.css
EXTRA   := icons

.PHONY: all install uninstall enable disable restart pack clean

all: pack

install:
	mkdir -p "$(DESTDIR)"
	cp $(addprefix $(SRCDIR)/,$(SOURCES)) "$(DESTDIR)/"
	cp -r $(addprefix $(SRCDIR)/,$(EXTRA)) "$(DESTDIR)/"

uninstall:
	rm -rf "$(DESTDIR)"

enable:
	gnome-extensions enable "$(UUID)"

disable:
	gnome-extensions disable "$(UUID)"

restart:
	@if [ "$$XDG_SESSION_TYPE" != "x11" ]; then \
		echo "GNOME Shell can be restarted in place only on X11; this session is '$${XDG_SESSION_TYPE:-unknown}'."; \
		echo "Log out and back in to reload the extension, then run 'make enable'."; \
	else \
		pkill -nx gnome-shell; \
	fi

pack:
	gnome-extensions pack "$(SRCDIR)" --extra-source=audio.js --extra-source=icons --extra-source=../LICENSE --force

clean:
	rm -f "$(UUID).shell-extension.zip"