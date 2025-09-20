# roomtone Development Guidelines

## Project Overview

roomtone is a real-time frequency analyser with musical key detection and bass tone generation. The app visualises the acoustic spectrum of your space and responds with complementary bass frequencies to create harmonic room tones.

## Development Standards

- Always lint Markdown files before committing
- Use the Makefile for deployment (includes linting)
- Follow Web Audio API best practices
- Ensure microphone permissions are handled gracefully
- All audio processing happens locally (privacy-first)
- Focus on bass frequency range for room tone generation
- Test tone generation at safe volumes

## Code Style

- Use modern JavaScript (ES6+)
- Prefer const over let
- Clear function and variable naming
- No unnecessary comments

## Testing

- Test microphone capture across different browsers
- Test bass tone generation and volume controls
- Check frequency analysis accuracy and peak detection
- Test musical key detection with various audio sources
- Verify tone generation starts/stops properly
- Test on both desktop and mobile devices

## Key Features Implemented

- Real-time FFT analysis with logarithmic scaling
- Musical note identification and peak frequency tracking
- Harmonic scoring for musical key detection
- Bass tone generation for harmonic room foundation
- Canvas-based spectrum and waveform visualisation
- Visual spectrum analysis with configurable frequency ranges
- Smooth visual transitions and auto-refresh development setup

## Commit Messages

- Use 🤖 emoji for auto-commits
- Clear, concise descriptions
- Reference issues when relevant