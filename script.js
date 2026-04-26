// Math Helpers
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    let max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s, v = max;
    let d = max - min;
    s = max === 0 ? 0 : d / max;
    if (max !== min) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return [h * 360, s * 100, v * 100];
}

// True Circular Dilation
function dilateMask(mask, w, h, radius) {
    if (radius === 0) return mask;
    let out = new Uint8Array(w * h);
    
    let bounds = [];
    let rSq = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
        let dxMax = Math.floor(Math.sqrt(rSq - dy * dy));
        bounds.push({ dy: dy, dxMax: dxMax });
    }

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (mask[y * w + x]) {
                for (let i = 0; i < bounds.length; i++) {
                    let ny = y + bounds[i].dy;
                    if (ny < 0 || ny >= h) continue;
                    
                    let dxMax = bounds[i].dxMax;
                    let nxStart = Math.max(0, x - dxMax);
                    let nxEnd = Math.min(w - 1, x + dxMax);
                    
                    let offset = ny * w;
                    for (let nx = nxStart; nx <= nxEnd; nx++) {
                        out[offset + nx] = 1;
                    }
                }
            }
        }
    }
    return out;
}

// Processing Core
const InspectionEffect = {
    apply: function(video, canvas, params, mode) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        if (video.videoWidth === 0) return;
        
        const qualityScale = (params.resQuality !== undefined ? params.resQuality : 100) / 100;
        const procWidth = Math.max(1, Math.floor(video.videoWidth * qualityScale));
        const procHeight = Math.max(1, Math.floor(video.videoHeight * qualityScale));

        if (canvas.width !== procWidth) canvas.width = procWidth;
        if (canvas.height !== procHeight) canvas.height = procHeight;
        
        ctx.drawImage(video, 0, 0, procWidth, procHeight);
        const imgData = ctx.getImageData(0, 0, procWidth, procHeight);
        const data = imgData.data;
        
        const w = procWidth;
        const h = procHeight;
        const totalPixels = w * h;

        let crackHits = new Uint8Array(totalPixels);
        let rustHits = new Uint8Array(totalPixels);
        let grayscaleData = null;

        // Band Pass Grayscale Generation (for Crack/Edge Detection)
        if (mode === 'crack' || mode === 'combined') {
            grayscaleData = new Float32Array(totalPixels);
            let bandMedianScaled = params.crackBandMedian * 2.55; 
            let halfWidth = (params.crackBandRange * 2.55) / 2;

            for (let i = 0; i < totalPixels; i++) {
                let idx = i * 4;
                let r = data[idx], g = data[idx+1], b = data[idx+2];
                let gray = 0.299 * r + 0.587 * g + 0.114 * b;
                
                if (Math.abs(gray - bandMedianScaled) > halfWidth) {
                    gray = 0;
                }
                grayscaleData[i] = gray;
            }
        }

        // Detection Pass
        for (let y = 0; y < h - 1; y++) {
            for (let x = 0; x < w - 1; x++) {
                let idx = y * w + x;
                let i = idx * 4;

                // Rust Detection
                if (mode === 'rust' || mode === 'combined') {
                    let r = data[i], g = data[i+1], b = data[i+2];
                    let [hue, sat, val] = rgbToHsv(r, g, b);
                    
                    if (sat >= params.rustSatMin && sat <= params.rustSatMax && 
                        val >= params.rustValMin && val <= params.rustValMax) {
                        
                        let hueMatch = false;
                        if (params.rustHueMin <= params.rustHueMax) {
                            hueMatch = hue >= params.rustHueMin && hue <= params.rustHueMax;
                        } else {
                            hueMatch = hue >= params.rustHueMin || hue <= params.rustHueMax;
                        }
                        
                        // Filters
                        let isBeige = (hue >= 10 && hue <= 50 && sat < 50 && val > 40);
                        let isGreen = (hue >= 70 && hue <= 160 && sat > 15 && val > 15);

                        // Exclude beige and green backgrounds
                        if (hueMatch && !isBeige && !isGreen) {
                            rustHits[idx] = 1;
                        }
                    }
                }

                // Crack/Edge Detection
                if (mode === 'crack' || mode === 'combined') {
                    let lum = grayscaleData[idx];
                    let lumR = grayscaleData[idx + 1];
                    let lumB = grayscaleData[idx + w];

                    let diff = Math.abs(lum - lumR) + Math.abs(lum - lumB);
                    if (diff > params.crackThreshold) {
                        crackHits[idx] = 1;
                    }
                }
            }
        }

        // Dilation Pass
        let crackMask = null;
        let rustMask = null;
        if (mode === 'crack' || mode === 'combined') {
            crackMask = dilateMask(crackHits, w, h, params.crackThickness);
        }
        if (mode === 'rust' || mode === 'combined') {
            rustMask = dilateMask(rustHits, w, h, params.rustPadding);
        }

        // Apply Mask to Image Data
        for (let idx = 0; idx < totalPixels; idx++) {
            let keepCrack = false;
            let keepRust = false;

            if ((mode === 'crack' || mode === 'combined') && crackMask && crackMask[idx]) keepCrack = true;
            if ((mode === 'rust' || mode === 'combined') && rustMask && rustMask[idx]) keepRust = true;

            let keep = keepCrack || keepRust;
            let i = idx * 4;

            if (params.viewMode === 'highlight') {
                if (keep) {
                    if (keepRust && keepCrack) {
                        data[i] = (data[i] + 255) / 2;
                        data[i+1] = (data[i+1] + 255) / 2;
                        data[i+2] = data[i+2] / 2;
                    } else if (keepRust) {
                        data[i] = (data[i] + 255) / 2;
                        data[i+1] = data[i+1] / 2;
                        data[i+2] = data[i+2] / 2;
                    } else if (keepCrack) {
                        data[i] = data[i] / 2;
                        data[i+1] = (data[i+1] + 255) / 2;
                        data[i+2] = data[i+2] / 2;
                    }
                }
            } else {
                if (!keep) {
                    data[i] = 0;
                    data[i+1] = 0;
                    data[i+2] = 0;
                }
            }
        }

        ctx.putImageData(imgData, 0, 0);
    }
};

// UI & Camera Application Logic
document.addEventListener('DOMContentLoaded', function() {
    const singleVideo = document.getElementById('single-video');
    const canvasSingle = document.getElementById('canvas-single');
    
    const toggleCameraButton = document.getElementById('toggle-camera');
    const switchCameraButton = document.getElementById('switch-camera');
    const toggleViewButton = document.getElementById('toggle-view');
    
    const effectSelect = document.getElementById('effect-select');
    const crackControls = document.getElementById('crack-controls');
    const rustControls = document.getElementById('rust-controls');
    const controlsPanel = document.getElementById('controls-panel');
    const statusDiv = document.getElementById('status');
    const cameraDisplay = document.getElementById('camera-display');
    const effectDisplay = document.getElementById('effect-display');

    // UPDATED Default Configuration States for Reset feature based on new HTML
    const defaults = {
        crackThreshold: 100,
        crackThickness: 5,
        crackBandMedian: 45,
        crackBandRange: 5,
        rustHueMin: 0,
        rustHueMax: 15,
        rustSatMin: 30,
        rustSatMax: 100,
        rustValMin: 15,
        rustValMax: 70,
        rustPadding: 5
    };

    // Inputs Arrays for dynamic binding
    const sliders = {
        crackThreshold: document.getElementById('crackThreshold'),
        crackThickness: document.getElementById('crackThickness'),
        crackBandMedian: document.getElementById('crackBandMedian'),
        crackBandRange: document.getElementById('crackBandRange'),
        rustHueMin: document.getElementById('rustHueMin'),
        rustHueMax: document.getElementById('rustHueMax'),
        rustSatMin: document.getElementById('rustSatMin'),
        rustSatMax: document.getElementById('rustSatMax'),
        rustValMin: document.getElementById('rustValMin'),
        rustValMax: document.getElementById('rustValMax'),
        rustPadding: document.getElementById('rustPadding'),
        resQuality: document.getElementById('resQuality')
    };

    const sliderLabels = {
        crackThreshold: document.getElementById('valCrackThresh'),
        crackThickness: document.getElementById('valCrackThickness'),
        crackBandMedian: document.getElementById('valCrackBandMedian'),
        crackBandRange: document.getElementById('valCrackBandRange'),
        rustHueMin: document.getElementById('valRustHueMin'),
        rustHueMax: document.getElementById('valRustHueMax'),
        rustSatMin: document.getElementById('valRustSatMin'),
        rustSatMax: document.getElementById('valRustSatMax'),
        rustValMin: document.getElementById('valRustValMin'),
        rustValMax: document.getElementById('valRustValMax'),
        rustPadding: document.getElementById('valRustPad'),
        resQuality: document.getElementById('valResQuality')
    };

    let stream = null;
    let hideControlsTimeout = null;
    let usingBackCamera = true;
    let currentMode = 'combined';
    let currentViewMode = 'mask';
    let animationFrameId = null;
    const HIDE_DELAY = 3000;

    let frameCount = 0;
    let lastFpsTime = 0;
    let currentFps = 0;

    function loadSettings() {
        try {
            const saved = localStorage.getItem('inspectionAppSettings');
            if (saved) {
                const settings = JSON.parse(saved);
                for (let key in sliders) {
                    if (sliders[key] && settings[key] !== undefined) {
                        sliders[key].value = settings[key];
                    }
                }
                if (settings.mode && effectSelect) {
                    currentMode = settings.mode;
                    effectSelect.value = currentMode;
                }
                if (settings.viewMode && toggleViewButton) {
                    currentViewMode = settings.viewMode;
                    toggleViewButton.textContent = currentViewMode === 'mask' ? 'View: Mask' : 'View: Highlight';
                }
            }
        } catch(e) {
            console.error("Could not load settings:", e);
        }
    }

    function saveSettings() {
        try {
            const settings = {};
            for (let key in sliders) {
                if (sliders[key]) {
                    settings[key] = sliders[key].value;
                }
            }
            settings.mode = currentMode;
            settings.viewMode = currentViewMode;
            localStorage.setItem('inspectionAppSettings', JSON.stringify(settings));
        } catch(e) {
            console.error("Could not save settings:", e);
        }
    }

    async function startCamera() {
        try {
            statusDiv.textContent = 'Requesting camera access...';
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1920 },
                    height: { ideal: 1080 },
                    facingMode: usingBackCamera ? { exact: 'environment' } : 'user'
                },
                audio: false
            });
            setupVideoStream();
        } catch (error) {
            console.warn('Environment camera failed, trying generic...', error);
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                usingBackCamera = false;
                setupVideoStream();
            } catch (fallbackError) {
                statusDiv.textContent = `Error: ${fallbackError.message}`;
            }
        }
    }

    function setupVideoStream() {
        singleVideo.srcObject = stream;
        statusDiv.textContent = 'Camera active';
        frameCount = 0;
        lastFpsTime = performance.now();
        updateCameraDisplay();
        startEffectRendering();
        resetHideControlsTimer();
    }

    function stopCamera() {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            stream = null;
            if (animationFrameId) cancelAnimationFrame(animationFrameId);
            singleVideo.srcObject = null;
            statusDiv.textContent = 'Camera stopped';
            toggleCameraButton.textContent = 'Start Camera';
        }
    }

    async function switchCamera() {
        if (stream) {
            stopCamera();
            usingBackCamera = !usingBackCamera;
            await startCamera();
        }
    }

    function startEffectRendering() {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        
        function renderEffects() {
            if (stream) {
                const now = performance.now();
                frameCount++;
                if (now - lastFpsTime >= 1000) {
                    currentFps = Math.round((frameCount * 1000) / (now - lastFpsTime));
                    frameCount = 0;
                    lastFpsTime = now;
                    statusDiv.textContent = `Camera active - ${currentFps} FPS`;
                }

                const params = {};
                for (let key in sliders) {
                    if (sliders[key]) {
                        params[key] = parseInt(sliders[key].value, 10);
                    }
                }
                params.viewMode = currentViewMode;

                InspectionEffect.apply(singleVideo, canvasSingle, params, currentMode);
                canvasSingle.style.display = 'block';
            } else {
                canvasSingle.style.display = 'none';
            }
            animationFrameId = requestAnimationFrame(renderEffects);
        }
        renderEffects();
    }

    function changeMode() {
        currentMode = effectSelect.value;
        effectDisplay.textContent = `Mode: ${currentMode.charAt(0).toUpperCase() + currentMode.slice(1)}`;
        
        crackControls.classList.add('ui-hidden-element');
        rustControls.classList.add('ui-hidden-element');

        if (currentMode === 'crack' || currentMode === 'combined') {
            crackControls.classList.remove('ui-hidden-element');
        }
        if (currentMode === 'rust' || currentMode === 'combined') {
            rustControls.classList.remove('ui-hidden-element');
        }
        resetHideControlsTimer();
        saveSettings();
    }

    function updateParams() {
        for(let key in sliders) {
            if (sliders[key] && sliderLabels[key]) {
                sliderLabels[key].textContent = sliders[key].value;
            }
        }
        resetHideControlsTimer();
        saveSettings();
    }

    function updateCameraDisplay() { 
        cameraDisplay.textContent = `Camera: ${usingBackCamera ? 'Back' : 'Front'}`; 
        switchCameraButton.textContent = `Switch to ${usingBackCamera ? 'Front' : 'Back'} Camera`; 
    }

    function hideControls() { controlsPanel.classList.add('hidden'); }
    function showControls() { controlsPanel.classList.remove('hidden'); resetHideControlsTimer(); }
    
    function toggleControls(e) {
        if (e.target.closest('#controls-panel')) {
            resetHideControlsTimer();
            return;
        }
        if (controlsPanel.classList.contains('hidden')) showControls();
        else { hideControls(); if (hideControlsTimeout) clearTimeout(hideControlsTimeout); }
    }
    
    function resetHideControlsTimer() {
        if (hideControlsTimeout) clearTimeout(hideControlsTimeout);
        hideControlsTimeout = setTimeout(hideControls, HIDE_DELAY);
    }

    async function toggleCamera() {
        if (stream) {
            stopCamera();
        } else {
            await startCamera();
        }
    }

    function toggleView() {
        if (currentViewMode === 'mask') {
            currentViewMode = 'highlight';
            toggleViewButton.textContent = 'View: Highlight';
        } else {
            currentViewMode = 'mask';
            toggleViewButton.textContent = 'View: Mask';
        }
        resetHideControlsTimer();
        saveSettings();
    }

    // Reset Handlers
    document.getElementById('reset-crack').addEventListener('click', () => {
        ['crackThreshold', 'crackThickness', 'crackBandMedian', 'crackBandRange'].forEach(key => {
            if(sliders[key]) sliders[key].value = defaults[key];
        });
        updateParams();
    });

    document.getElementById('reset-rust').addEventListener('click', () => {
        ['rustHueMin', 'rustHueMax', 'rustSatMin', 'rustSatMax', 'rustValMin', 'rustValMax', 'rustPadding'].forEach(key => {
            if(sliders[key]) sliders[key].value = defaults[key];
        });
        updateParams();
    });

    // Main Listeners
    toggleCameraButton.addEventListener('click', toggleCamera);
    switchCameraButton.addEventListener('click', switchCamera);
    toggleViewButton.addEventListener('click', toggleView);
    effectSelect.addEventListener('change', changeMode);
    
    for(let key in sliders) {
        if (sliders[key]) {
            sliders[key].addEventListener('input', updateParams);
        }
    }

    document.body.addEventListener('click', toggleControls);

    loadSettings();
    updateParams();
    changeMode(); 
});