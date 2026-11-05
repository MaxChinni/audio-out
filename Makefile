UUID      := audio-out@mx17.net
SRCDIR    := $(UUID)
DESTDIR   := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
DOMAIN    := audio-out
PODIR     := po
LOCALEDIR := $(SRCDIR)/locale
LINGUAS   := $(shell cat $(PODIR)/LINGUAS 2>/dev/null)
VERSION   ?= 1.0.0
SOURCES   := extension.js audio.js metadata.json stylesheet.css
EXTRA     := icons locale

.PHONY: all install uninstall enable disable restart pack clean pot update-po translations check-translations release

all: pack

check-translations:
	@for lang in $(LINGUAS); do \
		missing=$$({ msgattrib --untranslated --no-obsolete "$(PODIR)/$$lang.po"; \
			msgattrib --fuzzy --no-obsolete "$(PODIR)/$$lang.po"; } \
			| grep '^msgid ' | grep -v '^msgid ""$$' || true); \
		if [ -n "$$missing" ]; then \
			echo "Untranslated or fuzzy messages in $(PODIR)/$$lang.po:"; \
			echo "$$missing"; \
			exit 1; \
		fi; \
	done

translations: check-translations
	@mkdir -p "$(LOCALEDIR)"
	@for lang in $(LINGUAS); do \
		mkdir -p "$(LOCALEDIR)/$$lang/LC_MESSAGES"; \
		msgfmt --check --output-file="$(LOCALEDIR)/$$lang/LC_MESSAGES/$(DOMAIN).mo" "$(PODIR)/$$lang.po" || exit 1; \
	done

install: translations
	mkdir -p "$(DESTDIR)"
	cp $(addprefix $(SRCDIR)/,$(SOURCES)) "$(DESTDIR)/"
	rm -rf $(foreach dir,$(EXTRA),"$(DESTDIR)/$(dir)")
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

pot:
	xgettext --from-code=UTF-8 --add-comments=Translators \
		--package-name="Audio Out" --package-version="1" \
		--keyword=_ --keyword=ngettext:1,2 --keyword=pgettext:1c,2 \
		--output="$(PODIR)/$(DOMAIN).pot" $$(cat $(PODIR)/POTFILES.in)

update-po: pot
	@for lang in $(LINGUAS); do \
		msgmerge --quiet --update --backup=none "$(PODIR)/$$lang.po" "$(PODIR)/$(DOMAIN).pot" || exit 1; \
	done

pack: translations
	gnome-extensions pack "$(SRCDIR)" --podir="../$(PODIR)" --gettext-domain="$(DOMAIN)" --extra-source=audio.js --extra-source=icons --extra-source=../LICENSE --force

clean:
	rm -f "$(UUID).shell-extension.zip"
	rm -rf "$(LOCALEDIR)"

release: update-po check-translations pack
	@echo "Release ZIP pronto: audio-out@mx17.net.shell-extension.zip"
	@echo "Per pubblicare su GitHub:"
	@echo "  1. Carica il file su una nuova release via web interface o"
	@echo "     `gh release create v$(VERSION) audio-out@mx17.net.shell-extension.zip`"
	@echo "  2. Oppure usa il comando seguente (se gh installato):"
	@echo "     gh release create v$(VERSION) audio-out@mx17.net.shell-extension.zip --notes \"$(shell head -1 CHANGELOG 2>/dev/null || echo 'Nessun changelog')\""
	@echo "Nota: il tag git v$(VERSION) non viene creato automaticamente: crea manualmente con"
	@echo "  git tag v$(VERSION) && git push --follow-tags se vuoi associarlo alla release."
