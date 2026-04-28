Gemini
Create a md readme for this project that include settings and what they do viusally
Conversation with Gemini
Create a md readme for this project that include settings and what they do viusally

Your MD (Markdown) README for the Rust & Crack Inspection Tool is ready. It details the functionality of every UI slider and button based on the logic in your script.js and index.html.

Your README.md file is ready
MD icon
 README 
MD

Summary of Documentation:
Visual Settings: Explains how "Resolution Quality" impacts performance vs. detail.

Crack Detection Logic: Details how the Band Pass filters and Edge Thresholds isolate structural lines.

Rust Detection Logic: Explains the use of HSV (Hue, Saturation, Value) ranges to target specific oxidation colors while ignoring beige or green "noise".

View Modes: Clarifies the difference between the high-contrast Mask view and the augmented reality Highlight view (which uses Green for cracks and Red for rust).

Presets: Lists the quick-toggle configurations for different lighting and oxidation types.





Gemini is AI and can make mistakes.

# Rust & Crack Inspection Tool

A real-time, browser-based computer vision tool designed to detect and highlight structural issues like cracks and rust using a device's camera. This tool is built for field inspection scenarios, providing adjustable filters to isolate specific visual anomalies.

## Core Features
- **Real-Time Processing**: Analyzes live camera feeds with adjustable resolution quality to balance performance and detail.
- **Dual Detection Modes**: Specifically tuned algorithms for detecting cracks (edge-based) and rust (color-based).
- **Visualization Options**: Toggle between a 'Mask' view (black background with detections highlighted) and 'Highlight' view (original video with colored overlays).
- **Responsive UI**: Auto-hiding controls and mobile-friendly sliders for field use.

---

## Settings & Visual Impact

The tool is highly configurable via the **Config (⚙)** panel. Adjusting these settings changes how the computer vision algorithm "sees" the environment.

### 1. Global Settings
| Setting | Description | Visual Effect |
|:--- |:--- |:--- |
| **Resolution Quality** | Scales the internal processing canvas (10% - 100%). | Lowering this increases FPS (smoothness) but makes detection "blockier." Higher values provide finer detail for thin cracks. |

### 2. Crack Detection Settings
*Crack detection works by applying a Band Pass filter to grayscale values followed by edge detection.*

| Setting | Description | Visual Effect |
|:--- |:--- |:--- |
| **Edge Threshold** | Sensitivity of the edge detection. | **Higher**: Only very sharp, high-contrast lines are caught. **Lower**: More subtle textures and noise are detected as "cracks." |
| **Line Thickness** | The radius of dilation applied to detected edges. | **Higher**: Makes detected cracks appear thicker and easier to see from a distance. |
| **Band Pass Center** | Selects the "brightness" level to focus on. | Targets specific surfaces. For example, if cracks are darker than the wall, center this on the darker tones to isolate them. |
| **Band Pass Width** | The range of brightness around the center. | **Narrow**: Only catches items of a very specific shade. **Wide**: Catches a broader range of surface lighting. |

### 3. Rust Detection Settings
*Rust detection uses HSV (Hue, Saturation, Value) color filtering to isolate oxidation colors.*

| Setting | Description | Visual Effect |
|:--- |:--- |:--- |
| **Rust Hue (Min/Max)** | The color range (0°-360°). | Limits detection to specific colors. Typically set between 0° and 45° to catch oranges, reds, and browns. |
| **Saturation (Min/Max)** | How "vivid" the color must be. | Filters out gray/dull metal. **High Min**: Only catches very vibrant orange rust. **Low Min**: Catches duller, brownish oxidation. |
| **Brightness (Min/Max)** | How light or dark the color is. | Filters out shadows (low brightness) or glare/highlights (high brightness). |
| **Rust Padding** | Expansion of the detected rust area. | Smooths out "speckled" detections into solid blocks of color for better visibility. |

---

## Operation Modes
- **Combined Mode**: Runs both crack and rust detection simultaneously.
- **Crack Mode**: Focuses purely on edge detection and brightness filtering.
- **Rust Mode**: Focuses purely on color-based oxidation detection.
- **View Mask**: Shows detections on a pure black background (useful for high-contrast inspection).
- **View Highlight**: Overlays **Green** highlights for cracks and **Red** highlights for rust onto the original video feed.

## Presets
- **Crack P1-P3**: Quickly switches the Band Pass Center to look for cracks in different lighting conditions (Darker vs. Lighter surfaces).
- **Rust P1-P2**: Toggles between "Standard" rust colors and "Wide Hue" for catching a broader range of oxidation (including yellowish or deep brown tones).

---

## Technical Details
- **Tech Stack**: HTML5 Video API, Canvas API, Vanilla JavaScript.
- **Performance**: Processing is done per-pixel on the CPU. Using the "Resolution Quality" slider is recommended for older mobile devices.
- **Privacy**: All processing happens locally in the browser. No camera data is sent to a server.
README.md
Displaying README.md.

Auto generatated README with Google Gemini
