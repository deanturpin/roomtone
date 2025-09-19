# roomtone Development Guidelines

## Project Overview

roomtone is a generative music app that analyses room acoustics and creates ambient soundscapes from environmental audio.

## Development Standards

- Always lint Markdown files before committing
- Use the Makefile for deployment (includes linting)
- Follow Web Audio API best practices
- Ensure microphone permissions are handled gracefully
- All audio processing happens locally (privacy-first)

## Code Style

- Use modern JavaScript (ES6+)
- Prefer const over let
- Clear function and variable naming
- No unnecessary comments

## Testing

- Test microphone capture across different browsers
- Verify feedback prevention works correctly
- Check frequency analysis accuracy
- Test on both desktop and mobile devices

## Commit Messages

- Use 🤖 emoji for auto-commits
- Clear, concise descriptions
- Reference issues when relevant