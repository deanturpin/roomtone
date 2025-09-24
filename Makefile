.PHONY: help lint deploy serve tag stats update-stable

help:
	@echo "Available targets:"
	@echo "  serve         - Start local development server"
	@echo "  lint          - Lint all Markdown files"
	@echo "  deploy        - Auto-commit and push changes"
	@echo "  stats         - Generate codebase statistics"
	@echo "  tag           - Create git tag with version and update stable release"
	@echo "  update-stable - Update stable to most recent git tag"

serve: update-version
	@echo "Starting local server at http://localhost:9001"
	@cd docs/latest && python3 -m http.server 9001

update-version:
	@echo "const GIT_VERSION = '$$(git rev-parse --short HEAD)';" > docs/version.js
	@echo "const GIT_SUMMARY = '$$(git log -1 --pretty=format:"%s")';" >> docs/version.js

lint:
	@echo "Linting Markdown files..."
	@command -v markdownlint-cli2 >/dev/null 2>&1 && markdownlint-cli2 "**/*.md" || \
	command -v markdownlint >/dev/null 2>&1 && markdownlint "**/*.md" || \
	command -v mdl >/dev/null 2>&1 && mdl . || \
	echo "No Markdown linter found. Consider installing markdownlint-cli2, markdownlint, or mdl"

stats:
	@echo "Generating codebase statistics..."
	./generate-stats.sh

update-stable:
	@LATEST_TAG=$$(git describe --tags --abbrev=0 2>/dev/null || echo "") && \
	if [ -z "$$LATEST_TAG" ]; then \
		echo "No tags found. Create a tag first with 'make tag'"; \
		exit 1; \
	fi && \
	echo "Updating stable to latest tag: $$LATEST_TAG" && \
	echo "Copying app files from $$LATEST_TAG to stable..." && \
	if git show $$LATEST_TAG:docs/latest/app.js >/dev/null 2>&1; then \
		echo "Using latest/ directory structure from $$LATEST_TAG"; \
		git show $$LATEST_TAG:docs/latest/app.js > docs/stable/app.js; \
		git show $$LATEST_TAG:docs/latest/index.html > docs/stable/index.html; \
		git show $$LATEST_TAG:docs/latest/style.css > docs/stable/style.css; \
		git show $$LATEST_TAG:docs/latest/auto-refresh.js > docs/stable/auto-refresh.js; \
		git show $$LATEST_TAG:docs/latest/favicon.svg > docs/stable/favicon.svg; \
		git show $$LATEST_TAG:docs/latest/version.js > docs/stable/version.js; \
	else \
		echo "Using docs/ directory structure from $$LATEST_TAG"; \
		git show $$LATEST_TAG:docs/app.js > docs/stable/app.js; \
		git show $$LATEST_TAG:docs/index.html > docs/stable/index.html; \
		git show $$LATEST_TAG:docs/style.css > docs/stable/style.css; \
		git show $$LATEST_TAG:docs/auto-refresh.js > docs/stable/auto-refresh.js; \
		git show $$LATEST_TAG:docs/favicon.svg > docs/stable/favicon.svg; \
		git show $$LATEST_TAG:docs/version.js > docs/stable/version.js 2>/dev/null || echo "const GIT_VERSION = '$$LATEST_TAG';" > docs/stable/version.js; \
	fi && \
	git add docs/stable/ && \
	git commit -m "Update stable to $$LATEST_TAG 🤖" && \
	git push && \
	echo "Stable updated to $$LATEST_TAG"

tag: stats
	@read -p "Enter version tag (e.g., v1.0.0): " VERSION && \
	echo "Creating tag $$VERSION..." && \
	git add docs/stats.json && \
	git commit -m "Update stats for $$VERSION 🤖" && \
	git tag -a $$VERSION -m "Release $$VERSION" && \
	git push && git push --tags && \
	echo "Tagged $$VERSION. Run 'make update-stable' to update stable release." && \
	$(MAKE) update-stable

deploy: lint update-version sync-to-root
	git add -A && git commit -m "Auto-commit from make deploy 🤖" && git push

sync-to-root:
	@echo "Syncing latest app to root for live site..."
	@cp docs/latest/index.html docs/index.html
	@cp docs/latest/app.js docs/app.js
	@cp docs/latest/style.css docs/style.css