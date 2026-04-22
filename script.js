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

function dilateMask(mask, w, h, radius) {
    if (radius === 0) return mask;
    let temp = new Uint8Array(w * h);
    let out = new Uint8Array(w * h);

    // Horizontal pass
    for (let y = 0; y < h; y++) {
        let r = 0;
        for (let x = 0; x < w; x++) {
            let i = y * w + x;
            if (mask[i]) { r = radius; temp[i] = 1; }
            else if (r > 0) { temp[i] = 1; r--; }
        }
        r = 0;
        for (let x = w - 1; x >= 0; x--) {
            let i = y * w + x;
            if (mask[i]) { r = radius; temp[i] = 1; }
            else if (r > 0) { temp[i] = 1; r--; }
        }
    }

    // Vertical pass
    for (let x = 0; x < w; x++) {
        let r = 0;
        for (let y = 0; y < h; y++) {
            let i = y * w + x;
            if (temp[i]) { r = radius; out[i] = 1; }
            else if (r > 0) { out[i] = 1; r--; }
        }
        r = 0;
        for (let y = h - 1; y >= 0; y--) {
            let i = y * w + x;
            if (temp[i]) { r = radius; out[i] = 1; }
            else if (r > 0) { out[i] = 1; r--; }
        }
    }
    return out;
}

// Processing Core
const InspectionEffect = {
    apply: function(video, canvas, params, mode) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        
        // Processing resolution downscaled for performance in real-time
        const procWidth = 480; 
        if (video.videoWidth === 0) return;
        const procHeight = Math.floor((video.videoHeight / video.videoWidth) * procWidth);

        if (canvas.width !== procWidth) canvas.width = procWidth;
        if (canvas.height !== procHeight) canvas.height = procHeight;
        
        ctx.drawImage(video, 0, 0, procWidth, procHeight);
        const imgData = ctx.getImageData(0, 0, procWidth, procHeight);
        const data = imgData.data;
        const w = procWidth;
        const h = procHeight;

        let crackHits = new Uint8Array(w * h);
        let rustHits = new Uint8Array(w * h);
        
        let grayscaleData = null;

        // Band Pass Grayscale Generation (for Crack/Edge Detection)
        if (mode === 'crack' || mode === 'combined') {
            grayscaleData = new Float32Array(w * h);
            let bandMedianScaled = params.crackBandMedian * 2.55; // convert 0-100 to 0-255
            let halfWidth = (params.crackBandRange * 2.55) / 2;

            for (let i = 0; i < w * h; i++) {
                let r = data[i*4], g = data[i*4+1], b = data[i*4+2];
                let gray = 0.299 * r + 0.587 * g + 0.114 * b;
                
                // Apply Band Pass Filter
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
                        
                        // NEW: Explicitly ignore beige colors
                        // Beige is usually in the 15-45 hue range, with lower saturation (< 50%) and high brightness (> 65%)
                        let isBeige = (hue >= 10 && hue <= 50 && sat < 50 && val > 40);

                        // Only count as a hit if the hue matches AND it is not beige
                        if (hueMatch && !isBeige) {
                            rustHits[idx] = 1;
                        }
                    }
                }

                // Crack/Edge Detection (Using pre-filtered grayscale data)
                if (mode === 'crack' || mode === 'combined') {
                    let lum = grayscaleData[idx];
                    let lumR = grayscaleData[idx + 1];
                    let lumB = grayscaleData[idx + w];

                    // Simple gradient magnitude
                    let diff = Math.abs(lum - lumR) + Math.abs(lum - lumB);
                    if (diff > params.crackThreshold) {
                        crackHits[idx] = 1;
                    }
                }
            }
        }

        // Dilation Pass (Line Thickness)
        let crackMask = null;
        let rustMask = null;
        if (mode === 'crack' || mode === 'combined') {
            crackMask = dilateMask(crackHits, w, h, params.crackThickness);
        }
        if (mode === 'rust' || mode === 'combined') {
            rustMask = dilateMask(rustHits, w, h, params.rustPadding);
        }

        // Apply Mask to Image Data
        for (let idx = 0; idx < w * h; idx++) {
            let keep = false;
            if (mode === 'crack' && crackMask && crackMask[idx]) keep = true;
            if (mode === 'rust' && rustMask && rustMask[idx]) keep = true;
            if (mode === 'combined' && ((crackMask && crackMask[idx]) || (rustMask && rustMask[idx]))) keep = true;

            if (!keep) {
                let i = idx * 4;
                data[i] = 0;
                data[i+1] = 0;
                data[i+2] = 0;
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
    
    const effectSelect = document.getElementById('effect-select');
    const crackControls = document.getElementById('crack-controls');
    const rustControls = document.getElementById('rust-controls');
    const controlsPanel = document.getElementById('controls-panel');
    const statusDiv = document.getElementById('status');
    const cameraDisplay = document.getElementById('camera-display');
    const effectDisplay = document.getElementById('effect-display');

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
        rustPadding: document.getElementById('rustPadding')
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
        rustPadding: document.getElementById('valRustPad')
    };

    let stream = null;
    let hideControlsTimeout = null;
    let usingBackCamera = true;
    let currentMode = 'combined';
    let animationFrameId = null;
    const HIDE_DELAY = 3000;

    // Start / Stop Camera
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
        toggleCameraButton.textContent = 'Stop Camera';
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

    // Effect Render Loop
    function startEffectRendering() {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        
        function renderEffects() {
            if (stream) {
                const params = {};
                for (let key in sliders) {
                    params[key] = parseInt(sliders[key].value, 10);
                }

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
    }

    function updateParams() {
        for(let key in sliders) {
            if(sliderLabels[key]) {
                sliderLabels[key].textContent = sliders[key].value;
            }
        }
        resetHideControlsTimer();
    }

    function updateCameraDisplay() { 
        cameraDisplay.textContent = `Camera: ${usingBackCamera ? 'Back' : 'Front'}`; 
        switchCameraButton.textContent = `Switch to ${usingBackCamera ? 'Front' : 'Back'} Camera`; 
    }

    // Auto-hide UI Logic
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
    // Attach Listeners
    toggleCameraButton.addEventListener('click', toggleCamera);
    switchCameraButton.addEventListener('click', switchCamera);
    effectSelect.addEventListener('change', changeMode);
    
    for(let key in sliders) {
        sliders[key].addEventListener('input', updateParams);
    }

    document.body.addEventListener('click', toggleControls);

    // Initial Setup
    updateParams();
});