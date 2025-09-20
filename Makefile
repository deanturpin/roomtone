.PHONY: help lint deploy serve tag stats

help:
	@echo "Available targets:"
	@echo "  serve  - Start local development server"
	@echo "  lint   - Lint all Markdown files"
	@echo "  deploy - Auto-commit and push changes"
	@echo "  stats  - Generate codebase statistics"
	@echo "  tag    - Create git tag with version and update stable release"

serve: update-version
	@echo "Starting local server at http://localhost:8000"
	@cd docs && python3 -m http.server 8000

update-version:
	@echo "const GIT_VERSION = '$$(git rev-parse --short HEAD)';" > docs/version.js

lint:
	@echo "Linting Markdown files..."
	@command -v markdownlint-cli2 >/dev/null 2>&1 && markdownlint-cli2 "**/*.md" || \
	command -v markdownlint >/dev/null 2>&1 && markdownlint "**/*.md" || \
	command -v mdl >/dev/null 2>&1 && mdl . || \
	echo "No Markdown linter found. Consider installing markdownlint-cli2, markdownlint, or mdl"

stats:
	@echo "Generating codebase statistics..."
	./generate-stats.sh

tag: stats
	@read -p "Enter version tag (e.g., v1.0.0): " VERSION && \
	echo "Creating tag $$VERSION..." && \
	git add docs/stats.json && \
	git commit -m "Update stats for $$VERSION 🤖" && \
	git tag -a $$VERSION -m "Release $$VERSION" && \
	echo "Copying latest to stable..." && \
	cp docs/latest/* docs/stable/ && \
	git add docs/stable/ && \
	git commit -m "Update stable to $$VERSION 🤖" && \
	git push && git push --tags && \
	echo "Tagged $$VERSION and updated stable release"

deploy: lint update-version
	git add -A && git commit -m "Auto-commit from make deploy 🤖" && git push