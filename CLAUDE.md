# roomtone Development Guidelines

## Project Overview

roomtone is a real-time frequency analyser with musical key detection and bass tone generation. The app visualises the acoustic spectrum of your space and responds with complementary bass frequencies below 500Hz to prevent feedback loops.

## Development Standards

- Always lint Markdown files before committing
- Use the Makefile for deployment (includes linting)
- Follow Web Audio API best practices
- Ensure microphone permissions are handled gracefully
- All audio processing happens locally (privacy-first)
- Maintain 500Hz frequency separation for feedback prevention
- Test tone generation at safe volumes

## Code Style

- Use modern JavaScript (ES6+)
- Prefer const over let
- Clear function and variable naming
- No unnecessary comments

## Testing

- Test microphone capture across different browsers
- Verify feedback prevention works correctly (500Hz separation)
- Check frequency analysis accuracy and peak detection
- Test musical key detection with various audio sources
- Verify tone generation starts/stops properly
- Test on both desktop and mobile devices

## Key Features Implemented

- Real-time FFT analysis with logarithmic scaling
- Musical note identification and peak frequency tracking
- Harmonic scoring for musical key detection
- Bass tone generation below 500Hz threshold
- Canvas-based spectrum and waveform visualisation
- Frequency domain separation to prevent feedback loops
- Smooth visual transitions and auto-refresh development setup

## Commit Messages

- Use 🤖 emoji for auto-commits
- Clear, concise descriptions
- Reference issues when relevant