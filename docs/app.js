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
        let peakValue = 0;
        let peakFreq = 0;
        let peakX = 0;

        for (let x = 0; x < width; x += barWidth) {
            const logFreq = logMin + (x / width) * (logMax - logMin);
            const freq = Math.pow(10, logFreq);
            const bin = Math.floor((freq / nyquist) * data.length);

            if (bin < data.length) {
                const barHeight = (data[bin] / 255) * height * 0.8;
                this.spectrumCtx.fillStyle = gradient;
                this.spectrumCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

                if (data[bin] > peakValue && freq > 80 && freq < 4000) {
                    peakValue = data[bin];
                    peakFreq = freq;
                    peakX = x;
                }
            }
        }

        this.spectrumCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(0, height / 2);
        this.spectrumCtx.lineTo(width, height / 2);
        this.spectrumCtx.stroke();

        this.drawNoteLabels();

        if (peakValue > 50) {
            this.drawPeakIndicator(peakX, peakFreq, height);
        }
    }

    drawPeakIndicator(x, freq, height) {
        this.spectrumCtx.strokeStyle = '#ffaa00';
        this.spectrumCtx.lineWidth = 2;
        this.spectrumCtx.setLineDash([]);
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(x, 0);
        this.spectrumCtx.lineTo(x, height - 20);
        this.spectrumCtx.stroke();
        this.spectrumCtx.lineWidth = 1;

        const note = this.frequencyToNote(freq);
        const labelText = `${freq.toFixed(1)} Hz (${note})`;

        this.spectrumCtx.font = '12px monospace';
        this.spectrumCtx.fillStyle = '#ffaa00';
        this.spectrumCtx.textAlign = 'center';
        this.spectrumCtx.fillText(labelText, x, 20);
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

        const sliceWidth = width / data.length;
        let x = 0;

        for (let i = 0; i < data.length; i++) {
            const v = data[i] / 128.0;
            const y = v * height / 2;

            if (i === 0) {
                this.waveformCtx.moveTo(x, y);
            } else {
                this.waveformCtx.lineTo(x, y);
            }

            x += sliceWidth;
        }

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