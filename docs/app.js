class RoomtoneAnalyser {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.animationId = null;
        this.isRunning = false;

        this.spectrumCanvas = document.getElementById('spectrum');
        this.waveformCanvas = document.getElementById('waveform');
        this.spectrumCtx = this.spectrumCanvas.getContext('2d');
        this.waveformCtx = this.waveformCanvas.getContext('2d');

        this.toggleBtn = document.getElementById('toggleBtn');

        this.smoothedPeakFreq = 0;
        this.smoothedPeakX = 0;
        this.smoothingFactor = 0.85;
        this.currentNote = '';
        this.smoothedNote = '';

        // Room mode detection
        this.frequencyHistory = new Map();
        this.roomModes = [];
        this.modeDetectionStartTime = Date.now();
        this.minDetectionTime = 10000; // 10 seconds minimum

        // Tone generation
        this.oscillators = [];
        this.gainNode = null;
        this.currentToneKey = null;

        this.setupCanvases();
        this.bindEvents();
    }

    setupCanvases() {
        const resize = () => {
            this.spectrumCanvas.width = this.spectrumCanvas.offsetWidth * window.devicePixelRatio;
            this.spectrumCanvas.height = this.spectrumCanvas.offsetHeight * window.devicePixelRatio;
            this.spectrumCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

            this.waveformCanvas.width = this.waveformCanvas.offsetWidth * window.devicePixelRatio;
            this.waveformCanvas.height = this.waveformCanvas.offsetHeight * window.devicePixelRatio;
            this.waveformCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
        };

        resize();
        window.addEventListener('resize', resize);
    }

    bindEvents() {
        this.toggleBtn.addEventListener('click', () => this.toggle());
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

        this.clearCanvases();
    }

    draw() {
        if (!this.isRunning) return;

        const frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        const waveformData = new Uint8Array(this.analyser.frequencyBinCount);

        this.analyser.getByteFrequencyData(frequencyData);
        this.analyser.getByteTimeDomainData(waveformData);

        this.drawSpectrum(frequencyData);
        this.drawWaveform(waveformData);

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
                const amplitude = data[bin] / 255;
                const logAmplitude = amplitude > 0 ? Math.log10(amplitude * 9 + 1) : 0;
                const barHeight = logAmplitude * height * 0.8;
                this.spectrumCtx.fillStyle = gradient;
                this.spectrumCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

                // Analyze full spectrum but mark generation vs analysis zones
                if (data[bin] > 30 && freq > 80 && freq < 4000) {
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

        this.drawNoteLabels();
        this.drawFrequencySeparator();

        // Always detect dominant key from all available data
        const analysisZonePeaks = prominentPeaks.map(peak => ({
            ...peak,
            value: peak.isGenerationZone ? peak.value * 0.3 : peak.value * 1.5
        }));

        const dominantKey = this.detectDominantKey([...analysisZonePeaks, ...this.roomModes.map(m => ({freq: m.frequency, value: m.strength}))]);
        const resonanceStrength = this.calculateResonanceStrength(prominentPeaks, this.roomModes);

        // Draw the dominant key in the center
        this.drawKeyIndicator(width / 2, height / 2, dominantKey, resonanceStrength);

        // Generate tones based on detected key
        this.updateToneGeneration(dominantKey, resonanceStrength);

        if (prominentPeaks.length > 0) {
            // Use the strongest prominent peak for the main indicator
            const mainPeak = prominentPeaks[0];

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

            // Draw peak indicator line (not in center)
            this.drawPeakIndicator(this.smoothedPeakX, this.smoothedPeakFreq, height, this.smoothedNote);

            // Draw secondary prominent peaks
            prominentPeaks.slice(1, 4).forEach(peak => {
                this.drawSecondaryPeak(peak.x, peak.freq, height, peak.value);
            });

            // Track frequencies for room mode detection
            this.trackFrequencyHistory(prominentPeaks);
        }

        // Draw detected room modes
        this.drawRoomModes();
    }

    drawPeakIndicator(x, freq, height, displayNote) {
        const note = displayNote || this.frequencyToNote(freq);

        // Pulsing orange indicator line
        const pulse = Math.sin(Date.now() * 0.008) * 0.3 + 0.7;
        this.spectrumCtx.strokeStyle = `rgba(255, 170, 0, ${pulse})`;
        this.spectrumCtx.lineWidth = 3;
        this.spectrumCtx.setLineDash([]);
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(x, 0);
        this.spectrumCtx.lineTo(x, height - 20);
        this.spectrumCtx.stroke();

        // Glowing frequency label
        const labelText = `${freq.toFixed(1)} Hz`;

        this.spectrumCtx.shadowColor = '#ffaa00';
        this.spectrumCtx.shadowBlur = 8;
        this.spectrumCtx.font = 'bold 14px monospace';
        this.spectrumCtx.fillStyle = '#ffdd44';
        this.spectrumCtx.textAlign = 'center';
        this.spectrumCtx.textBaseline = 'alphabetic';
        this.spectrumCtx.fillText(labelText, x, 70);

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
            if (peak.value < 50) break; // Minimum threshold

            // Check if this peak is far enough from already selected peaks
            const tooClose = prominent.some(p =>
                Math.abs(Math.log10(peak.freq) - Math.log10(p.freq)) < 0.05
            );

            if (!tooClose) {
                prominent.push(peak);
                if (prominent.length >= 5) break; // Max 5 peaks
            }
        }

        return prominent;
    }

    drawSecondaryPeak(x, freq, height, amplitude) {
        const alpha = Math.min(amplitude / 255 * 0.8, 0.6);

        // Smaller indicator line
        this.spectrumCtx.strokeStyle = `rgba(255, 200, 100, ${alpha})`;
        this.spectrumCtx.lineWidth = 1;
        this.spectrumCtx.setLineDash([3, 3]);
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(x, height * 0.2);
        this.spectrumCtx.lineTo(x, height - 20);
        this.spectrumCtx.stroke();
        this.spectrumCtx.setLineDash([]);

        // Small frequency label
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

            const label = `${mode.note} ROOM MODE`;
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

        this.spectrumCtx.fillText('GENERATE', x / 2, 30);
        this.spectrumCtx.fillText('<500Hz', x / 2, 50);

        this.spectrumCtx.fillText('ANALYZE', x + (width - x) / 2, 30);
        this.spectrumCtx.fillText('>500Hz', x + (width - x) / 2, 50);

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
        const A4 = 440;

        if (freq < 20 || freq > 20000) return '--';

        const semitones = 12 * Math.log2(freq / A4);
        const noteIndex = Math.round(semitones) % 12;
        const octave = Math.floor((semitones + 69) / 12);

        return notes[(noteIndex + 12) % 12] + octave;
    }

    clearCanvases() {
        this.spectrumCtx.fillStyle = 'rgb(20, 20, 30)';
        this.spectrumCtx.fillRect(0, 0, this.spectrumCanvas.width, this.spectrumCanvas.height);

        this.waveformCtx.fillStyle = 'rgb(20, 20, 30)';
        this.waveformCtx.fillRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
    }

    detectDominantKey(allPeaks) {
        if (allPeaks.length === 0) return null;

        const noteFrequencies = {
            'C': [65.41, 130.81, 261.63, 523.25, 1046.50],
            'C#': [69.30, 138.59, 277.18, 554.37, 1108.73],
            'D': [73.42, 146.83, 293.66, 587.33, 1174.66],
            'D#': [77.78, 155.56, 311.13, 622.25, 1244.51],
            'E': [82.41, 164.81, 329.63, 659.25, 1318.51],
            'F': [87.31, 174.61, 349.23, 698.46, 1396.91],
            'F#': [92.50, 185.00, 369.99, 739.99, 1479.98],
            'G': [98.00, 196.00, 392.00, 783.99, 1567.98],
            'G#': [103.83, 207.65, 415.30, 830.61, 1661.22],
            'A': [110.00, 220.00, 440.00, 880.00, 1760.00],
            'A#': [116.54, 233.08, 466.16, 932.33, 1864.66],
            'B': [123.47, 246.94, 493.88, 987.77, 1975.53]
        };

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

    setupToneGeneration() {
        // Create gain node for volume control
        this.gainNode = this.audioContext.createGain();
        this.gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime); // Start quiet
        this.gainNode.connect(this.audioContext.destination);
    }

    updateToneGeneration(key, strength) {
        if (!key || strength < 0.2) {
            // Not enough signal strength, fade out
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

        // Get bass frequencies for this key (below 500Hz)
        const bassFrequencies = this.getKeyBassFrequencies(key);

        bassFrequencies.forEach((freq, index) => {
            const oscillator = this.audioContext.createOscillator();
            const oscGain = this.audioContext.createGain();

            // Different waveforms for richness
            const waveforms = ['sine', 'triangle', 'sawtooth'];
            oscillator.type = waveforms[index % waveforms.length];

            oscillator.frequency.setValueAtTime(freq, this.audioContext.currentTime);

            // Individual oscillator gain
            const volume = (index === 0) ? 0.6 : 0.3; // Root note louder
            oscGain.gain.setValueAtTime(volume, this.audioContext.currentTime);

            oscillator.connect(oscGain);
            oscGain.connect(this.gainNode);

            oscillator.start();
            this.oscillators.push(oscillator);
        });
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