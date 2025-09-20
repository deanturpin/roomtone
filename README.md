# roomtone

🎵 **[Try it live](http://turpin.dev/roomtone/)**

Real-time frequency analyser with musical key detection and bass tone generation. Visualises the acoustic spectrum of your space and responds with complementary bass frequencies.

## Concept

Every room has its own tone - a unique acoustic signature defined by its resonant frequencies. This app discovers those frequencies and uses them as the foundation for generating evolving ambient music that's perfectly tuned to your space.

## Core Features

### Real-time Analysis
- FFT-based frequency spectrum analysis with logarithmic scaling
- Peak frequency detection with musical note identification
- Multi-peak detection for capturing harmonics and overtones
- Room mode detection through frequency persistence tracking
- Musical key detection using harmonic scoring algorithms

### Visual Display
- Live frequency spectrum visualiser with gradient colouring
- Waveform display showing time-domain audio
- 500Hz frequency separator line dividing generation/analysis zones
- Peak frequency highlighting with smooth tracking
- Dominant musical key display with confidence-based opacity

### Tone Generation
- Bass frequency generation below 500Hz to prevent feedback
- Musical key-based tone selection using root and fifth frequencies
- Automatic volume control with smooth ramping
- Real-time response to detected dominant keys
- Immediate stop functionality for feedback prevention

## Technical Implementation

### Web Audio API Stack

- **Audio Input**: `getUserMedia()` for microphone access
- **Analysis**: `AnalyserNode` with 2048 FFT size for frequency analysis
- **Synthesis**: `OscillatorNode` and `GainNode` for bass tone generation
- **Output**: `AudioContext.destination` with proper gain control
- **Canvas**: 2D context for real-time frequency visualisation

### Key Technical Features

- Logarithmic frequency and amplitude scaling for musical representation
- Harmonic scoring algorithm for musical key detection
- Frequency domain separation (500Hz threshold) to prevent feedback
- Smooth peak tracking with configurable smoothing factors
- Real-time canvas rendering optimised for 60fps display

### Deployment

- Static HTML/JS hosted on GitHub Pages
- Local development server via `make serve`
- Auto-deployment via `make deploy`
- HTTPS required for microphone access

## Current Implementation

The application is built around a single `RoomtoneAnalyser` class that handles:

1. **Audio Setup**: Microphone access and Web Audio context creation
2. **Real-time Analysis**: Continuous FFT analysis with peak detection
3. **Visual Rendering**: Canvas-based spectrum and waveform display
4. **Musical Intelligence**: Key detection and harmonic analysis
5. **Tone Generation**: Bass frequency synthesis below 500Hz

### Key Methods

- `setupAudio()`: Initialises microphone and audio analysis chain
- `analyse()`: Main analysis loop with FFT processing and peak detection
- `detectMusicalKey()`: Harmonic scoring algorithm for key identification
- `updateToneGeneration()`: Bass tone synthesis based on detected keys
- `drawSpectrum()`: Real-time frequency visualisation with musical annotations

## UI Design

### Minimal Interface

- Large start/stop button (tap to begin)
- Frequency spectrum visualiser
- Detected room frequencies display
- Volume/mix controls
- Recording/export button

### Visual Feedback

- Real-time spectrum analyser
- Pulsing indicators for detected resonances
- Waveform of current loop buffer
- Ambient, calming colour schemes

## Use Cases

### Mindfulness & Wellness
- **Yoga Classes**: Group hum sets the session's key, app provides harmonic foundation
- **Meditation**: Gentle tonal support that adapts to natural breathing sounds
- **Sound Healing**: Responds to singing bowls, chanting, vocal toning
- **Group Practice**: Creates unified harmonic space from collective voice

### Creative & Professional
- **Musical Discovery**: Find your room's acoustic character and resonant frequencies
- **Installation Art**: Site-specific generative music responding to space
- **Focus Work**: Adaptive ambient atmosphere that responds to environmental sound
- **Travel**: Transform any space (hotels, airports, studios) with harmonic presence

### Acoustic Exploration
- **Room Analysis**: Understand your space's natural frequency response
- **Tuning Reference**: Vallotti temperament for historically-informed practice
- **Harmonic Education**: Visual learning about frequency, resonance, and musical relationships

## Development Priorities

1. **MVP**: Microphone capture → frequency analysis → display resonances
2. **Audio Loop**: Basic recording buffer with playback
3. **Feedback Prevention**: Subtract output from input
4. **Musical Enhancement**: Quantise to scales, add rhythm
5. **Polish**: UI, visualisations, export features

## Privacy & Permissions

- All processing happens locally in browser
- No audio data sent to servers
- Microphone permission required (one-time prompt)
- Clear visual indicator when recording

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Limited (stricter autoplay policies)
- Mobile: Works via browser, better as PWA

## Future Enhancements

- Machine learning for pattern recognition
- Collaborative mode (multiple devices in same room)
- Preset "moods" or generative strategies
- MIDI output for controlling synthesizers
- Integration with smart home systems
