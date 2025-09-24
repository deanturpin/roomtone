# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# roomtone Development Guidelines

## Project Overview

roomtone is a real-time frequency analyser with musical key detection and
bass tone generation. The app visualises the acoustic spectrum of your space
and responds with complementary bass frequencies to create harmonic room tones.

## Development Standards

- Always lint Markdown files before committing
- Use the Makefile for deployment (includes linting)
- Follow Web Audio API best practices
- Ensure microphone permissions are handled gracefully
- All audio processing happens locally (privacy-first)
- Focus on bass frequency range for room tone generation
- Test tone generation at safe volumes

## Build System and Deployment

### Three-Tier Architecture

1. **Landing Page** (`docs/index.html`):
   - Enhanced animated banner with glow and shimmer effects
   - Live project statistics loaded from `stats.json`
   - Links to Latest and Stable versions
   - Responsive design with mobile optimizations

2. **Latest Build** (`docs/latest/`):
   - Development version updated with every `make deploy`
   - Contains cutting-edge features and improvements
   - Automatically includes latest git hash with commit message links

3. **Stable Build** (`docs/stable/`):
   - Production version pointing to most recent git tag
   - Updated only when creating releases with `make tag`
   - Represents tested, stable functionality

### Release Commands

- `make serve` - Local development server with auto-version updates
- `make deploy` - Lint, commit, and push latest changes
- `make stats` - Generate codebase statistics JSON
- `make tag` - Interactive release creation (stats + tag + stable update)
- `make update-stable` - Manually sync stable to latest git tag

### Statistics System

The `generate-stats.sh` script automatically counts:

- Lines of code by language (JavaScript, HTML, CSS, Markdown)
- File counts and git commit statistics
- Outputs to `docs/stats.json` for landing page display

## Architecture

### Core Components

The application is built around a single `RoomtoneAnalyser` class in `docs/latest/app.js` that manages:

- **Audio Chain**: `getUserMedia()` → `AnalyserNode` (FFT) → Canvas visualisation
- **MIDI Input**: Web MIDI API for USB keyboard/controller support with polyphonic playback
- **Synthesis**: `OscillatorNode` + `GainNode` for bass tone generation and MIDI note playback
- **Visual Rendering**: Real-time Canvas 2D spectrum and waveform display with musical annotations

### Key Data Flows

1. **Analysis Loop**: Microphone → FFT → Peak detection → Musical key detection → Bass tone generation
2. **MIDI Processing**: USB controller → Web MIDI API → Note conversion → Oscillator synthesis
3. **Visual Pipeline**: Audio data → Canvas rendering (spectrum + waveform) → 60fps updates

### File Structure

- `docs/index.html`: Landing page with animated banner and project statistics
- `docs/latest/`: Development build (auto-updated via `make deploy`)
- `docs/stable/`: Production release (points to latest git tag)
- `generate-stats.sh`: Automated codebase statistics for landing page
- `Makefile`: Build system with deployment, tagging, and release management

## Code Style

- Use modern JavaScript (ES6+)
- Prefer const over let
- Clear function and variable naming
- No unnecessary comments

## Testing

### Feature Testing

- Test microphone capture across different browsers
- Test bass tone generation and volume controls
- Check frequency analysis accuracy and peak detection
- Test musical key detection with various audio sources
- Verify tone generation starts/stops properly
- Test MIDI keyboard input and velocity sensitivity
- Verify git hash links work correctly in both builds

### Build Testing

- Test landing page statistics loading and display
- Verify Latest build updates with development changes
- Confirm Stable build reflects tagged release functionality
- Test responsive design on mobile devices
- Verify all version links work correctly across builds

## Key Features Implemented

### Core Audio Features

- Real-time FFT analysis with logarithmic scaling
- Musical note identification and peak frequency tracking
- Harmonic scoring for musical key detection
- Bass tone generation for harmonic room foundation
- MIDI keyboard input with velocity-sensitive polyphonic playback
- Canvas-based spectrum and waveform visualisation

### User Interface

- Enhanced animated landing page banner with glow and shimmer effects
- Responsive design optimised for mobile and desktop
- Live project statistics with automatic updates
- Clickable git version hashes linking to GitHub commits
- Visual spectrum analysis with configurable frequency ranges
- Smooth visual transitions and auto-refresh development setup

### Development Infrastructure

- Three-tier build system (Landing/Latest/Stable)
- Automated statistics generation and deployment
- Git tag-based release management
- Comprehensive linting and code quality checks

## Commit Messages

- Use 🤖 emoji for auto-commits
- Clear, concise descriptions
- Reference issues when relevant
