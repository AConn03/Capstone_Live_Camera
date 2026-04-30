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

        const isCrackMode = mode === 'crack' || mode === 'combined';
        const isRustMode = mode === 'rust' || mode === 'combined';
        const isHighlight = params.viewMode === 'highlight';

        if (isCrackMode) {
            grayscaleData = new Float32Array(totalPixels);
            let bandMedianScaled = params.crackBandMedian * 2.55; 
            let halfWidth = (params.crackBandRange * 2.55) / 2;

            for (let i = 0; i < totalPixels; i++) {
                let idx = i << 2; 
                let r = data[idx], g = data[idx+1], b = data[idx+2];
                let gray = 0.299 * r + 0.587 * g + 0.114 * b;
                
                if (Math.abs(gray - bandMedianScaled) > halfWidth) {
                    gray = 0;
                }
                grayscaleData[i] = gray;
            }
        }

        for (let y = 0; y < h - 1; y++) {
            for (let x = 0; x < w - 1; x++) {
                let idx = y * w + x;
                let i = idx << 2;

                if (isRustMode) {
                    let r_val = data[i] / 255, g_val = data[i+1] / 255, b_val = data[i+2] / 255;
                    let max = Math.max(r_val, g_val, b_val), min = Math.min(r_val, g_val, b_val);
                    let h_hue = 0, s_sat = 0, v_val = max;
                    let d = max - min;
                    
                    if (max !== 0) s_sat = d / max;
                    if (max !== min) {
                        if (max === r_val) { h_hue = (g_val - b_val) / d + (g_val < b_val ? 6 : 0); }
                        else if (max === g_val) { h_hue = (b_val - r_val) / d + 2; }
                        else if (max === b_val) { h_hue = (r_val - g_val) / d + 4; }
                        h_hue /= 6;
                    }
                    
                    let hue = h_hue * 360;
                    let sat = s_sat * 100;
                    let val = v_val * 100;
                    
                    if (sat >= params.rustSatMin && sat <= params.rustSatMax && 
                        val >= params.rustValMin && val <= params.rustValMax) {
                        
                        let hueMatch = false;
                        if (params.rustHueMin <= params.rustHueMax) {
                            hueMatch = hue >= params.rustHueMin && hue <= params.rustHueMax;
                        } else {
                            hueMatch = hue >= params.rustHueMin || hue <= params.rustHueMax;
                        }
                        
                        let isBeige = (hue >= 10 && hue <= 50 && sat < 50 && val > 40);
                        let isGreen = (hue >= 70 && hue <= 160 && sat > 15 && val > 15);

                        if (hueMatch && !isBeige && !isGreen) {
                            rustHits[idx] = 1;
                        }
                    }
                }

                if (isCrackMode) {
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

        let crackMask = null;
        let rustMask = null;
        let scaledCrackThick = Math.max(0, Math.round(params.crackThickness * qualityScale));
        let scaledRustPad = Math.max(0, Math.round(params.rustPadding * qualityScale));

        if (isCrackMode) {
            crackMask = dilateMask(crackHits, w, h, scaledCrackThick);
        }
        if (isRustMode) {
            rustMask = dilateMask(rustHits, w, h, scaledRustPad);
        }

        for (let idx = 0; idx < totalPixels; idx++) {
            let keepCrack = isCrackMode && crackMask && crackMask[idx];
            let keepRust = isRustMode && rustMask && rustMask[idx];

            let keep = keepCrack || keepRust;
            let i = idx << 2;

            if (isHighlight) {
                if (keep) {
                    if (keepCrack) {
                        data[i] = data[i] >> 1;
                        data[i+1] = (data[i+1] + 255) >> 1;
                        data[i+2] = data[i+2] >> 1;
                    } else if (keepRust) {
                        data[i] = (data[i] + 255) >> 1;
                        data[i+1] = data[i+1] >> 1;
                        data[i+2] = data[i+2] >> 1;
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

// UI & Camera Application Logicx
document.addEventListener('DOMContentLoaded', function() {
    const singleVideo = document.getElementById('single-video');
    const canvasSingle = document.getElementById('canvas-single');
    
    const toggleCameraButton = document.getElementById('toggle-camera');
    const switchCameraButton = document.getElementById('switch-camera');
    const toggleViewButton = document.getElementById('toggle-view');
    const toggleConfigButton = document.getElementById('toggle-config');
    
    const effectSelect = document.getElementById('effect-select');
    const configPanel = document.getElementById('config-panel');
    const crackControls = document.getElementById('crack-controls');
    const rustControls = document.getElementById('rust-controls');
    const crackPresets = document.getElementById('crack-presets');
    const rustPresets = document.getElementById('rust-presets');
    const controlsPanel = document.getElementById('controls-panel');
    const statusDiv = document.getElementById('status');
    const cameraDisplay = document.getElementById('camera-display');
    const effectDisplay = document.getElementById('effect-display');

    const infoBtn = document.getElementById('info-btn');
    const infoPopup = document.getElementById('info-popup');

    const defaults = {
        crackThreshold: 100, crackThickness: 5, crackBandMedian: 45, crackBandRange: 5,
        rustHueMin: 0, rustHueMax: 15, rustSatMin: 30, rustSatMax: 100,
        rustValMin: 15, rustValMax: 70, rustPadding: 5, resQuality: 50
    };

    const crackPresetValues = {
        1: { crackThreshold: 100, crackThickness: 5, crackBandMedian: 25, crackBandRange: 10 },
        2: { crackThreshold: 100, crackThickness: 5, crackBandMedian: 45, crackBandRange: 5 },
        3: { crackThreshold: 100, crackThickness: 5, crackBandMedian: 65, crackBandRange: 5 }
    };
    const rustPresetValues = {
        'rust1': { rustHueMin: 0, rustHueMax: 15, rustSatMin: 30, rustSatMax: 100, rustValMin: 15, rustValMax: 70, rustPadding: 5 },
        'rust2': { rustHueMin: 0, rustHueMax: 45, rustSatMin: 62, rustSatMax: 83, rustValMin: 15, rustValMax: 100, rustPadding: 10 }
    };
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

    let infoTimeout = null;

    function showInfoPopup() {
        infoPopup.classList.remove('ui-hidden-element');
        
        if (infoTimeout) clearTimeout(infoTimeout);
        
        infoTimeout = setTimeout(() => {
            infoPopup.classList.add('ui-hidden-element');
        }, 5000);
    }
    
    function hideInfoPopup() {
        infoPopup.classList.add('ui-hidden-element');
        if (infoTimeout) clearTimeout(infoTimeout);
    }
    
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
        } catch(e) { console.error("Could not load settings:", e); }
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
        } catch(e) { console.error("Could not save settings:", e); }
    }

    async function startCamera() {
        try {
            statusDiv.textContent = 'Requesting camera access...';
            stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: usingBackCamera ? { exact: 'environment' } : 'user' },
                audio: false
            });
            setupVideoStream();
        } catch (error) {
            console.warn('Environment camera failed, trying generic...', error);
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                usingBackCamera = false;
                setupVideoStream();
            } catch (fallbackError) { statusDiv.textContent = `Error: ${fallbackError.message}`; }
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
        crackPresets.style.display = 'none';
        rustPresets.style.display = 'none';

        if (currentMode === 'crack' || currentMode === 'combined') {
            crackControls.classList.remove('ui-hidden-element');
            crackPresets.style.display = 'flex';
        }
        if (currentMode === 'rust' || currentMode === 'combined') {
            rustControls.classList.remove('ui-hidden-element');
            rustPresets.style.display = 'flex';
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
        if (stream) { stopCamera(); } else { await startCamera(); }
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

    // Toggle Config Panel
    toggleConfigButton.addEventListener('click', () => {
        configPanel.classList.toggle('ui-hidden-element');
        resetHideControlsTimer();
    });

    infoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (infoPopup.classList.contains('ui-hidden-element')) {
            showInfoPopup();
        } else {
            hideInfoPopup();
        }
    });
    
    // Close popup if clicking anywhere else
    document.body.addEventListener('click', (e) => {
        if (!infoPopup.contains(e.target) && e.target !== infoBtn) {
            hideInfoPopup();
        }
    });

    // Crack Preset Applicator
    document.querySelectorAll('#crack-presets .preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const p = crackPresetValues[e.target.dataset.preset];
            if (p) {
                sliders.crackThreshold.value = p.crackThreshold;
                sliders.crackThickness.value = p.crackThickness;
                sliders.crackBandMedian.value = p.crackBandMedian;
                sliders.crackBandRange.value = p.crackBandRange;
                updateParams();
            }
        });
    });

    // Rust Preset Applicator
    document.querySelectorAll('#rust-presets .preset-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const p = rustPresetValues[e.target.dataset.preset];
            if (p) {
                sliders.rustHueMin.value = p.rustHueMin;
                sliders.rustHueMax.value = p.rustHueMax;
                sliders.rustSatMin.value = p.rustSatMin;
                sliders.rustSatMax.value = p.rustSatMax;
                sliders.rustValMin.value = p.rustValMin;
                sliders.rustValMax.value = p.rustValMax;
                sliders.rustPadding.value = p.rustPadding;
                updateParams();
            }
        });
    });

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
    
    statusDiv.textContent = 'Initialising...';
        
    startCamera().then(() => {
        toggleCameraButton.textContent = 'Stop Camera';
    }).catch(err => {
        statusDiv.textContent = 'Click/Tap anywhere to start';
        console.log("Auto-start blocked by browser, awaiting user interaction.");
    });
});