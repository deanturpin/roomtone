.PHONY: help lint deploy

help:
	@echo "Available targets:"
	@echo "  lint   - Lint all Markdown files"
	@echo "  deploy - Auto-commit and push changes"

lint:
	@echo "Linting Markdown files..."
	@command -v markdownlint-cli2 >/dev/null 2>&1 && markdownlint-cli2 "**/*.md" || \
	command -v markdownlint >/dev/null 2>&1 && markdownlint "**/*.md" || \
	command -v mdl >/dev/null 2>&1 && mdl . || \
	echo "No Markdown linter found. Consider installing markdownlint-cli2, markdownlint, or mdl"

deploy: lint
	git add -A && git commit -m "Auto-commit from make deploy 🤖" && git push