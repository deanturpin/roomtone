class RoomtoneAnalyser {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.mediaStream = null;
        this.animationId = null;
        this.isRunning = false;

        this.spectrumCanvas = document.getElementById('spectrum');
        this.spectrumCtx = this.spectrumCanvas?.getContext('2d');

        this.toneWaveCanvas = document.getElementById('toneWave');
        this.toneWaveCtx = this.toneWaveCanvas?.getContext('2d');


        this.toggleBtn = document.getElementById('toggleBtn');
        this.piano = document.getElementById('piano');
        this.activePianoTones = new Map();

        // Note: activeNotes and activeChord elements removed

        this.smoothedPeakFreq = 0;
        this.smoothedPeakX = 0;
        this.smoothingFactor = 0.92; // Back to stable smoothing
        this.currentNote = '';
        this.smoothedNote = '';
        this.peakFadeOpacity = 0; // For fading peak indicators
        this.lastPeakTime = Date.now(); // Initialize to now to prevent immediate fading
        this.smoothedAmplitudes = new Array(2048).fill(0); // For smooth FFT bars

        // Peak selection hysteresis
        this.selectedTonePeak = null;
        this.peakHysteresisThreshold = 0.3; // Require 30% amplitude difference to switch peaks
        this.peakStabilityCounter = 0;
        this.peakStabilityRequired = 3; // Require 3 consecutive frames before switching

        // Audio feedback control
        this.audioFeedbackEnabled = true;

        // Room mode detection
        this.frequencyHistory = new Map();
        this.roomModes = [];
        this.modeDetectionStartTime = Date.now();
        this.minDetectionTime = 10000; // 10 seconds minimum

        // Tone generation
        this.oscillators = [];
        this.gainNode = null;
        this.reverbNode = null;
        this.currentToneKey = null;
        this.harmonicOscillators = new Map(); // Track individual harmonic oscillators
        this.settledFrequencies = new Map(); // Track frequencies that have settled
        this.toneStartTime = null; // Track when current tone started
        this.toneDuration = 10000; // 10 seconds
        this.fadeOutDuration = 2000; // 2 second fade out

        // Background noise sampling
        this.audioRecorder = null;
        this.recordedChunks = [];
        this.isRecording = false;
        this.recordingStartTime = null;
        this.recordingDuration = 10000; // 10 seconds

        // Jungle ambience
        this.jungleOscillators = [];
        this.jungleGain = null;
        this.jungleEnabled = false;

        // MIDI support
        this.midiAccess = null;
        this.activeMidiNotes = new Map(); // Track active MIDI notes

        // Synth parameters (optimized defaults)
        this.synthParams = {
            attack: 0.05,
            decay: 0.3,
            sustain: 0.7,
            release: 1.8,
            filterCutoff: 3500,
            filterQ: 2.5,
            filterType: 'lowpass',
            waveform: 'sawtooth',
            detune: 0
        };
        this.reversedAudioBuffer = null;

        // Frequency tooltip
        this.tooltip = null;
        this.mouseX = 0;
        this.mouseY = 0;
        this.showTooltip = false;

        // Draggable threshold
        this.isDraggingThreshold = false;
        this.thresholdValue = 128; // Default threshold


        this.setupCanvases();
        this.setupTooltip();
        this.bindEvents();
        this.setupMIDI();
    }

    setupCanvases() {
        const resize = () => {
            this.spectrumCanvas.width = this.spectrumCanvas.offsetWidth * window.devicePixelRatio;
            this.spectrumCanvas.height = this.spectrumCanvas.offsetHeight * window.devicePixelRatio;
            this.spectrumCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };

        resize();
        window.addEventListener('resize', resize);
    }

    setupTooltip() {
        // Create tooltip element
        this.tooltip = document.createElement('div');
        this.tooltip.id = 'frequency-tooltip';
        this.tooltip.style.cssText = `
            position: absolute;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-family: monospace;
            pointer-events: none;
            z-index: 1000;
            display: none;
            white-space: nowrap;
        `;
        document.body.appendChild(this.tooltip);

        // Add mouse event listeners to spectrum canvas
        this.spectrumCanvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.spectrumCanvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.spectrumCanvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.spectrumCanvas.addEventListener('mouseenter', () => this.showTooltip = true);
        this.spectrumCanvas.addEventListener('mouseleave', () => {
            this.showTooltip = false;
            this.tooltip.style.display = 'none';
            this.isDraggingThreshold = false;
        });
    }

    handleMouseMove(event) {
        if (!this.audioContext) return;

        const rect = this.spectrumCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        if (this.isDraggingThreshold) {
            // Update threshold based on y position, using same scale as visual line
            const height = this.spectrumCanvas.offsetHeight;
            const normalizedY = Math.max(0, Math.min(1, y / height));
            // Account for the 0.8 height scaling used in the visual display
            this.thresholdValue = Math.round((1 - normalizedY) * 255 / 0.8); // Invert Y and scale to match visual

            // Update cursor
            this.spectrumCanvas.style.cursor = 'ns-resize';

            // Don't show frequency tooltip while dragging
            this.tooltip.style.display = 'none';
            return;
        }

        // Check if mouse is near threshold line
        const isNearThreshold = this.isNearThresholdLine(y);

        if (isNearThreshold) {
            this.spectrumCanvas.style.cursor = 'ns-resize';
            // Show threshold value with drag indicator
            this.tooltip.innerHTML = `↕ Threshold: ${this.thresholdValue}`;
            this.tooltip.style.left = (event.clientX + 10) + 'px';
            this.tooltip.style.top = (event.clientY - 30) + 'px';
            this.tooltip.style.display = 'block';
        } else {
            this.spectrumCanvas.style.cursor = 'default';

            if (this.showTooltip) {
                // Convert canvas position to frequency
                const frequency = this.getFrequencyFromX(x);
                const note = this.frequencyToNote(frequency);

                // Update tooltip content and position
                this.tooltip.innerHTML = `${frequency.toFixed(1)} Hz<br>${note}`;
                this.tooltip.style.left = (event.clientX + 10) + 'px';
                this.tooltip.style.top = (event.clientY - 30) + 'px';
                this.tooltip.style.display = 'block';
            }
        }
    }

    handleMouseDown(event) {
        const rect = this.spectrumCanvas.getBoundingClientRect();
        const y = event.clientY - rect.top;

        if (this.isNearThresholdLine(y)) {
            this.isDraggingThreshold = true;
            this.showTooltip = false;
            event.preventDefault();
        }
    }

    handleMouseUp(event) {
        this.isDraggingThreshold = false;
        this.spectrumCanvas.style.cursor = 'default';
        this.showTooltip = true;
    }

    isNearThresholdLine(mouseY) {
        const height = this.spectrumCanvas.offsetHeight;
        // Use the same calculation as drawThresholdLine
        const thresholdY = height - (height * 0.8 * (this.thresholdValue/255));
        return Math.abs(mouseY - thresholdY) < 10; // 10px tolerance
    }

    getFrequencyFromX(x) {
        const width = this.spectrumCanvas.offsetWidth;
        const nyquist = this.audioContext.sampleRate / 2;

        // Use logarithmic scale (same as spectrum display)
        const minFreq = 20;
        const maxFreq = nyquist;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);

        const logFreq = logMin + (x / width) * (logMax - logMin);
        return Math.pow(10, logFreq);
    }

    bindEvents() {
        this.toggleBtn.addEventListener('click', () => {
            console.log('Toggle button clicked!');
            try {
                this.toggle();
            } catch (error) {
                console.error('Error in toggle():', error);
            }
        });
        this.bindPianoEvents();
        this.bindKeyboardEvents();
    }

    bindKeyboardEvents() {
        // Add spacebar toggle for audio feedback
        document.addEventListener('keydown', (e) => {
            // Only handle spacebar if we're not in an input field
            if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                this.toggleAudioFeedback();
            }
        });
    }

    toggleAudioFeedback() {
        this.audioFeedbackEnabled = !this.audioFeedbackEnabled;

        // Show visual feedback
        const message = this.audioFeedbackEnabled ? 'Audio Feedback ON' : 'Audio Feedback OFF';
        this.showFeedbackMessage(message);

        // If turning off, stop any current tones
        if (!this.audioFeedbackEnabled) {
            this.stopAllToneGeneration();
        }
    }

    showFeedbackMessage(message) {
        // Create temporary message overlay
        const messageDiv = document.createElement('div');
        messageDiv.textContent = message;
        messageDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(74, 158, 255, 0.9);
            color: white;
            padding: 1rem 2rem;
            border-radius: 8px;
            font-size: 1.2rem;
            font-weight: bold;
            z-index: 10000;
            pointer-events: none;
        `;
        document.body.appendChild(messageDiv);

        // Remove after 2 seconds
        setTimeout(() => {
            document.body.removeChild(messageDiv);
        }, 2000);
    }

    stopAllToneGeneration() {
        // Stop current primary peak tone quickly
        if (this.currentPrimaryPeakGain) {
            this.currentPrimaryPeakGain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.02);
        }

        // Stop peak tones
        if (this.activePianoTones) {
            for (const [freq, tone] of this.activePianoTones) {
                if (tone.gains) {
                    tone.gains.forEach(gain => {
                        if (gain) gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.02);
                    });
                }
                setTimeout(() => {
                    if (tone.oscillators) {
                        tone.oscillators.forEach(osc => {
                            try { osc.stop(); } catch (e) {}
                        });
                    }
                }, 50);
            }
            this.activePianoTones.clear();
        }

        // Stop room tone generation
        this.stopToneGeneration();
    }

    bindPianoEvents() {
        const pianoKeys = this.piano.querySelectorAll('.piano-key');
        this.isDragging = false;
        this.currentDragKey = null;

        pianoKeys.forEach(key => {
            key.addEventListener('mousedown', (e) => {
                this.isDragging = true;
                this.playPianoKey(e.target);
                e.preventDefault();
            });

            key.addEventListener('mouseenter', (e) => {
                if (this.isDragging) {
                    if (this.currentDragKey && this.currentDragKey !== e.target) {
                        this.stopPianoKey(this.currentDragKey);
                    }
                    this.playPianoKey(e.target);
                }
            });

            key.addEventListener('mouseleave', (e) => {
                if (!this.isDragging) {
                    this.stopPianoKey(e.target);
                }
            });
        });

        // Global mouse up to stop dragging
        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                if (this.currentDragKey) {
                    this.stopPianoKey(this.currentDragKey);
                    this.currentDragKey = null;
                }
            }
        });

        // Touch events for mobile
        pianoKeys.forEach(key => {
            key.addEventListener('touchstart', (e) => {
                this.isDragging = true;
                this.currentDragKey = e.target;
                this.playPianoKey(e.target);
                e.preventDefault();
            });

            key.addEventListener('touchmove', (e) => {
                if (this.isDragging) {
                    const touch = e.touches[0];
                    const element = document.elementFromPoint(touch.clientX, touch.clientY);
                    if (element && element.classList.contains('piano-key') && element !== this.currentDragKey) {
                        if (this.currentDragKey) {
                            this.stopPianoKey(this.currentDragKey);
                        }
                        this.currentDragKey = element;
                        this.playPianoKey(element);
                    }
                }
                e.preventDefault();
            });

            key.addEventListener('touchend', (e) => {
                this.isDragging = false;
                if (this.currentDragKey) {
                    this.stopPianoKey(this.currentDragKey);
                    this.currentDragKey = null;
                }
                e.preventDefault();
            });
        });
    }

    toggle() {
        console.log('Toggle called, isRunning:', this.isRunning);
        if (this.isRunning) {
            console.log('Stopping...');
            this.stop();
        } else {
            console.log('Starting...');
            this.start();
        }
    }

    async start() {
        console.log('Start method called');
        try {
            console.log('Creating AudioContext...');
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Resume AudioContext if suspended (required by some browsers)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            console.log('Requesting microphone access...');
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });
            console.log('Microphone access granted!');

            this.mediaStream = stream;
            this.microphone = this.audioContext.createMediaStreamSource(stream);

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 4096;
            this.analyser.smoothingTimeConstant = 0.8;

            this.microphone.connect(this.analyser);

            // Set up tone generation
            this.setupToneGeneration();

            // Start jungle ambience
            this.startJungleAmbience();

            this.isRunning = true;

            // Hide the entire header after starting
            const header = document.querySelector('header');
            if (header) {
                header.style.display = 'none';
            }

            this.piano.style.display = 'flex';

            this.draw();
        } catch (error) {
            console.error('Error accessing microphone:', error);
            // Don't show alert for auto-start failures
            if (error.name !== 'NotAllowedError') {
                alert('Unable to access microphone. Please ensure permissions are granted.');
            }
            throw error; // Re-throw so auto-start can handle it
        }
    }

    stop() {
        this.isRunning = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        // Hide tooltip
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }

        if (this.microphone) {
            this.microphone.disconnect();
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }

        if (this.audioContext) {
            this.stopToneGeneration();
            this.stopJungleAmbience();
            this.stopAllMIDINotes();
            this.audioContext.close();
        }

        // Show the header again when stopping
        const header = document.querySelector('header');
        if (header) {
            header.style.display = 'flex';
        }

        this.toggleBtn.textContent = 'Start Listening';
        this.toggleBtn.classList.remove('btn-secondary');
        this.toggleBtn.classList.add('btn-primary');
        this.piano.style.display = 'none';

        this.clearCanvases();
    }



    playPeakTone(frequency, amplitude) {
        if (!this.audioContext) return;

        try {
            // Transpose detected frequencies above 500Hz down 2 octaves for bass range
            const BASS_FREQUENCY_LIMIT = 500;
            let playbackFrequency = frequency;
            while (playbackFrequency > BASS_FREQUENCY_LIMIT) {
                playbackFrequency = playbackFrequency / 4; // Down 2 octaves
            }

            // Fade out any existing primary peak tone
            if (this.currentPrimaryPeakGain) {
                this.currentPrimaryPeakGain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.5);
            }

            // Create a quick tone that matches the detected peak (transposed to bass range)
            const peakOsc = this.audioContext.createOscillator();
            const peakGain = this.audioContext.createGain();

            peakOsc.frequency.setValueAtTime(playbackFrequency, this.audioContext.currentTime);
            peakOsc.type = 'sine';

            // Volume based on peak strength
            const volume = Math.min((amplitude / 255) * 0.15, 0.1);
            peakGain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
            peakGain.gain.exponentialRampToValueAtTime(volume, this.audioContext.currentTime + 2.0); // Very slow, meditative swell
            peakGain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 2.5); // Much longer fade out

            // Connect through reverb for ambient effect
            peakOsc.connect(peakGain);
            if (this.reverbNode) {
                peakGain.connect(this.reverbNode);
            } else {
                peakGain.connect(this.audioContext.destination);
            }

            // Store reference to current primary peak for fading
            this.currentPrimaryPeakGain = peakGain;

            peakOsc.start();
            peakOsc.stop(this.audioContext.currentTime + 2.6); // Longer total duration

            // Clear reference after tone ends
            setTimeout(() => {
                if (this.currentPrimaryPeakGain === peakGain) {
                    this.currentPrimaryPeakGain = null;
                }
            }, 2700);


        } catch (error) {
            console.error('Error playing peak tone:', error);
        }
    }

    createPianoTone(frequency, velocity = 1.0, note = '') {
        if (!this.audioContext) return null;

        // Play manual input (piano/MIDI) at original frequency
        let playbackFrequency = frequency;

        if (this.activePianoTones.has(playbackFrequency)) return null; // Already playing

        try {
            // Create piano-like sound with multiple harmonics
            const fundamentalOsc = this.audioContext.createOscillator();
            const harmonicOsc1 = this.audioContext.createOscillator();
            const harmonicOsc2 = this.audioContext.createOscillator();

            const pianoGain = this.audioContext.createGain();
            const harmonicGain1 = this.audioContext.createGain();
            const harmonicGain2 = this.audioContext.createGain();

            // Set frequencies using the transposed frequency
            fundamentalOsc.frequency.setValueAtTime(playbackFrequency, this.audioContext.currentTime);
            harmonicOsc1.frequency.setValueAtTime(playbackFrequency * 2, this.audioContext.currentTime); // Octave
            harmonicOsc2.frequency.setValueAtTime(playbackFrequency * 3, this.audioContext.currentTime); // Fifth

            // Piano-like waveforms
            fundamentalOsc.type = 'sawtooth';
            harmonicOsc1.type = 'triangle';
            harmonicOsc2.type = 'sine';

            // Volume mixing based on velocity
            const baseVolume = velocity * 0.15;
            pianoGain.gain.setValueAtTime(0, this.audioContext.currentTime);
            harmonicGain1.gain.setValueAtTime(0, this.audioContext.currentTime);
            harmonicGain2.gain.setValueAtTime(0, this.audioContext.currentTime);

            // Quick attack for piano-like sound
            pianoGain.gain.exponentialRampToValueAtTime(baseVolume, this.audioContext.currentTime + 0.02);
            harmonicGain1.gain.exponentialRampToValueAtTime(baseVolume * 0.3, this.audioContext.currentTime + 0.02);
            harmonicGain2.gain.exponentialRampToValueAtTime(baseVolume * 0.1, this.audioContext.currentTime + 0.02);

            // Connect the audio chain
            fundamentalOsc.connect(pianoGain);
            harmonicOsc1.connect(harmonicGain1);
            harmonicOsc2.connect(harmonicGain2);

            pianoGain.connect(this.audioContext.destination);
            harmonicGain1.connect(this.audioContext.destination);
            harmonicGain2.connect(this.audioContext.destination);

            fundamentalOsc.start();
            harmonicOsc1.start();
            harmonicOsc2.start();

            const toneData = {
                oscillators: [fundamentalOsc, harmonicOsc1, harmonicOsc2],
                gains: [pianoGain, harmonicGain1, harmonicGain2],
                note: note
            };

            this.activePianoTones.set(playbackFrequency, toneData);
            return toneData;

        } catch (error) {
            console.error('Error creating piano tone:', error);
            return null;
        }
    }

    playPianoKey(keyElement) {
        if (!this.audioContext || !this.gainNode) return;

        const frequency = parseFloat(keyElement.dataset.freq);
        const note = keyElement.dataset.note;

        // Use unified piano tone creation
        const toneData = this.createPianoTone(frequency, 1.0, note);
        if (toneData) {
            this.currentDragKey = keyElement;
            keyElement.style.transform = 'translateY(1px)';
        }
    }

    stopPianoKey(keyElement) {
        const frequency = parseFloat(keyElement.dataset.freq);

        // Use original frequency for manual piano input
        const playbackFrequency = frequency;

        if (!this.activePianoTones.has(playbackFrequency)) return;

        const tone = this.activePianoTones.get(playbackFrequency);

        // Sustained release for realistic piano sound
        const sustainTime = 2.5; // 2.5 second sustain
        if (tone.gains) {
            tone.gains.forEach(gain => {
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + sustainTime);
            });
        } else if (tone.gain) {
            // Fallback for old single-oscillator format
            tone.gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + sustainTime);
        }

        setTimeout(() => {
            try {
                if (tone.oscillators) {
                    tone.oscillators.forEach(osc => osc.stop());
                } else if (tone.oscillator) {
                    // Fallback for old single-oscillator format
                    tone.oscillator.stop();
                }
            } catch (e) {
                // Already stopped
            }
            this.activePianoTones.delete(playbackFrequency);
        }, sustainTime * 1000 + 100); // Convert to milliseconds and add buffer

        keyElement.style.transform = '';
    }

    draw() {
        if (!this.isRunning) return;

        const frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        const waveformData = new Uint8Array(this.analyser.frequencyBinCount);

        this.analyser.getByteFrequencyData(frequencyData);

        this.drawSpectrum(frequencyData);

        this.animationId = requestAnimationFrame(() => this.draw());
    }


    selectTonePeakWithHysteresis(prominentPeaks) {
        if (prominentPeaks.length === 0) {
            this.selectedTonePeak = null;
            return null;
        }

        // Prefer second peak to avoid feedback, fallback to first if only one exists
        const candidatePeak = prominentPeaks.length > 1 ? prominentPeaks[1] : prominentPeaks[0];

        // If no peak is currently selected, use the candidate
        if (!this.selectedTonePeak) {
            this.selectedTonePeak = candidatePeak;
            this.peakStabilityCounter = 0;
            return candidatePeak;
        }

        // Calculate frequency and amplitude differences
        const freqDiff = Math.abs(candidatePeak.freq - this.selectedTonePeak.freq) / this.selectedTonePeak.freq;
        const ampDiff = Math.abs(candidatePeak.value - this.selectedTonePeak.value) / this.selectedTonePeak.value;

        // Check if the candidate is significantly different (hysteresis threshold)
        const significantChange = ampDiff > this.peakHysteresisThreshold || freqDiff > 0.1; // 10% frequency change

        if (significantChange) {
            this.peakStabilityCounter++;

            // Only switch if the change has been stable for required frames
            if (this.peakStabilityCounter >= this.peakStabilityRequired) {
                this.selectedTonePeak = candidatePeak;
                this.peakStabilityCounter = 0;
                return candidatePeak;
            }
        } else {
            // Reset counter if change is not significant
            this.peakStabilityCounter = 0;
        }

        // Return the current selected peak (no change)
        return this.selectedTonePeak;
    }

    drawSpectrum(data) {
        if (!this.spectrumCtx || !this.spectrumCanvas) return;

        const width = this.spectrumCanvas.offsetWidth;
        const height = this.spectrumCanvas.offsetHeight;

        this.spectrumCtx.fillStyle = 'rgb(20, 20, 30)';
        this.spectrumCtx.fillRect(0, 0, width, height);

        // Draw subtle ROOMTONE background text with logo gradient colors
        this.spectrumCtx.save();
        this.spectrumCtx.globalAlpha = 0.5;

        // Create gradient that matches the logo
        const textGradient = this.spectrumCtx.createLinearGradient(0, 0, width, height);
        textGradient.addColorStop(0, '#4a9eff');
        textGradient.addColorStop(1, '#00ff88');
        this.spectrumCtx.fillStyle = textGradient;

        this.spectrumCtx.font = `${Math.min(width * 0.15, 120)}px Arial`;
        this.spectrumCtx.textAlign = 'center';
        this.spectrumCtx.textBaseline = 'middle';
        this.spectrumCtx.fillText('ROOMTONE', width / 2, height / 2);
        this.spectrumCtx.restore();

        const nyquist = this.audioContext.sampleRate / 2;
        const minFreq = 20;
        const maxFreq = nyquist;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);

        // Slowly cycling gradient colours
        const time = Date.now() * 0.00005;
        const hue1 = (Math.sin(time) * 60 + 200) % 360;
        const hue2 = (Math.sin(time + 2) * 60 + 120) % 360;
        const hue3 = (Math.sin(time + 4) * 60 + 40) % 360;

        const gradient = this.spectrumCtx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, `hsl(${hue1}, 80%, 60%)`);
        gradient.addColorStop(0.5, `hsl(${hue2}, 90%, 65%)`);
        gradient.addColorStop(1, `hsl(${hue3}, 85%, 70%)`);

        const barWidth = 2;
        const peaks = [];

        for (let x = 0; x < width; x += barWidth) {
            const logFreq = logMin + (x / width) * (logMax - logMin);
            const freq = Math.pow(10, logFreq);
            const bin = Math.floor((freq / nyquist) * data.length);

            if (bin < data.length) {
                // Smooth the amplitude for less jittery visualization
                const rawAmplitude = data[bin] / 255;
                this.smoothedAmplitudes[bin] = this.smoothedAmplitudes[bin] * 0.85 + rawAmplitude * 0.15;

                // Fixed scale: use full height but don't auto-scale
                const barHeight = this.smoothedAmplitudes[bin] * height * 0.8;

                // Different color when above peak detection threshold
                if (data[bin] > this.thresholdValue && freq > 20) {
                    // Brighter, more saturated color for peaks
                    this.spectrumCtx.fillStyle = `hsl(${hue2}, 100%, 75%)`;
                } else {
                    // Normal gradient for non-peak bins
                    this.spectrumCtx.fillStyle = gradient;
                }

                // Draw rounded rectangle for smoother appearance
                this.drawRoundedRect(x, height - barHeight, barWidth - 1, barHeight, 2);

                // Only analyze peaks above threshold
                if (data[bin] > this.thresholdValue && freq > 20) {
                    peaks.push({
                        value: data[bin],
                        freq: freq,
                        x: x,
                        isGenerationZone: freq < 500
                    });

                }
            }
        }

        // Find local maxima - peaks that are higher than nearby frequencies
        const prominentPeaks = this.findProminentPeaks(peaks);

        this.spectrumCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(0, height / 2);
        this.spectrumCtx.lineTo(width, height / 2);
        this.spectrumCtx.stroke();

        this.drawCOctaveLabels(); // Show C octave markers
        // this.drawFrequencySeparator(); // Disabled for cleaner look
        this.drawThresholdLine(); // Show draggable threshold line

        // Always detect dominant key from all available data
        const analysisZonePeaks = prominentPeaks.map(peak => ({
            ...peak,
            value: peak.isGenerationZone ? peak.value * 0.3 : peak.value * 1.5
        }));

        const roomModeData = this.roomModes.map(m => ({freq: m.frequency, value: m.strength}));
        const allKeyData = [...analysisZonePeaks, ...roomModeData];


        // Check if we have any meaningful peaks (not just prominent peaks array length)
        const hasSignificantPeaks = prominentPeaks.length > 0 && prominentPeaks[0].value >= 128;

        // Only detect key if we have current significant peaks, not just old room modes
        const dominantKey = hasSignificantPeaks ? this.detectDominantKey(allKeyData) : null;
        const resonanceStrength = this.calculateResonanceStrength(prominentPeaks, this.roomModes);

        if (hasSignificantPeaks) {
        }


        // Track and generate tones for settled frequencies (disabled for now)
        // this.trackSettledFrequencies(prominentPeaks);

        // Note: Active notes display removed

        // Generate low drone tone based on detected key
        if (dominantKey && resonanceStrength > 0.2) {
        }
        if (this.audioFeedbackEnabled) {
            this.updateToneGeneration(dominantKey, resonanceStrength);
        }

        const currentTime = Date.now();

        if (hasSignificantPeaks) {
            // Use the strongest prominent peak for the main indicator
            const mainPeak = prominentPeaks[0];

            // Use second peak for tone generation to avoid feedback, with hysteresis
            const tonePeak = this.selectTonePeakWithHysteresis(prominentPeaks);

            // Generate tone only if there are multiple peaks (to avoid feedback)
            if (this.audioFeedbackEnabled && prominentPeaks.length > 1 && tonePeak.value > this.thresholdValue * 1.2) {
                // Always play the second peak to avoid feedback
                const secondPeak = prominentPeaks[1];
                this.playPeakTone(secondPeak.freq, secondPeak.value);

                // Start background recording for reversed audio when peaks are strong
                if (!this.isRecording) {
                    this.startBackgroundRecording();
                }
            } else if (this.audioFeedbackEnabled && prominentPeaks.length === 1) {
                // If only one peak, fade out any existing tones
                if (this.currentPrimaryPeakGain) {
                    this.currentPrimaryPeakGain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.5);
                }
            }

            this.smoothedPeakFreq = this.smoothedPeakFreq * this.smoothingFactor + mainPeak.freq * (1 - this.smoothingFactor);
            this.smoothedPeakX = this.smoothedPeakX * this.smoothingFactor + mainPeak.x * (1 - this.smoothingFactor);

            const newNote = this.frequencyToNote(mainPeak.freq);
            if (newNote !== this.currentNote) {
                this.currentNote = newNote;
                this.noteChangeCounter = 0;
            } else {
                this.noteChangeCounter = (this.noteChangeCounter || 0) + 1;
            }

            if (this.noteChangeCounter > 8 || !this.smoothedNote) {
                this.smoothedNote = newNote;
            }

            // Peak detected - update timing and opacity
            this.lastPeakTime = currentTime;
            this.peakFadeOpacity = 1.0;

            // Draw peak indicator line (not in center)
            this.drawPeakIndicator(this.smoothedPeakX, this.smoothedPeakFreq, height, this.smoothedNote);

            // Store and draw secondary prominent peaks
            this.lastSecondaryPeaks = prominentPeaks.slice(1, 4);
            this.lastSecondaryPeaks.forEach(peak => {
                this.drawSecondaryPeak(peak.x, peak.freq, height, peak.value);
            });

            // Track frequencies for room mode detection
            this.trackFrequencyHistory(prominentPeaks);
        } else {
            // No significant peaks detected - start fading
            const timeSinceLastPeak = currentTime - this.lastPeakTime;
            const fadeStartDelay = 500; // Start fading after 500ms
            const fadeOutDuration = 1500; // Fade out over 1.5 seconds


            if (timeSinceLastPeak > fadeStartDelay) {
                const fadeProgress = Math.min((timeSinceLastPeak - fadeStartDelay) / fadeOutDuration, 1);
                this.peakFadeOpacity = 1 - fadeProgress;

                // Draw fading peak indicators if still visible
                if (this.peakFadeOpacity > 0.05 && this.smoothedPeakX > 0) {
                    this.drawPeakIndicator(this.smoothedPeakX, this.smoothedPeakFreq, height, this.smoothedNote);

                    // Also draw fading secondary peaks if we still have them
                    if (this.lastSecondaryPeaks && this.lastSecondaryPeaks.length > 0) {
                        this.lastSecondaryPeaks.forEach(peak => {
                            this.drawSecondaryPeak(peak.x, peak.freq, height, peak.value);
                        });
                    }
                }
            } else if (this.smoothedPeakX > 0) {
                // Still within delay period, show at full opacity
                this.peakFadeOpacity = 1.0;
                this.drawPeakIndicator(this.smoothedPeakX, this.smoothedPeakFreq, height, this.smoothedNote);

                // Also show secondary peaks during delay period
                if (this.lastSecondaryPeaks && this.lastSecondaryPeaks.length > 0) {
                    this.lastSecondaryPeaks.forEach(peak => {
                        this.drawSecondaryPeak(peak.x, peak.freq, height, peak.value);
                    });
                }
            }
        }

        // Draw detected room modes
        // this.drawRoomModes(); // Disabled for cleaner look
    }

    drawPeakIndicator(x, freq, height, displayNote) {
        const note = displayNote || this.frequencyToNote(freq);

        // Pulsing orange indicator line with fade support
        const pulse = Math.sin(Date.now() * 0.008) * 0.3 + 0.7;
        const fadeOpacity = this.peakFadeOpacity || 1.0;
        const finalOpacity = pulse * fadeOpacity;
        this.spectrumCtx.strokeStyle = `rgba(255, 170, 0, ${finalOpacity})`;
        this.spectrumCtx.lineWidth = 3;
        this.spectrumCtx.setLineDash([]);
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(x, 0);
        this.spectrumCtx.lineTo(x, height - 20);
        this.spectrumCtx.stroke();

        // Glowing frequency label with fade support - split left and right
        const freqValue = freq.toFixed(1);
        const noteLabel = this.frequencyToNote(freq);

        this.spectrumCtx.shadowColor = `rgba(255, 170, 0, ${fadeOpacity * 0.8})`;
        this.spectrumCtx.shadowBlur = 8;
        this.spectrumCtx.font = 'bold 14px monospace';
        this.spectrumCtx.fillStyle = `rgba(255, 221, 68, ${fadeOpacity})`;
        this.spectrumCtx.textBaseline = 'alphabetic';

        // Frequency value to the left of the line
        this.spectrumCtx.textAlign = 'right';
        this.spectrumCtx.fillText(freqValue, x - 5, 70);

        // Note label to the right of the line
        this.spectrumCtx.textAlign = 'left';
        this.spectrumCtx.fillText(noteLabel, x + 5, 70);

        this.spectrumCtx.shadowBlur = 0;
        this.spectrumCtx.lineWidth = 1;
    }

    findProminentPeaks(peaks) {
        if (peaks.length === 0) return [];

        // Sort by amplitude
        peaks.sort((a, b) => b.value - a.value);

        const prominent = [];
        const minDistance = 50; // Minimum frequency separation

        for (const peak of peaks) {

            if (peak.value < this.thresholdValue) break; // Use dynamic threshold

            // Check if this peak is far enough from already selected peaks
            // Increased separation to prevent FFT curve shoulders appearing as separate peaks
            const tooClose = prominent.some(p =>
                Math.abs(Math.log10(peak.freq) - Math.log10(p.freq)) < 0.15
            );

            if (!tooClose) {
                prominent.push(peak);
                if (prominent.length >= 5) break; // Max 5 peaks
            }
        }

        return prominent;
    }

    drawSecondaryPeak(x, freq, height, amplitude) {
        const baseAlpha = Math.min(amplitude / 255 * 0.8, 0.6);
        const fadeOpacity = this.peakFadeOpacity || 1.0;
        const alpha = baseAlpha * fadeOpacity;

        // Smaller indicator line with fade support
        this.spectrumCtx.strokeStyle = `rgba(255, 200, 100, ${alpha})`;
        this.spectrumCtx.lineWidth = 1;
        this.spectrumCtx.setLineDash([3, 3]);
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(x, height * 0.2);
        this.spectrumCtx.lineTo(x, height - 20);
        this.spectrumCtx.stroke();
        this.spectrumCtx.setLineDash([]);

        // Small frequency label with fade support
        const note = this.frequencyToNote(freq);
        this.spectrumCtx.font = '10px monospace';
        this.spectrumCtx.fillStyle = `rgba(255, 200, 100, ${alpha})`;
        this.spectrumCtx.textAlign = 'center';
        this.spectrumCtx.fillText(note, x, height * 0.15);

        this.spectrumCtx.lineWidth = 1;
    }

    trackFrequencyHistory(peaks) {
        const now = Date.now();
        const timeWindow = 30000; // 30 second window

        // Add current peaks to history
        peaks.forEach(peak => {
            const freqKey = Math.round(peak.freq / 5) * 5; // Group by 5Hz bins

            if (!this.frequencyHistory.has(freqKey)) {
                this.frequencyHistory.set(freqKey, []);
            }

            this.frequencyHistory.get(freqKey).push({
                time: now,
                amplitude: peak.value,
                freq: peak.freq
            });
        });

        // Clean old history and detect persistent modes
        this.roomModes = [];

        for (const [freqKey, history] of this.frequencyHistory.entries()) {
            // Remove old entries
            const recentHistory = history.filter(entry => now - entry.time < timeWindow);
            this.frequencyHistory.set(freqKey, recentHistory);

            // Check if this frequency qualifies as a room mode
            if (recentHistory.length > 20 && now - this.modeDetectionStartTime > this.minDetectionTime) {
                const avgAmplitude = recentHistory.reduce((sum, entry) => sum + entry.amplitude, 0) / recentHistory.length;
                const consistency = recentHistory.length / (timeWindow / 1000); // detections per second

                if (avgAmplitude > 40 && consistency > 0.5) {
                    const avgFreq = recentHistory.reduce((sum, entry) => sum + entry.freq, 0) / recentHistory.length;
                    this.roomModes.push({
                        frequency: avgFreq,
                        strength: avgAmplitude,
                        consistency: consistency,
                        note: this.frequencyToNote(avgFreq)
                    });
                }
            }
        }

        // Sort room modes by strength
        this.roomModes.sort((a, b) => b.strength - a.strength);
        this.roomModes = this.roomModes.slice(0, 3); // Keep top 3
    }

    drawRoomModes() {
        const width = this.spectrumCanvas.offsetWidth;
        const height = this.spectrumCanvas.offsetHeight;
        const nyquist = this.audioContext.sampleRate / 2;
        const minFreq = 20;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(nyquist);

        this.roomModes.forEach((mode, index) => {
            const logFreq = Math.log10(mode.frequency);
            const x = ((logFreq - logMin) / (logMax - logMin)) * width;

            // Pulsing room mode indicator
            const pulse = Math.sin(Date.now() * 0.003 + index) * 0.3 + 0.7;
            const alpha = (mode.strength / 255) * pulse * 0.8;

            // Thick vertical line for room mode
            this.spectrumCtx.strokeStyle = `rgba(255, 50, 150, ${alpha})`;
            this.spectrumCtx.lineWidth = 4;
            this.spectrumCtx.setLineDash([]);
            this.spectrumCtx.beginPath();
            this.spectrumCtx.moveTo(x, 0);
            this.spectrumCtx.lineTo(x, height);
            this.spectrumCtx.stroke();

            // Room mode label
            this.spectrumCtx.font = 'bold 12px monospace';
            this.spectrumCtx.fillStyle = `rgba(255, 100, 200, ${alpha})`;
            this.spectrumCtx.textAlign = 'center';
            this.spectrumCtx.shadowColor = 'rgba(255, 50, 150, 0.5)';
            this.spectrumCtx.shadowBlur = 4;

            const label = `${mode.note}`;
            this.spectrumCtx.fillText(label, x, height - 40 - (index * 20));

            this.spectrumCtx.shadowBlur = 0;
            this.spectrumCtx.lineWidth = 1;
        });
    }

    calculateRoomDimensions() {
        if (this.roomModes.length < 2) return null;

        const speedOfSound = 343; // m/s at 20°C
        const dimensions = [];

        this.roomModes.forEach(mode => {
            // Assume fundamental room modes (half wavelength = dimension)
            const wavelength = speedOfSound / mode.frequency;
            const dimension = wavelength / 2;
            dimensions.push(dimension);
        });

        return {
            possibleDimensions: dimensions.map(d => d.toFixed(2) + 'm'),
            roomModes: this.roomModes
        };
    }

    showToneWaveform() {
        if (!this.toneWaveCanvas) return;
        this.toneWaveCanvas.style.display = 'block';
        this.animateToneWaveform();
    }

    hideToneWaveform() {
        if (!this.toneWaveCanvas) return;
        this.toneWaveCanvas.style.display = 'none';
    }

    animateToneWaveform() {
        if (!this.toneStartTime || !this.toneWaveCanvas || !this.toneWaveCtx || this.toneWaveCanvas.style.display === 'none') return;

        const width = this.toneWaveCanvas.width;
        const height = this.toneWaveCanvas.height;
        const centerY = height / 2;

        // Clear canvas
        this.toneWaveCtx.clearRect(0, 0, width, height);

        // Calculate wave parameters based on current time
        const time = Date.now() * 0.001; // Convert to seconds
        const frequency = 2; // Slow wave for visual appeal
        const amplitude = height * 0.3;

        // Draw sine wave
        this.toneWaveCtx.strokeStyle = 'rgba(74, 158, 255, 0.8)';
        this.toneWaveCtx.lineWidth = 2;
        this.toneWaveCtx.beginPath();

        for (let x = 0; x < width; x++) {
            const y = centerY + Math.sin((x / width) * Math.PI * 8 + time * frequency) * amplitude;
            if (x === 0) {
                this.toneWaveCtx.moveTo(x, y);
            } else {
                this.toneWaveCtx.lineTo(x, y);
            }
        }

        this.toneWaveCtx.stroke();

        // Continue animation if tone is still playing
        if (this.toneStartTime) {
            requestAnimationFrame(() => this.animateToneWaveform());
        }
    }

    drawCOctaveLabels() {
        const width = this.spectrumCanvas.offsetWidth;
        const height = this.spectrumCanvas.offsetHeight;
        const nyquist = this.audioContext.sampleRate / 2;

        // Only show C notes across octaves
        const cNotes = [];
        for (let octave = 1; octave <= 8; octave++) {
            const freq = 440 * Math.pow(2, (octave - 4) + (-9) / 12); // C note calculation
            if (freq >= 20 && freq <= nyquist) {
                cNotes.push({
                    note: `C${octave}`,
                    freq: freq
                });
            }
        }

        const minFreq = 20;
        const maxFreq = nyquist;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);

        cNotes.forEach(({ note, freq }) => {
            const logFreq = Math.log10(freq);
            const x = ((logFreq - logMin) / (logMax - logMin)) * width;

            // Draw subtle vertical line
            this.spectrumCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            this.spectrumCtx.setLineDash([2, 4]);
            this.spectrumCtx.beginPath();
            this.spectrumCtx.moveTo(x, 0);
            this.spectrumCtx.lineTo(x, height - 20);
            this.spectrumCtx.stroke();
            this.spectrumCtx.setLineDash([]);

            // Draw label
            this.spectrumCtx.font = '10px monospace';
            this.spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            this.spectrumCtx.textAlign = 'center';
            this.spectrumCtx.fillText(note, x, height - 5);
        });
    }

    drawNoteLabels() {
        const width = this.spectrumCanvas.offsetWidth;
        const height = this.spectrumCanvas.offsetHeight;
        const nyquist = this.audioContext.sampleRate / 2;

        const noteFrequencies = [];
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        for (let octave = 1; octave <= 8; octave++) {
            for (let noteIdx = 0; noteIdx < notes.length; noteIdx++) {
                const note = notes[noteIdx];
                const freq = 440 * Math.pow(2, (octave - 4) + (noteIdx - 9) / 12);

                if (freq >= 20 && freq <= 10000) {
                    const isC = note === 'C';
                    const isA = note === 'A' && octave === 4;
                    noteFrequencies.push({
                        note: `${note}${octave}`,
                        freq: freq,
                        major: isC || isA
                    });
                }
            }
        }

        this.spectrumCtx.font = '10px monospace';
        this.spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.6)';
        this.spectrumCtx.textAlign = 'center';

        const minFreq = 20;
        const maxFreq = nyquist;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);

        noteFrequencies.forEach(({ note, freq, major }) => {
            if (freq >= minFreq && freq < nyquist) {
                const logFreq = Math.log10(freq);
                const x = ((logFreq - logMin) / (logMax - logMin)) * width;

                if (major) {
                    this.spectrumCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                    this.spectrumCtx.setLineDash([2, 4]);
                    this.spectrumCtx.beginPath();
                    this.spectrumCtx.moveTo(x, 0);
                    this.spectrumCtx.lineTo(x, height - 20);
                    this.spectrumCtx.stroke();
                    this.spectrumCtx.setLineDash([]);

                    this.spectrumCtx.font = '10px monospace';
                    this.spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                    this.spectrumCtx.fillText(note, x, height - 5);
                } else if (note.includes('#')) {
                    this.spectrumCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
                    this.spectrumCtx.setLineDash([1, 3]);
                    this.spectrumCtx.beginPath();
                    this.spectrumCtx.moveTo(x, height * 0.7);
                    this.spectrumCtx.lineTo(x, height - 20);
                    this.spectrumCtx.stroke();
                    this.spectrumCtx.setLineDash([]);
                } else {
                    this.spectrumCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                    this.spectrumCtx.setLineDash([1, 5]);
                    this.spectrumCtx.beginPath();
                    this.spectrumCtx.moveTo(x, height * 0.8);
                    this.spectrumCtx.lineTo(x, height - 20);
                    this.spectrumCtx.stroke();
                    this.spectrumCtx.setLineDash([]);

                    if (freq < 1000) {
                        this.spectrumCtx.font = '8px monospace';
                        this.spectrumCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                        this.spectrumCtx.fillText(note, x, height - 5);
                    }
                }
            }
        });
    }

    drawFrequencySeparator() {
        const width = this.spectrumCanvas.offsetWidth;
        const height = this.spectrumCanvas.offsetHeight;
        const nyquist = this.audioContext.sampleRate / 2;
        const minFreq = 20;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(nyquist);

        // Calculate 500Hz position on log scale
        const separatorFreq = 500;
        const logSeparator = Math.log10(separatorFreq);
        const x = ((logSeparator - logMin) / (logMax - logMin)) * width;

        // Draw dramatic separator line
        this.spectrumCtx.strokeStyle = 'rgba(255, 255, 0, 0.8)';
        this.spectrumCtx.lineWidth = 3;
        this.spectrumCtx.setLineDash([10, 10]);
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(x, 0);
        this.spectrumCtx.lineTo(x, height);
        this.spectrumCtx.stroke();
        this.spectrumCtx.setLineDash([]);

        // Add labels
        this.spectrumCtx.font = 'bold 14px monospace';
        this.spectrumCtx.fillStyle = 'rgba(255, 255, 0, 0.9)';
        this.spectrumCtx.textAlign = 'center';
        this.spectrumCtx.shadowColor = 'rgba(255, 255, 0, 0.5)';
        this.spectrumCtx.shadowBlur = 6;

        // Labels removed for cleaner look

        this.spectrumCtx.shadowBlur = 0;
        this.spectrumCtx.lineWidth = 1;
    }

    drawWaveform(data) {
        const width = this.waveformCanvas.offsetWidth;
        const height = this.waveformCanvas.offsetHeight;

        this.waveformCtx.fillStyle = 'rgb(20, 20, 30)';
        this.waveformCtx.fillRect(0, 0, width, height);

        this.waveformCtx.lineWidth = 2;
        this.waveformCtx.strokeStyle = '#00ff88';
        this.waveformCtx.beginPath();

        const sliceHeight = height / data.length;
        let y = 0;

        for (let i = 0; i < data.length; i++) {
            const v = data[i] / 128.0;
            const x = (v - 1) * width / 2 + width / 2;

            if (i === 0) {
                this.waveformCtx.moveTo(x, y);
            } else {
                this.waveformCtx.lineTo(x, y);
            }

            y += sliceHeight;
        }

        this.waveformCtx.stroke();

        // Add center line
        this.waveformCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        this.waveformCtx.lineWidth = 1;
        this.waveformCtx.beginPath();
        this.waveformCtx.moveTo(width / 2, 0);
        this.waveformCtx.lineTo(width / 2, height);
        this.waveformCtx.stroke();
    }


    frequencyToNote(freq) {
        const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        if (freq < 20 || freq > 20000) return '--';

        // Vallotti temperament - 18th century well-tempered tuning
        // Based on C4 = 261.626Hz, with specific cent deviations from equal temperament
        const C4_base = 261.626; // Equal temperament C4

        // Vallotti cent deviations from equal temperament for each semitone from C
        const vallottiDeviations = [
            0,      // C
            -5.86,  // C#
            -3.91,  // D
            -9.77,  // D#
            -1.96,  // E
            -1.96,  // F
            -7.82,  // F#
            -1.96,  // G
            -7.82,  // G#
            -3.91,  // A
            -9.77,  // A#
            -1.96   // B
        ];

        // Find closest note in Vallotti tuning across all octaves
        let closestNote = 0;
        let closestOctave = 4;
        let minDistance = Infinity;

        // Check octaves from 0 to 9
        for (let oct = 0; oct <= 9; oct++) {
            vallottiDeviations.forEach((cents, noteIndex) => {
                // Calculate Vallotti frequency for this note in this octave
                const octaveMultiplier = Math.pow(2, oct - 4); // Relative to C4
                const equalTempFreq = C4_base * Math.pow(2, noteIndex/12) * octaveMultiplier;
                const vallottiFreq = equalTempFreq * Math.pow(2, cents/1200);

                const distance = Math.abs(Math.log2(freq / vallottiFreq));
                if (distance < minDistance) {
                    minDistance = distance;
                    closestNote = noteIndex;
                    closestOctave = oct;
                }
            });
        }

        return notes[closestNote] + closestOctave;
    }

    clearCanvases() {
        this.spectrumCtx.fillStyle = 'rgb(20, 20, 30)';
        this.spectrumCtx.fillRect(0, 0, this.spectrumCanvas.width, this.spectrumCanvas.height);

        this.waveformCtx.fillStyle = 'rgb(20, 20, 30)';
        this.waveformCtx.fillRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
    }

    drawRoundedRect(x, y, width, height, radius) {
        if (height < radius * 2) {
            // For very small bars, just draw a regular rectangle
            this.spectrumCtx.fillRect(x, y, width, height);
            return;
        }

        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(x, y + height); // Start at bottom left
        this.spectrumCtx.lineTo(x, y + radius); // Left side up to corner
        this.spectrumCtx.arcTo(x, y, x + radius, y, radius); // Top left corner
        this.spectrumCtx.lineTo(x + width - radius, y); // Top side
        this.spectrumCtx.arcTo(x + width, y, x + width, y + radius, radius); // Top right corner
        this.spectrumCtx.lineTo(x + width, y + height); // Right side down
        this.spectrumCtx.lineTo(x, y + height); // Bottom side back to start
        this.spectrumCtx.fill();
    }

    detectDominantKey(allPeaks) {
        if (allPeaks.length < 2) return null; // Need at least 2 peaks for harmonic analysis

        // Convert peaks to note names with confidence
        const detectedNotes = this.analyzeNotesFromPeaks(allPeaks);

        if (detectedNotes.length < 2) return null;


        // Analyze scale patterns to determine key and mode
        const scaleAnalysis = this.analyzeScalePattern(detectedNotes);


        return scaleAnalysis.key;
    }

    analyzeNotesFromPeaks(peaks) {
        const C4_base = 261.626;
        const vallottiDeviations = [0, -5.86, -3.91, -9.77, -1.96, -1.96, -7.82, -1.96, -7.82, -3.91, -9.77, -1.96];
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        const detectedNotes = [];

        peaks.forEach(peak => {
            let bestNote = null;
            let bestConfidence = 0;

            noteNames.forEach((noteName, noteIndex) => {
                // Check multiple octaves
                for (let oct = 1; oct <= 6; oct++) {
                    const octaveMultiplier = Math.pow(2, oct - 4);
                    const equalTempFreq = C4_base * Math.pow(2, noteIndex/12) * octaveMultiplier;
                    const vallottiFreq = equalTempFreq * Math.pow(2, vallottiDeviations[noteIndex]/1200);

                    const distance = Math.abs(Math.log2(peak.freq / vallottiFreq));
                    if (distance < 0.08) { // Tighter tolerance for note detection
                        const confidence = (peak.value || 100) * (1 - distance * 12.5);
                        if (confidence > bestConfidence) {
                            bestNote = noteName;
                            bestConfidence = confidence;
                        }
                    }
                }
            });

            if (bestNote && bestConfidence > 30) {
                detectedNotes.push({
                    note: bestNote,
                    confidence: bestConfidence,
                    freq: peak.freq
                });
            }
        });

        // Sort by confidence and remove duplicates
        return detectedNotes
            .sort((a, b) => b.confidence - a.confidence)
            .filter((note, index, arr) =>
                arr.findIndex(n => n.note === note.note) === index
            )
            .slice(0, 6); // Keep top 6 most confident notes
    }

    analyzeScalePattern(detectedNotes) {
        if (detectedNotes.length < 2) return { key: null, mode: 'unknown', confidence: 0 };

        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        // Convert notes to semitone numbers
        const noteSemitones = detectedNotes.map(n => ({
            semitone: noteNames.indexOf(n.note),
            confidence: n.confidence
        }));

        // Define scale patterns (intervals from root)
        const scalePatterns = {
            'major': [0, 2, 4, 5, 7, 9, 11],
            'minor': [0, 2, 3, 5, 7, 8, 10],
            'dorian': [0, 2, 3, 5, 7, 9, 10],
            'mixolydian': [0, 2, 4, 5, 7, 9, 10],
            'pentatonic': [0, 2, 4, 7, 9]
        };

        let bestMatch = { key: null, mode: 'unknown', confidence: 0 };

        // Try each possible root note
        noteNames.forEach((rootNote, rootSemitone) => {
            Object.entries(scalePatterns).forEach(([modeName, pattern]) => {
                let matchScore = 0;
                let totalWeight = 0;

                noteSemitones.forEach(({ semitone, confidence }) => {
                    const intervalFromRoot = (semitone - rootSemitone + 12) % 12;
                    const weight = confidence;
                    totalWeight += weight;

                    if (pattern.includes(intervalFromRoot)) {
                        // Bonus for strong scale tones
                        const scaleImportance = pattern.indexOf(intervalFromRoot) === 0 ? 2.0 : // Root
                                               pattern.indexOf(intervalFromRoot) === 4 ? 1.8 : // Fifth
                                               pattern.indexOf(intervalFromRoot) === 2 ? 1.5 : // Third
                                               1.0; // Other scale tones
                        matchScore += weight * scaleImportance;
                    } else {
                        // Penalty for non-scale tones
                        matchScore -= weight * 0.5;
                    }
                });

                const normalizedScore = totalWeight > 0 ? matchScore / totalWeight : 0;

                if (normalizedScore > bestMatch.confidence) {
                    bestMatch = {
                        key: `${rootNote} ${modeName}`,
                        mode: modeName,
                        confidence: normalizedScore
                    };
                }
            });
        });

        // Only return if we have reasonable confidence
        return bestMatch.confidence > 50 ? bestMatch : { key: null, mode: 'unknown', confidence: 0 };
    }

    calculateResonanceStrength(peaks, modes) {
        const peakStrength = peaks.reduce((sum, p) => sum + p.value, 0) / peaks.length || 0;
        const modeStrength = modes.reduce((sum, m) => sum + m.strength, 0) / modes.length || 0;
        const combinedStrength = (peakStrength + modeStrength * 1.5) / 255;
        return Math.min(combinedStrength, 1);
    }


    drawThresholdLine() {
        const width = this.spectrumCanvas.offsetWidth;
        const height = this.spectrumCanvas.offsetHeight;

        // Dynamic threshold line based on current threshold value
        const thresholdY = height - (height * 0.8 * (this.thresholdValue/255));

        this.spectrumCtx.save();
        this.spectrumCtx.strokeStyle = 'rgba(255, 165, 0, 0.6)'; // Orange threshold line
        this.spectrumCtx.lineWidth = 2;
        this.spectrumCtx.setLineDash([5, 5]);

        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(0, thresholdY);
        this.spectrumCtx.lineTo(width, thresholdY);
        this.spectrumCtx.stroke();

        // Label above the line
        this.spectrumCtx.fillStyle = 'rgba(255, 165, 0, 0.8)';
        this.spectrumCtx.font = '12px monospace';
        this.spectrumCtx.textAlign = 'left';
        this.spectrumCtx.fillText('THRESHOLD', 10, thresholdY - 8);

        this.spectrumCtx.restore();
    }

    setupToneGeneration() {
        // Create reverb effect
        this.reverbNode = this.audioContext.createConvolver();
        this.createReverbImpulse();

        // Create gain node for volume control
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.setValueAtTime(0.2, this.audioContext.currentTime); // Default volume

        // Connect audio chain
        this.gainNode.connect(this.reverbNode);
        this.reverbNode.connect(this.audioContext.destination);

        // Setup background recording
        this.setupBackgroundRecording();
    }

    setupBackgroundRecording() {
        if (!this.mediaStream) return;

        try {
            // Create MediaRecorder from the microphone stream
            this.audioRecorder = new MediaRecorder(this.mediaStream, {
                mimeType: 'audio/webm'
            });

            this.audioRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.recordedChunks.push(event.data);
                }
            };

            this.audioRecorder.onstop = () => {
                this.processRecordedAudio();
            };

        } catch (error) {
            console.warn('Could not setup background recording:', error);
        }
    }

    startBackgroundRecording() {
        if (!this.audioRecorder || this.isRecording) return;

        this.recordedChunks = [];
        this.isRecording = true;
        this.recordingStartTime = Date.now();

        this.audioRecorder.start();

        // Stop recording after 10 seconds
        setTimeout(() => {
            this.stopBackgroundRecording();
        }, this.recordingDuration);
    }

    stopBackgroundRecording() {
        if (!this.audioRecorder || !this.isRecording) return;

        this.audioRecorder.stop();
        this.isRecording = false;
    }

    async processRecordedAudio() {
        if (this.recordedChunks.length === 0) return;

        try {
            // Create blob from recorded chunks
            const audioBlob = new Blob(this.recordedChunks, { type: 'audio/webm' });

            // Convert to ArrayBuffer
            const arrayBuffer = await audioBlob.arrayBuffer();

            // Decode audio data
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            // Reverse the audio buffer
            this.reversedAudioBuffer = this.reverseAudioBuffer(audioBuffer);


            // Play the reversed audio after a short delay
            setTimeout(() => {
                this.playReversedAudio();
            }, 1000);

        } catch (error) {
            console.warn('Error processing recorded audio:', error);
        }
    }

    reverseAudioBuffer(audioBuffer) {
        const reversedBuffer = this.audioContext.createBuffer(
            audioBuffer.numberOfChannels,
            audioBuffer.length,
            audioBuffer.sampleRate
        );

        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
            const originalData = audioBuffer.getChannelData(channel);
            const reversedData = reversedBuffer.getChannelData(channel);

            // Reverse the samples
            for (let i = 0; i < originalData.length; i++) {
                reversedData[i] = originalData[originalData.length - 1 - i];
            }
        }

        return reversedBuffer;
    }

    playReversedAudio() {
        if (!this.reversedAudioBuffer) return;

        try {
            const source = this.audioContext.createBufferSource();
            const gain = this.audioContext.createGain();

            source.buffer = this.reversedAudioBuffer;

            // Set low volume for ambient effect
            gain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.1, this.audioContext.currentTime + 1); // Fade in
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + this.reversedAudioBuffer.duration - 1); // Fade out

            // Connect: source -> gain -> reverb -> destination
            source.connect(gain);
            gain.connect(this.reverbNode);

            source.start();

        } catch (error) {
            console.warn('Error playing reversed audio:', error);
        }
    }

    createReverbImpulse() {
        const length = this.audioContext.sampleRate * 2; // 2 seconds of reverb
        const impulse = this.audioContext.createBuffer(2, length, this.audioContext.sampleRate);

        for (let channel = 0; channel < 2; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - i / length, 2);
                channelData[i] = (Math.random() * 2 - 1) * decay * 0.3;
            }
        }

        this.reverbNode.buffer = impulse;
    }

    trackSettledFrequencies(prominentPeaks) {
        const currentTime = Date.now();
        const settleDuration = 2000; // 2 seconds to consider a frequency settled (faster for testing)
        const settleThreshold = 10; // Hz tolerance for considering frequency stable

        // Update tracking for current peaks
        prominentPeaks.forEach(peak => {
            // Find existing tracked frequency within threshold
            let foundExisting = false;
            for (let [trackedFreq, data] of this.settledFrequencies) {
                if (Math.abs(peak.freq - trackedFreq) < settleThreshold) {
                    data.lastSeen = currentTime;
                    data.strength = Math.max(data.strength, peak.strength);
                    foundExisting = true;
                    break;
                }
            }

            // If no existing frequency found, start tracking this one
            if (!foundExisting && peak.freq < 500) {
                this.settledFrequencies.set(peak.freq, {
                    firstSeen: currentTime,
                    lastSeen: currentTime,
                    strength: peak.strength,
                    hasGeneratedTone: false
                });
            }
        });

        // Check for settled frequencies and generate tones
        for (let [freq, data] of this.settledFrequencies) {
            const age = currentTime - data.firstSeen;
            const timeSinceLastSeen = currentTime - data.lastSeen;

            // Remove old frequencies that haven't been seen recently
            if (timeSinceLastSeen > 2000) {
                this.settledFrequencies.delete(freq);
                this.stopHarmonicTone(freq);
                continue;
            }

            // Generate tone for settled frequencies
            if (age > settleDuration && !data.hasGeneratedTone && freq < 500) {
                this.startHarmonicTone(freq, data.strength);
                data.hasGeneratedTone = true;
            }
        }
    }

    startHarmonicTone(frequency, strength) {
        if (this.harmonicOscillators.has(frequency) || !this.audioContext || !this.gainNode) return;

        try {
            // Create oscillator for this specific frequency
            const oscillator = this.audioContext.createOscillator();
            const harmonicGain = this.audioContext.createGain();

            oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
            oscillator.type = 'sine';

            // More audible for testing - fade-in over 2 seconds
            const safeStrength = Math.max(strength || 0.5, 0.1); // Default to 0.5 if strength is falsy
            const targetVolume = Math.min(safeStrength * 0.1, 0.15); // Calculate target volume
            const finalVolume = Math.max(targetVolume, 0.01); // Ensure minimum 0.01 volume


            harmonicGain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
            harmonicGain.gain.exponentialRampToValueAtTime(finalVolume, this.audioContext.currentTime + 2);

            // Connect: oscillator -> harmonic gain -> main gain -> reverb -> destination
            oscillator.connect(harmonicGain);
            harmonicGain.connect(this.gainNode);

            oscillator.start();

            // Store the oscillator and gain for later control
            this.harmonicOscillators.set(frequency, {
                oscillator: oscillator,
                gain: harmonicGain,
                note: this.frequencyToNote(frequency)
            });
        } catch (error) {
            console.warn('Error creating harmonic tone:', error);
        }
    }

    stopHarmonicTone(frequency) {
        if (!this.harmonicOscillators.has(frequency)) return;

        const harmonic = this.harmonicOscillators.get(frequency);

        // Fade out over 1 second
        harmonic.gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 1);

        // Stop and clean up after fade
        setTimeout(() => {
            try {
                harmonic.oscillator.stop();
            } catch (e) {
                // Already stopped
            }
            this.harmonicOscillators.delete(frequency);
        }, 1100);
    }

    updateActiveNotesDisplay() {
        // Get all active notes from harmonic oscillators
        const activeNotes = Array.from(this.harmonicOscillators.values()).map(h => h.note);

        if (activeNotes.length === 0) {
            this.activeNotesDisplay.textContent = '—';
            this.activeChordDisplay.textContent = '—';
            return;
        }

        // Remove duplicates and sort
        const uniqueNotes = [...new Set(activeNotes)].sort();
        this.activeNotesDisplay.textContent = uniqueNotes.join(', ');

        // Simple chord detection
        const chord = this.detectChord(uniqueNotes);
        this.activeChordDisplay.textContent = chord || '—';
    }

    detectChord(notes) {
        if (notes.length < 2) return null;

        // Simple chord patterns (this could be expanded significantly)
        const chordPatterns = {
            'C,E,G': 'C major',
            'C,E♭,G': 'C minor',
            'D,F♯,A': 'D major',
            'D,F,A': 'D minor',
            'E,G♯,B': 'E major',
            'E,G,B': 'E minor',
            'F,A,C': 'F major',
            'F,A♭,C': 'F minor',
            'G,B,D': 'G major',
            'G,B♭,D': 'G minor',
            'A,C♯,E': 'A major',
            'A,C,E': 'A minor',
            'B,D♯,F♯': 'B major',
            'B,D,F♯': 'B minor'
        };

        // Try to match chord patterns
        const noteString = notes.join(',');
        return chordPatterns[noteString] || `${notes.length} notes`;
    }

    updateToneGeneration(key, strength) {
        const currentTime = Date.now();

        // Check if current tone should be fading out or stopping
        if (this.toneStartTime && this.currentToneKey) {
            const elapsed = currentTime - this.toneStartTime;
            const fadeStartTime = this.toneDuration - this.fadeOutDuration;

            if (elapsed >= this.toneDuration) {
                // Tone duration exceeded, stop completely
                this.stopToneGeneration();
                return;
            } else if (elapsed >= fadeStartTime) {
                // Start fade out
                if (this.gainNode) {
                    const fadeProgress = (elapsed - fadeStartTime) / this.fadeOutDuration;
                    const currentVolume = Math.min(strength * 0.3, 0.2);
                    const targetVolume = currentVolume * (1 - fadeProgress);
                    this.gainNode.gain.exponentialRampToValueAtTime(Math.max(targetVolume, 0.001), this.audioContext.currentTime + 0.1);
                }
                return;
            }
        }

        if (!key || strength < 0.2) {
            // Not enough signal strength, fade out
            if (this.gainNode) {
                this.gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.5);
            }
            return;
        }

        // Only start new tone if key changed significantly or no tone is playing
        if (key !== this.currentToneKey || !this.toneStartTime) {
            this.currentToneKey = key;
            this.toneStartTime = currentTime;
            this.stopToneGeneration();
            this.startToneGeneration(key, strength);

            // Start background recording when tone begins
            this.startBackgroundRecording();


            // Show tone waveform visualization
            this.showToneWaveform();
        } else {
            // Update volume based on strength (only if not in fade out period)
            if (this.gainNode && this.toneStartTime) {
                const elapsed = currentTime - this.toneStartTime;
                const fadeStartTime = this.toneDuration - this.fadeOutDuration;

                if (elapsed < fadeStartTime) {
                    const targetVolume = Math.min(strength * 0.3, 0.2); // Keep it subtle
                    this.gainNode.gain.exponentialRampToValueAtTime(targetVolume, this.audioContext.currentTime + 0.1);
                }
            }
        }
    }

    startToneGeneration(key, strength) {
        if (!this.audioContext || !this.gainNode) {
            return;
        }

        // Generate Vallotti-tuned low drone frequencies for the detected key
        const droneFrequencies = this.getVallottiDroneFrequencies(key);

        droneFrequencies.forEach((freq, index) => {
            const oscillator = this.audioContext.createOscillator();
            const oscGain = this.audioContext.createGain();

            // Use sine waves for smooth, warm drone
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(freq, this.audioContext.currentTime);

            // More audible volume for testing
            const volume = (index === 0) ? 0.3 : 0.15; // Root note slightly louder
            oscGain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
            oscGain.gain.exponentialRampToValueAtTime(volume, this.audioContext.currentTime + 2); // Slow fade in


            oscillator.connect(oscGain);
            oscGain.connect(this.gainNode);

            oscillator.start();
            this.oscillators.push(oscillator);
        });
    }

    getVallottiDroneFrequencies(key) {
        if (!key) return [];

        // Vallotti temperament base frequencies
        const C4_base = 261.626;
        const vallottiDeviations = [0, -5.86, -3.91, -9.77, -1.96, -1.96, -7.82, -1.96, -7.82, -3.91, -9.77, -1.96];
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        const keyIndex = noteNames.indexOf(key);
        if (keyIndex === -1) return [];

        const drones = [];

        // Root note in low octaves (avoid feedback, stay below 500Hz)
        for (let oct = 1; oct <= 3; oct++) {
            const octaveMultiplier = Math.pow(2, oct - 4); // Relative to C4
            const equalTempFreq = C4_base * Math.pow(2, keyIndex/12) * octaveMultiplier;
            const vallottiFreq = equalTempFreq * Math.pow(2, vallottiDeviations[keyIndex]/1200);

            if (vallottiFreq < 500) { // Stay below 500Hz to avoid feedback
                drones.push(vallottiFreq);
            }
        }

        // Add perfect fifth (if in bass range)
        const fifthIndex = (keyIndex + 7) % 12;
        for (let oct = 1; oct <= 3; oct++) {
            const octaveMultiplier = Math.pow(2, oct - 4);
            const equalTempFreq = C4_base * Math.pow(2, fifthIndex/12) * octaveMultiplier;
            const vallottiFifth = equalTempFreq * Math.pow(2, vallottiDeviations[fifthIndex]/1200);

            if (vallottiFifth < 500) {
                drones.push(vallottiFifth);
            }
        }

        return drones.slice(0, 4); // Limit to 4 drones max
    }

    startJungleAmbience() {
        if (!this.audioContext || this.jungleEnabled) return;

        this.jungleEnabled = true;
        this.jungleGain = this.audioContext.createGain();
        this.jungleGain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
        this.jungleGain.gain.exponentialRampToValueAtTime(0.08, this.audioContext.currentTime + 3); // Louder for testing

        if (this.reverbNode) {
            this.jungleGain.connect(this.reverbNode);
        } else {
            this.jungleGain.connect(this.audioContext.destination);
        }

        // Create multiple layers of jungle sounds
        this.createBirdCalls();
        this.createInsectNoise();
        this.createWindRustle();
        this.createDistantThunder();
    }

    createBirdCalls() {
        const birdCall = () => {
            if (!this.jungleEnabled) return;

            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();

            // Random bird frequencies
            const baseFreq = 800 + Math.random() * 2000;
            osc.frequency.setValueAtTime(baseFreq, this.audioContext.currentTime);
            osc.frequency.exponentialRampToValueAtTime(baseFreq * (0.5 + Math.random()), this.audioContext.currentTime + 0.3);

            osc.type = 'sawtooth';
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(baseFreq * 1.5, this.audioContext.currentTime);
            filter.Q.setValueAtTime(8, this.audioContext.currentTime);

            gain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.08, this.audioContext.currentTime + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.4);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.jungleGain);

            osc.start();
            osc.stop(this.audioContext.currentTime + 0.5);

            // Schedule next bird call
            setTimeout(birdCall, 3000 + Math.random() * 8000);
        };

        // Start first bird call much sooner
        setTimeout(birdCall, 500 + Math.random() * 1000);
    }

    createInsectNoise() {
        const insect = () => {
            if (!this.jungleEnabled) return;

            const osc = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();

            osc.frequency.setValueAtTime(4000 + Math.random() * 8000, this.audioContext.currentTime);
            osc.type = 'square';

            filter.type = 'highpass';
            filter.frequency.setValueAtTime(3000, this.audioContext.currentTime);

            gain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.03, this.audioContext.currentTime + 0.1);
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 1.5);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(this.jungleGain);

            osc.start();
            osc.stop(this.audioContext.currentTime + 1.6);

            setTimeout(insect, 1000 + Math.random() * 4000);
        };

        setTimeout(insect, 1000);
    }

    createWindRustle() {
        if (!this.jungleEnabled) return;

        const windNoise = this.audioContext.createOscillator();
        const windGain = this.audioContext.createGain();
        const windFilter = this.audioContext.createBiquadFilter();

        windNoise.type = 'sawtooth';
        windNoise.frequency.setValueAtTime(80, this.audioContext.currentTime);

        windFilter.type = 'bandpass';
        windFilter.frequency.setValueAtTime(200, this.audioContext.currentTime);
        windFilter.Q.setValueAtTime(0.5, this.audioContext.currentTime);

        windGain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
        windGain.gain.exponentialRampToValueAtTime(0.04, this.audioContext.currentTime + 5);

        // Add subtle modulation
        const lfo = this.audioContext.createOscillator();
        const lfoGain = this.audioContext.createGain();
        lfo.frequency.setValueAtTime(0.1, this.audioContext.currentTime);
        lfoGain.gain.setValueAtTime(20, this.audioContext.currentTime);
        lfo.connect(lfoGain);
        lfoGain.connect(windFilter.frequency);

        windNoise.connect(windFilter);
        windFilter.connect(windGain);
        windGain.connect(this.jungleGain);

        windNoise.start();
        lfo.start();

        this.jungleOscillators.push(windNoise, lfo);
    }

    createDistantThunder() {
        const thunder = () => {
            if (!this.jungleEnabled) return;

            const noise = this.audioContext.createOscillator();
            const gain = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();

            noise.type = 'sawtooth';
            noise.frequency.setValueAtTime(40 + Math.random() * 20, this.audioContext.currentTime);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(120, this.audioContext.currentTime);

            gain.gain.setValueAtTime(0.001, this.audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.015, this.audioContext.currentTime + 0.5);
            gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 3);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.jungleGain);

            noise.start();
            noise.stop(this.audioContext.currentTime + 3.5);

            // Very occasional thunder
            setTimeout(thunder, 20000 + Math.random() * 40000);
        };

        // First thunder after long delay
        setTimeout(thunder, 15000 + Math.random() * 20000);
    }

    stopJungleAmbience() {
        if (!this.jungleEnabled) return;

        this.jungleEnabled = false;

        if (this.jungleGain) {
            this.jungleGain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 2);
            setTimeout(() => {
                if (this.jungleGain) {
                    this.jungleGain.disconnect();
                    this.jungleGain = null;
                }
            }, 2100);
        }

        this.jungleOscillators.forEach(osc => {
            try {
                osc.stop();
            } catch (e) {
                // Already stopped
            }
        });
        this.jungleOscillators = [];
    }

    async setupMIDI() {
        if (!navigator.requestMIDIAccess) {
            console.warn('Web MIDI API not supported in this browser');
            return;
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess();

            // Set up input handlers
            for (const input of this.midiAccess.inputs.values()) {
                input.onmidimessage = (event) => this.handleMIDIMessage(event);
            }

            // Handle device connection/disconnection
            this.midiAccess.onstatechange = (event) => {
                if (event.port.type === 'input') {
                    if (event.port.state === 'connected') {
                        event.port.onmidimessage = (event) => this.handleMIDIMessage(event);
                    }
                }
            };

            console.log('MIDI access granted - connect your USB keyboard!');
        } catch (error) {
            console.warn('Failed to get MIDI access:', error);
        }
    }

    handleMIDIMessage(event) {
        const [command, note, velocity] = event.data;

        // Note on (144 + channel) or note on with velocity > 0
        if ((command >= 144 && command <= 159 && velocity > 0) ||
            (command >= 128 && command <= 143 && velocity > 0)) {
            this.playMIDINote(note, velocity);
        }
        // Note off (128 + channel) or note on with velocity 0
        else if ((command >= 128 && command <= 143) ||
                 (command >= 144 && command <= 159 && velocity === 0)) {
            this.stopMIDINote(note);
        }
    }

    playMIDINote(midiNote, velocity) {
        if (!this.audioContext) return;

        // Convert MIDI note to frequency
        const frequency = 440 * Math.pow(2, (midiNote - 69) / 12);

        // Use original frequency for MIDI input
        const playbackFrequency = frequency;

        // Don't play if already active (check both MIDI notes and piano tones)
        if (this.activeMidiNotes.has(midiNote) || this.activePianoTones.has(playbackFrequency)) return;

        // Convert MIDI note to note name for display
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const octave = Math.floor(midiNote / 12) - 1;
        const noteName = noteNames[midiNote % 12] + octave;

        // Use unified piano tone creation with velocity scaling
        const velocityScale = velocity / 127;
        const toneData = this.createPianoTone(frequency, velocityScale, noteName);

        if (toneData) {
            // Store MIDI note mapping for proper cleanup
            this.activeMidiNotes.set(midiNote, {
                originalFrequency: frequency,
                playbackFrequency: playbackFrequency,
                toneData: toneData,
                velocity: velocity
            });
        }
    }

    stopMIDINote(midiNote) {
        if (!this.activeMidiNotes.has(midiNote)) return;

        const midiData = this.activeMidiNotes.get(midiNote);
        const frequency = midiData.playbackFrequency;

        // Remove from MIDI tracking
        this.activeMidiNotes.delete(midiNote);

        // Use the same sustained release as piano keys
        if (this.activePianoTones.has(frequency)) {
            const tone = this.activePianoTones.get(frequency);

            // Sustained release for realistic piano sound (same as piano keyboard)
            const sustainTime = 2.5; // 2.5 second sustain
            const releaseTime = 0.5;  // 0.5 second release

            tone.gains.forEach(gain => {
                if (gain) {
                    gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + releaseTime);
                }
            });

            setTimeout(() => {
                tone.oscillators.forEach(osc => {
                    try {
                        osc.stop();
                    } catch (e) {
                        // Already stopped
                    }
                });
                this.activePianoTones.delete(frequency);
            }, sustainTime * 1000 + 100); // Convert to milliseconds and add buffer
        }
    }

    stopAllMIDINotes() {
        // Stop all active MIDI notes using the new unified system
        for (const [midiNote] of this.activeMidiNotes) {
            this.stopMIDINote(midiNote);
        }
    }

    stopToneGeneration() {
        this.oscillators.forEach(osc => {
            try {
                osc.stop();
            } catch (e) {
                // Oscillator already stopped
            }
        });
        this.oscillators = [];
        this.currentToneKey = null;
        this.toneStartTime = null;

        // Hide tone waveform visualization
        this.hideToneWaveform();
    }

    getKeyBassFrequencies(key) {
        // Map each key to bass frequencies (all below 500Hz)
        const keyFrequencies = {
            'C': [130.81, 261.63], // C3, C4
            'C#': [138.59, 277.18],
            'D': [146.83, 293.66],
            'D#': [155.56, 311.13],
            'E': [164.81, 329.63],
            'F': [174.61, 349.23],
            'F#': [185.00, 369.99],
            'G': [196.00, 392.00],
            'G#': [207.65, 415.30],
            'A': [220.00, 440.00],
            'A#': [233.08, 466.16],
            'B': [246.94, 493.88]
        };

        return keyFrequencies[key] || [];
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const analyser = new RoomtoneAnalyser();
        console.log('RoomtoneAnalyser initialized successfully');

        // Test if button exists and is clickable
        const toggleBtn = document.getElementById('toggleBtn');
        if (toggleBtn) {
            console.log('Toggle button found:', toggleBtn.textContent);
            toggleBtn.style.cursor = 'pointer'; // Ensure it's visually clickable
            toggleBtn.style.zIndex = '1000'; // Bring to front
            toggleBtn.style.position = 'relative'; // Ensure it's clickable

            // Test direct click binding
            toggleBtn.addEventListener('click', () => {
                console.log('DIRECT CLICK DETECTED!');
            });
        } else {
            console.error('Toggle button not found!');
        }
    } catch (error) {
        console.error('Failed to initialize RoomtoneAnalyser:', error);
    }
});