.PHONY: help doctor clean ingest build validate preview promote manifest publish smoke release dry-run \
        test-empty test-dashboard-only test-partial test-invalid test-complete

PYTHON      ?= python3
SOURCE_MODE ?= fixture
SOURCE      ?= complete
PORT        ?= 8770
BASE_URL    ?= http://127.0.0.1:$(PORT)/

help:
	@echo "CrashDash V4 public live-test publication vertical"
	@echo ""
	@echo "  make doctor                 verify tools/config/paths"
	@echo "  make clean                  clear generated candidate only (build/)"
	@echo "  make ingest SOURCE_MODE=fixture SOURCE=complete   ingest supplied source contract"
	@echo "  make build                  construct candidate static site (build/candidate)"
	@echo "  make validate                validate candidate against every contract"
	@echo "  make preview PORT=8770       serve build/candidate with a dumb static HTTP server"
	@echo "  make promote                 atomically replace docs/ with candidate"
	@echo "  make manifest                 create deterministic release manifest (docs/build-manifest.json)"
	@echo "  make publish                 commit/push already-validated docs/ (fails closed on any guard)"
	@echo "  make smoke BASE_URL=...      test a live/local site (root, dashboard.json, instruments)"
	@echo "  make release SOURCE=complete  doctor -> ingest -> build -> validate -> promote -> manifest -> publish -> smoke"
	@echo "  make dry-run                 same as release but never publishes"
	@echo ""
	@echo "  make test-empty              MODE 1: no data/ directory at all"
	@echo "  make test-dashboard-only     MODE 2: dashboard.json only, no instrument details"
	@echo "  make test-partial            MODE 3: some instrument details deliberately absent"
	@echo "  make test-invalid            MODE 4: malformed contract; asserts validate REJECTS it"
	@echo "  make test-complete           MODE 5: full fixture dataset"

doctor:
	$(PYTHON) scripts/orchestrate.py doctor

clean:
	$(PYTHON) scripts/orchestrate.py clean

ingest:
	$(PYTHON) scripts/orchestrate.py ingest --source-mode $(SOURCE_MODE) --source $(SOURCE)

build:
	$(PYTHON) scripts/orchestrate.py build

validate:
	$(PYTHON) scripts/orchestrate.py validate

preview:
	$(PYTHON) scripts/preview.py --port $(PORT) --root candidate

promote:
	$(PYTHON) scripts/orchestrate.py promote

manifest:
	$(PYTHON) scripts/orchestrate.py manifest

publish:
	$(PYTHON) scripts/orchestrate.py publish

smoke:
	$(PYTHON) scripts/orchestrate.py smoke --base-url $(BASE_URL)

release:
	$(PYTHON) scripts/orchestrate.py release --source-mode $(SOURCE_MODE) --source $(SOURCE) --base-url $(BASE_URL)

dry-run:
	$(PYTHON) scripts/orchestrate.py release --source-mode $(SOURCE_MODE) --source $(SOURCE) --base-url $(BASE_URL) --dry-run

test-empty:
	$(PYTHON) scripts/test_modes.py empty --port 8781 --serve-seconds 2

test-dashboard-only:
	$(PYTHON) scripts/test_modes.py dashboard-only --port 8782 --serve-seconds 2

test-partial:
	$(PYTHON) scripts/test_modes.py partial --port 8783 --serve-seconds 2

test-invalid:
	$(PYTHON) scripts/test_modes.py invalid

test-complete:
	$(PYTHON) scripts/test_modes.py complete --port 8784 --serve-seconds 2
