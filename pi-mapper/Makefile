# Build on the Mac, deploy to a Pi over SSH.
#   make run                        run mapd locally (http://localhost:8080/ and /control)
#   make deploy PI=pi-a.local       build for the Pi, rsync, restart mapd
#   make setup  PI=pi-a.local [ROLE=leader|follower|solo] [LEADER=pi-a.local]
#   make check  PI=pi-a.local       print OS / Chromium / compositor / decoder facts
#   make stats  PI=pi-a.local       record 10 min of CPU/temp on the Pi
#   make logs   PI=pi-a.local       follow mapd's journal
# PI is any ssh target (host, user@host, or an ~/.ssh/config alias).

PI         ?=
REMOTE_DIR ?= pi-mapper
ROLE       ?=
LEADER     ?=
BIN        := build/mapd

.PHONY: build run vet test-clips deploy setup check stats logs drift require-pi

build:
	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o $(BIN) ./cmd/mapd

run:
	go run ./cmd/mapd

vet:
	go vet ./...

test-clips:
	scripts/make-test-clips.sh

require-pi:
	@test -n "$(PI)" || { echo "set PI=<host>, e.g. make $(MAKECMDGOALS) PI=pi-a.local"; exit 1; }

deploy: require-pi build
	ssh $(PI) 'mkdir -p $(REMOTE_DIR)/layouts $(REMOTE_DIR)/media $(REMOTE_DIR)/logs'
	rsync -az $(BIN) $(PI):$(REMOTE_DIR)/mapd
	rsync -az --delete web/ $(PI):$(REMOTE_DIR)/web/
	rsync -az --delete scripts/ $(PI):$(REMOTE_DIR)/scripts/
	rsync -az layouts/example.json $(PI):$(REMOTE_DIR)/layouts/
	rsync -az --exclude '.*' media/ $(PI):$(REMOTE_DIR)/media/
	ssh $(PI) 'if systemctl is-enabled --quiet mapd 2>/dev/null; then sudo systemctl restart mapd && echo "mapd restarted"; else echo "mapd not installed yet: run make setup PI=$(PI)"; fi'

setup: deploy
	ssh -t $(PI) 'ROLE=$(ROLE) LEADER=$(LEADER) $(REMOTE_DIR)/scripts/setup-pi.sh'

check: require-pi
	ssh $(PI) 'bash -s' < scripts/check-pi.sh

stats: require-pi
	ssh -t $(PI) '$(REMOTE_DIR)/scripts/record-stats.sh 600 5'

logs: require-pi
	ssh -t $(PI) 'journalctl -u mapd -f'

drift: require-pi
	ssh $(PI) 'tail -n 40 $(REMOTE_DIR)/logs/drift.csv'
