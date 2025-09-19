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

        const barWidth = width / data.length * 2.5;
        let x = 0;

        const gradient = this.spectrumCtx.createLinearGradient(0, height, 0, 0);
        gradient.addColorStop(0, '#4a9eff');
        gradient.addColorStop(0.5, '#00ff88');
        gradient.addColorStop(1, '#ffaa00');

        for (let i = 0; i < data.length; i++) {
            const barHeight = (data[i] / 255) * height * 0.8;

            this.spectrumCtx.fillStyle = gradient;
            this.spectrumCtx.fillRect(x, height - barHeight, barWidth, barHeight);

            x += barWidth + 1;

            if (x > width) break;
        }

        this.spectrumCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        this.spectrumCtx.beginPath();
        this.spectrumCtx.moveTo(0, height / 2);
        this.spectrumCtx.lineTo(width, height / 2);
        this.spectrumCtx.stroke();
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