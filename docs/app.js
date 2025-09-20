class RoomtoneAnalyser {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.animationId = null;
        this.isRunning = false;

        this.spectrumCanvas = document.getElementById('spectrum');
        this.spectrumCtx = this.spectrumCanvas.getContext('2d');

        this.toggleBtn = document.getElementById('toggleBtn');
        this.muteBtn = document.getElementById('muteBtn');
        this.isMuted = false;
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

        this.setupCanvases();
        this.bindEvents();
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

    bindEvents() {
        this.toggleBtn.addEventListener('click', () => this.toggle());
        this.muteBtn.addEventListener('click', () => this.toggleMute());
        this.bindPianoEvents();
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
        if (this.isRunning) {
            this.stop();
        } else {
            this.start();
        }
    }

    async start() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

            // Resume AudioContext if suspended (required by some browsers)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            this.microphone = this.audioContext.createMediaStreamSource(stream);

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 4096;
            this.analyser.smoothingTimeConstant = 0.8;

            this.microphone.connect(this.analyser);

            // Set up tone generation
            this.setupToneGeneration();

            this.isRunning = true;
            this.toggleBtn.textContent = 'Stop Listening';
            this.toggleBtn.classList.remove('btn-primary');
            this.toggleBtn.classList.add('btn-secondary');
            this.muteBtn.style.display = 'inline-block';
            this.piano.style.display = 'flex';

            console.log('Audio analysis started successfully');
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

        if (this.microphone) {
            this.microphone.disconnect();
            this.microphone.mediaStream.getTracks().forEach(track => track.stop());
        }

        if (this.audioContext) {
            this.stopToneGeneration();
            this.audioContext.close();
        }

        this.toggleBtn.textContent = 'Start Listening';
        this.toggleBtn.classList.remove('btn-secondary');
        this.toggleBtn.classList.add('btn-primary');
        this.muteBtn.style.display = 'none';
        this.piano.style.display = 'none';

        this.clearCanvases();
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        this.muteBtn.textContent = this.isMuted ? 'Unmute Output' : 'Mute Output';

        if (this.gainNode) {
            this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : 0.1, this.audioContext.currentTime);
        }
    }

    playPianoKey(keyElement) {
        if (!this.audioContext || !this.gainNode) return;

        const frequency = parseFloat(keyElement.dataset.freq);
        const note = keyElement.dataset.note;

        if (this.activePianoTones.has(frequency)) return; // Already playing

        try {
            // Create piano-like sound with multiple harmonics
            const fundamentalOsc = this.audioContext.createOscillator();
            const harmonicOsc1 = this.audioContext.createOscillator();
            const harmonicOsc2 = this.audioContext.createOscillator();

            const pianoGain = this.audioContext.createGain();
            const harmonicGain1 = this.audioContext.createGain();
            const harmonicGain2 = this.audioContext.createGain();

            // Fundamental frequency - sine wave
            fundamentalOsc.type = 'sine';
            fundamentalOsc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);

            // Harmonics for piano-like timbre
            harmonicOsc1.type = 'sine';
            harmonicOsc1.frequency.setValueAtTime(frequency * 2, this.audioContext.currentTime); // Octave

            harmonicOsc2.type = 'sine';
            harmonicOsc2.frequency.setValueAtTime(frequency * 3, this.audioContext.currentTime); // Fifth above octave

            // Piano-like envelope: sharp attack, gradual decay
            const now = this.audioContext.currentTime;
            const attackTime = 0.01;
            const decayTime = 1.5;
            const sustainLevel = 0.3;

            // Fundamental
            pianoGain.gain.setValueAtTime(0, now);
            pianoGain.gain.linearRampToValueAtTime(0.15, now + attackTime);
            pianoGain.gain.exponentialRampToValueAtTime(sustainLevel * 0.15, now + attackTime + decayTime);

            // First harmonic (quieter)
            harmonicGain1.gain.setValueAtTime(0, now);
            harmonicGain1.gain.linearRampToValueAtTime(0.08, now + attackTime);
            harmonicGain1.gain.exponentialRampToValueAtTime(sustainLevel * 0.08, now + attackTime + decayTime);

            // Second harmonic (even quieter)
            harmonicGain2.gain.setValueAtTime(0, now);
            harmonicGain2.gain.linearRampToValueAtTime(0.04, now + attackTime);
            harmonicGain2.gain.exponentialRampToValueAtTime(sustainLevel * 0.04, now + attackTime + decayTime);

            // Connect audio graph
            fundamentalOsc.connect(pianoGain);
            harmonicOsc1.connect(harmonicGain1);
            harmonicOsc2.connect(harmonicGain2);

            // Always connect piano directly to destination to avoid feedback
            pianoGain.connect(this.audioContext.destination);
            harmonicGain1.connect(this.audioContext.destination);
            harmonicGain2.connect(this.audioContext.destination);

            fundamentalOsc.start();
            harmonicOsc1.start();
            harmonicOsc2.start();

            console.log(`Playing piano key: ${note} at ${frequency}Hz`);

            this.activePianoTones.set(frequency, {
                oscillators: [fundamentalOsc, harmonicOsc1, harmonicOsc2],
                gains: [pianoGain, harmonicGain1, harmonicGain2],
                note: note
            });

            this.currentDragKey = keyElement;
            keyElement.style.transform = 'translateY(1px)';
        } catch (error) {
            console.warn('Error playing piano key:', error);
        }
    }

    stopPianoKey(keyElement) {
        const frequency = parseFloat(keyElement.dataset.freq);

        if (!this.activePianoTones.has(frequency)) return;

        const tone = this.activePianoTones.get(frequency);

        // Quick release for all gain nodes
        if (tone.gains) {
            tone.gains.forEach(gain => {
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.1);
            });
        } else if (tone.gain) {
            // Fallback for old single-oscillator format
            tone.gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.1);
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
            this.activePianoTones.delete(frequency);
        }, 150);

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

    drawSpectrum(data) {
        const width = this.spectrumCanvas.offsetWidth;
        const height = this.spectrumCanvas.offsetHeight;

        this.spectrumCtx.fillStyle = 'rgb(20, 20, 30)';
        this.spectrumCtx.fillRect(0, 0, width, height);

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
                if (data[bin] > 128 && freq > 80) {
                    // Brighter, more saturated color for peaks
                    this.spectrumCtx.fillStyle = `hsl(${hue2}, 100%, 75%)`;
                } else {
                    // Normal gradient for non-peak bins
                    this.spectrumCtx.fillStyle = gradient;
                }

                // Draw rounded rectangle for smoother appearance
                this.drawRoundedRect(x, height - barHeight, barWidth - 1, barHeight, 2);

                // Only analyze peaks above threshold (about 50% of scale)
                if (data[bin] > 128 && freq > 80) {
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

        // this.drawNoteLabels(); // Disabled for cleaner look
        // this.drawFrequencySeparator(); // Disabled for cleaner look
        // this.drawThresholdLine(); // Disabled for cleaner look

        // Always detect dominant key from all available data
        const analysisZonePeaks = prominentPeaks.map(peak => ({
            ...peak,
            value: peak.isGenerationZone ? peak.value * 0.3 : peak.value * 1.5
        }));

        const roomModeData = this.roomModes.map(m => ({freq: m.frequency, value: m.strength}));
        const allKeyData = [...analysisZonePeaks, ...roomModeData];

        console.log(`Key detection input: ${analysisZonePeaks.length} peaks, ${roomModeData.length} room modes`);

        // Check if we have any meaningful peaks (not just prominent peaks array length)
        const hasSignificantPeaks = prominentPeaks.length > 0 && prominentPeaks[0].value >= 128;

        // Only detect key if we have current significant peaks, not just old room modes
        const dominantKey = hasSignificantPeaks ? this.detectDominantKey(allKeyData) : null;
        const resonanceStrength = this.calculateResonanceStrength(prominentPeaks, this.roomModes);

        console.log(`Detected key: ${dominantKey}, strength: ${resonanceStrength.toFixed(3)}`);

        // Draw the dominant key in the center
        this.drawKeyIndicator(width / 2, height / 2, dominantKey, resonanceStrength);

        // Track and generate tones for settled frequencies (disabled for now)
        // this.trackSettledFrequencies(prominentPeaks);

        // Note: Active notes display removed

        // Generate low drone tone based on detected key
        this.updateToneGeneration(dominantKey, resonanceStrength);

        const currentTime = Date.now();

        if (hasSignificantPeaks) {
            // Use the strongest prominent peak for the main indicator
            const mainPeak = prominentPeaks[0];
            console.log(`Main peak: ${mainPeak.freq.toFixed(1)}Hz (${this.frequencyToNote(mainPeak.freq)}), value: ${mainPeak.value}`);

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

            console.log(`No peaks: time since last peak: ${timeSinceLastPeak}ms, fade opacity: ${this.peakFadeOpacity.toFixed(2)}`);

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
        const hzLabel = 'Hz';

        this.spectrumCtx.shadowColor = `rgba(255, 170, 0, ${fadeOpacity * 0.8})`;
        this.spectrumCtx.shadowBlur = 8;
        this.spectrumCtx.font = 'bold 14px monospace';
        this.spectrumCtx.fillStyle = `rgba(255, 221, 68, ${fadeOpacity})`;
        this.spectrumCtx.textBaseline = 'alphabetic';

        // Frequency value to the left of the line
        this.spectrumCtx.textAlign = 'right';
        this.spectrumCtx.fillText(freqValue, x - 5, 70);

        // Hz label to the right of the line
        this.spectrumCtx.textAlign = 'left';
        this.spectrumCtx.fillText(hzLabel, x + 5, 70);

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
            // Debug B2 range (around 123Hz)
            if (peak.freq >= 120 && peak.freq <= 130) {
                console.log(`B2 peak detected: ${peak.freq.toFixed(1)}Hz, value: ${peak.value}`);
            }

            if (peak.value < 128) break; // Higher threshold to ignore noise

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
        if (allPeaks.length === 0) return null;

        // Vallotti temperament frequencies for key detection
        const C4_base = 261.626;
        const vallottiDeviations = [0, -5.86, -3.91, -9.77, -1.96, -1.96, -7.82, -1.96, -7.82, -3.91, -9.77, -1.96];

        const noteFrequencies = {};
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        noteNames.forEach((noteName, noteIndex) => {
            noteFrequencies[noteName] = [];
            // Generate 5 octaves for each note (C1 to C6)
            for (let oct = 1; oct <= 5; oct++) {
                const octaveMultiplier = Math.pow(2, oct - 4); // Relative to C4
                const equalTempFreq = C4_base * Math.pow(2, noteIndex/12) * octaveMultiplier;
                const vallottiFreq = equalTempFreq * Math.pow(2, vallottiDeviations[noteIndex]/1200);
                noteFrequencies[noteName].push(vallottiFreq);
            }
        });

        const keyScores = {};

        Object.keys(noteFrequencies).forEach(key => {
            keyScores[key] = 0;

            allPeaks.forEach(peak => {
                const closestNote = noteFrequencies[key].reduce((closest, freq) => {
                    const currentDistance = Math.abs(Math.log2(peak.freq / freq));
                    const closestDistance = Math.abs(Math.log2(peak.freq / closest));
                    return currentDistance < closestDistance ? freq : closest;
                });

                const distance = Math.abs(Math.log2(peak.freq / closestNote));
                if (distance < 0.1) {
                    keyScores[key] += (peak.value || 100) * (1 - distance * 10);
                }
            });
        });

        const bestKey = Object.keys(keyScores).reduce((a, b) =>
            keyScores[a] > keyScores[b] ? a : b
        );

        return keyScores[bestKey] > 50 ? bestKey : null;
    }

    calculateResonanceStrength(peaks, modes) {
        const peakStrength = peaks.reduce((sum, p) => sum + p.value, 0) / peaks.length || 0;
        const modeStrength = modes.reduce((sum, m) => sum + m.strength, 0) / modes.length || 0;
        const combinedStrength = (peakStrength + modeStrength * 1.5) / 255;
        return Math.min(combinedStrength, 1);
    }

    drawKeyIndicator(centerX, centerY, key, strength) {
        if (!key || strength < 0.1) return;

        this.spectrumCtx.save();

        const baseOpacity = 0.1 + strength * 0.6;
        const pulseIntensity = strength * 0.3;
        const pulse = Math.sin(Date.now() * 0.004) * pulseIntensity + (1 - pulseIntensity);
        const finalOpacity = baseOpacity * pulse;

        const glowLayers = [
            { size: 160, alpha: finalOpacity * 0.05, color: '255, 40, 80' },
            { size: 150, alpha: finalOpacity * 0.08, color: '255, 60, 100' },
            { size: 140, alpha: finalOpacity * 0.12, color: '255, 80, 120' },
            { size: 130, alpha: finalOpacity * 0.15, color: '255, 100, 140' },
            { size: 120, alpha: finalOpacity * 0.2, color: '255, 120, 160' }
        ];

        glowLayers.forEach(layer => {
            this.spectrumCtx.font = `bold ${layer.size}px -apple-system, BlinkMacSystemFont, sans-serif`;
            this.spectrumCtx.fillStyle = `rgba(${layer.color}, ${layer.alpha})`;
            this.spectrumCtx.textAlign = 'center';
            this.spectrumCtx.textBaseline = 'middle';
            this.spectrumCtx.fillText(key, centerX, centerY);
        });

        const gradient = this.spectrumCtx.createLinearGradient(0, centerY - 60, 0, centerY + 60);
        gradient.addColorStop(0, `rgba(255, 180, 200, ${finalOpacity * 0.9})`);
        gradient.addColorStop(0.5, `rgba(255, 100, 140, ${finalOpacity * 0.95})`);
        gradient.addColorStop(1, `rgba(255, 60, 100, ${finalOpacity * 0.9})`);

        this.spectrumCtx.font = 'bold 120px -apple-system, BlinkMacSystemFont, sans-serif';
        this.spectrumCtx.fillStyle = gradient;
        this.spectrumCtx.fillText(key, centerX, centerY);

        this.spectrumCtx.strokeStyle = `rgba(255, 200, 220, ${finalOpacity * 0.4})`;
        this.spectrumCtx.lineWidth = 3;
        this.spectrumCtx.strokeText(key, centerX, centerY);

        this.spectrumCtx.restore();
    }

    drawThresholdLine() {
        const width = this.spectrumCanvas.offsetWidth;
        const height = this.spectrumCanvas.offsetHeight;

        // Threshold line at about 50% of scale (corresponds to value 128/255)
        const thresholdY = height - (height * 0.8 * (128/255));

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
        this.gainNode.gain.setValueAtTime(0.05, this.audioContext.currentTime); // Start very quiet

        // Connect: oscillators -> gain -> reverb -> destination
        this.gainNode.connect(this.reverbNode);
        this.reverbNode.connect(this.audioContext.destination);
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
                console.log(`Starting harmonic tone for ${freq.toFixed(1)}Hz (settled for ${(age/1000).toFixed(1)}s)`);
                this.startHarmonicTone(freq, data.strength);
                data.hasGeneratedTone = true;
            }
        }
    }

    startHarmonicTone(frequency, strength) {
        if (this.isMuted || this.harmonicOscillators.has(frequency) || !this.audioContext || !this.gainNode) return;

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

            console.log(`Harmonic tone volumes: strength=${strength}, safe=${safeStrength}, target=${targetVolume}, final=${finalVolume}`);

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
        if (!key || strength < 0.2 || this.isMuted) {
            // Not enough signal strength or muted, fade out
            if (this.gainNode) {
                this.gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.5);
            }
            return;
        }

        // Only update if key changed significantly
        if (key !== this.currentToneKey) {
            this.currentToneKey = key;
            this.stopToneGeneration();
            this.startToneGeneration(key, strength);
        } else {
            // Update volume based on strength
            if (this.gainNode) {
                const targetVolume = Math.min(strength * 0.3, 0.2); // Keep it subtle
                this.gainNode.gain.exponentialRampToValueAtTime(targetVolume, this.audioContext.currentTime + 0.1);
            }
        }
    }

    startToneGeneration(key, strength) {
        if (!this.audioContext || !this.gainNode) return;

        console.log(`Starting drone for key: ${key}`);

        // Generate Vallotti-tuned low drone frequencies for the detected key
        const droneFrequencies = this.getVallottiDroneFrequencies(key);

        droneFrequencies.forEach((freq, index) => {
            const oscillator = this.audioContext.createOscillator();
            const oscGain = this.audioContext.createGain();

            // Use sine waves for smooth, warm drone
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(freq, this.audioContext.currentTime);

            // Very subtle volume - just a gentle foundation
            const volume = (index === 0) ? 0.08 : 0.04; // Root note slightly louder
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

        console.log(`Drone frequencies for ${key}:`, drones);
        return drones.slice(0, 4); // Limit to 4 drones max
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
    const analyser = new RoomtoneAnalyser();
    setTimeout(() => analyser.start(), 100);
});