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
        this.peakFreqDisplay = document.getElementById('peakFreq');
        this.dominantNoteDisplay = document.getElementById('dominantNote');

        this.smoothedPeakFreq = 0;
        this.smoothedPeakX = 0;
        this.smoothingFactor = 0.85;
        this.currentNote = '';
        this.smoothedNote = '';

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

            this.isRunning = true;
            this.toggleBtn.textContent = 'Stop Listening';
            this.toggleBtn.classList.remove('btn-primary');
            this.toggleBtn.classList.add('btn-secondary');

            this.draw();
        } catch (error) {
            console.error('Error accessing microphone:', error);
            alert('Unable to access microphone. Please ensure permissions are granted.');
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
            this.audioContext.close();
        }

        this.toggleBtn.textContent = 'Start Listening';
        this.toggleBtn.classList.remove('btn-secondary');
        this.toggleBtn.classList.add('btn-primary');

        this.clearCanvases();
        this.peakFreqDisplay.textContent = '-- Hz';
        this.dominantNoteDisplay.textContent = '--';
    }

    draw() {
        if (!this.isRunning) return;

        const frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
        const waveformData = new Uint8Array(this.analyser.frequencyBinCount);

        this.analyser.getByteFrequencyData(frequencyData);
        this.analyser.getByteTimeDomainData(waveformData);

        this.drawSpectrum(frequencyData);
        this.drawWaveform(waveformData);
        this.updateFrequencyInfo(frequencyData);

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

        const gradient = this.spectrumCtx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, '#4a9eff');
        gradient.addColorStop(0.5, '#00ff88');
        gradient.addColorStop(1, '#ffaa00');

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

                if (data[bin] > 30 && freq > 80 && freq < 4000) {
                    peaks.push({ value: data[bin], freq: freq, x: x });
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

            this.drawPeakIndicator(this.smoothedPeakX, this.smoothedPeakFreq, height, this.smoothedNote);

            // Draw secondary prominent peaks
            prominentPeaks.slice(1, 4).forEach(peak => {
                this.drawSecondaryPeak(peak.x, peak.freq, height, peak.value);
            });
        }
    }

    drawPeakIndicator(x, freq, height, displayNote) {
        const note = displayNote || this.frequencyToNote(freq);
        const width = this.spectrumCanvas.offsetWidth;

        // Epic glowing note overlay
        this.spectrumCtx.save();

        // Multiple glow layers for that sweet sweet bloom
        const glowLayers = [
            { size: 140, alpha: 0.05, color: '255, 40, 80' },
            { size: 130, alpha: 0.08, color: '255, 60, 100' },
            { size: 120, alpha: 0.12, color: '255, 80, 120' },
            { size: 110, alpha: 0.15, color: '255, 100, 140' },
            { size: 100, alpha: 0.2, color: '255, 120, 160' }
        ];

        glowLayers.forEach(layer => {
            this.spectrumCtx.font = `bold ${layer.size}px -apple-system, BlinkMacSystemFont, sans-serif`;
            this.spectrumCtx.fillStyle = `rgba(${layer.color}, ${layer.alpha})`;
            this.spectrumCtx.textAlign = 'center';
            this.spectrumCtx.textBaseline = 'middle';
            this.spectrumCtx.fillText(note, width / 2, height / 2);
        });

        // Main note text with gradient
        const gradient = this.spectrumCtx.createLinearGradient(0, height / 2 - 60, 0, height / 2 + 60);
        gradient.addColorStop(0, 'rgba(255, 180, 200, 0.9)');
        gradient.addColorStop(0.5, 'rgba(255, 100, 140, 0.95)');
        gradient.addColorStop(1, 'rgba(255, 60, 100, 0.9)');

        this.spectrumCtx.font = 'bold 100px -apple-system, BlinkMacSystemFont, sans-serif';
        this.spectrumCtx.fillStyle = gradient;
        this.spectrumCtx.fillText(note, width / 2, height / 2);

        // Add some sparkle with a subtle stroke
        this.spectrumCtx.strokeStyle = 'rgba(255, 200, 220, 0.3)';
        this.spectrumCtx.lineWidth = 3;
        this.spectrumCtx.strokeText(note, width / 2, height / 2);

        this.spectrumCtx.restore();

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
        this.spectrumCtx.fillText(labelText, x, 25);

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

    updateFrequencyInfo(data) {
        let maxValue = 0;
        let maxIndex = 0;

        for (let i = 0; i < data.length / 2; i++) {
            if (data[i] > maxValue) {
                maxValue = data[i];
                maxIndex = i;
            }
        }

        const nyquist = this.audioContext.sampleRate / 2;
        const frequency = (maxIndex / data.length) * nyquist * 2;

        if (maxValue > 50) {
            this.peakFreqDisplay.textContent = `${frequency.toFixed(1)} Hz`;
            this.dominantNoteDisplay.textContent = this.frequencyToNote(frequency);
        }
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
}

document.addEventListener('DOMContentLoaded', () => {
    const analyser = new RoomtoneAnalyser();
    setTimeout(() => analyser.start(), 100);
});