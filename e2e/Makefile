# Device lab entry points. Run from the repo root: make -C e2e <target>
# Needs the toolchain in docs/DEVICE_LAB.md (JDK 17, Android SDK, emulator, Maestro).
ROOT      := $(shell git rev-parse --show-toplevel)
MAESTRO   ?= $(HOME)/.maestro/bin/maestro
APP_ID    ?= team.sopa.aoair
VARIANT   ?= downloader
OUT       ?= $(ROOT)/shots/e2e

.PHONY: help build build-js android android-offline flow syntax fs1 chat-states netaudit

help:
	@echo "build        full release APK (VARIANT=offline|downloader), ninja -j3 + nice"
	@echo "build-js     JS-only incremental APK on the same native base (SHA=<commit>)"
	@echo "android      all Maestro flows against the downloader build"
	@echo "android-offline  offline import flow (files already in Downloads)"
	@echo "flow F=04-places-berlin   one flow"
	@echo "syntax       maestro check-syntax on every flow"
	@echo "fs1          FS-1 acceptance: live font change on setup step 3 (TAG=<build>)"
	@echo "chat-states  chat finish shots (LANG=en|pt SCALE=1.0|1.3)"
	@echo "netaudit     sockets + netstats of the offline app uid (LABEL=<name>)"

build:
	bash scripts/build.sh $(VARIANT)

build-js:
	bash scripts/build-js.sh $(SHA) $(VARIANT)

android:
	cd $(ROOT) && $(MAESTRO) test e2e/flows --test-output-dir $(OUT) -e APP_ID=$(APP_ID)

android-offline:
	cd $(ROOT) && $(MAESTRO) test e2e/flows/01-setup-offline-import.yaml --test-output-dir $(OUT) -e APP_ID=$(APP_ID).offline

flow:
	cd $(ROOT) && $(MAESTRO) test e2e/flows/$(F).yaml --test-output-dir $(OUT) -e APP_ID=$(APP_ID)

syntax:
	@for f in flows/*.yaml flows/common/*.yaml; do [ $$(basename $$f) = config.yaml ] && continue; \
	  printf "%s: " $$f; $(MAESTRO) check-syntax $$f >/dev/null && echo ok || exit 1; done

fs1:
	bash scripts/fs1-accept.sh $(OUT)/FS-1 $(TAG)

chat-states:
	SHOTS_DIR=$(OUT)/finish bash scripts/chat-states.sh $(LANG) $(SCALE)

netaudit:
	bash scripts/netaudit.sh $(APP_ID).offline $(LABEL) $(OUT)/net
