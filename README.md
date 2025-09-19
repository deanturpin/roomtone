# roomtone

Generative music app that analyses room acoustics and creates ambient soundscapes from environmental audio.

## Concept

Every room has its own tone - a unique acoustic signature defined by its resonant frequencies. This app discovers those frequencies and uses them as the foundation for generating evolving ambient music that's perfectly tuned to your space.

## Core Features

### Room Analysis

- Detect resonant frequencies through FFT analysis of ambient noise
- Identify persistent peaks in the frequency spectrum
- Calculate room modes from acoustic response
- Track dominant frequencies over time

### Audio Processing

- Real-time microphone capture with permission handling
- Feedback prevention through internal loop subtraction
- FIFO buffer for evolving soundscapes
- Loop detection in ambient noise
- Granular synthesis from captured fragments

### Generative Engine

- Use room resonances as root notes/harmonics
- Musical scale quantisation
- Construct loops from environmental sounds
- Gradual evolution through buffer cycling
- Two-phase approach:
  1. Pure environmental sound processing
  2. Musical hints (key, tempo, mode)

## Technical Implementation

### Web Audio API Stack

- **Audio Input**: `getUserMedia()` for microphone access
- **Analysis**: `AnalyserNode` for FFT/frequency analysis
- **Processing**: `ScriptProcessorNode` or `AudioWorklet` for custom DSP
- **Synthesis**: `OscillatorNode`, `GainNode` for tone generation
- **Effects**: `ConvolverNode`, `DelayNode`, `BiquadFilterNode`
- **Output**: `AudioContext.destination`

### Libraries

- **Tone.js**: High-level audio framework
- **p5.js**: Frequency spectrum visualisation
- **Meyda**: Audio feature extraction

### Deployment

- Static HTML/JS (works anywhere)
- GitHub Pages / Vercel hosting
- PWA manifest for mobile installation
- HTTPS required for microphone access

## Implementation Steps

### Phase 1: Room Analysis

```javascript
// Basic room resonance detector
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
analyser.fftSize = 2048;

navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function detectResonances() {
      analyser.getByteFrequencyData(dataArray);
      // Find peaks in frequency spectrum
      // Track persistent frequencies over time
      requestAnimationFrame(detectResonances);
    }
    detectResonances();
  });
```

### Phase 2: Audio Capture & Loop Buffer

```javascript
// Circular buffer for evolving soundscape
class LoopBuffer {
  constructor(duration, sampleRate) {
    this.buffer = new Float32Array(duration * sampleRate);
    this.writeIndex = 0;
  }

  write(samples) {
    // Add new samples, subtract old playback (feedback prevention)
  }

  read() {
    // Return current loop for playback
  }
}
```

### Phase 3: Generative Processing

- Detect interesting audio events (transients, tonal content)
- Slice and reorganise captured audio
- Apply musical quantisation based on room's resonant frequencies
- Layer multiple loops at different time scales

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

- **Relaxation**: Generate calming soundscapes in any space
- **Focus**: Consistent background atmosphere for work
- **Travel**: Transform hotel rooms, airports, coffee shops
- **Installation**: Site-specific generative music
- **Musical Tool**: Discover your room's musical potential

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
