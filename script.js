// ==============================================
// 1. GLOBAL SETUP & CONTEXT
// ==============================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// NODES: Create the audio graph structure
const masterGain = audioCtx.createGain();
const analyser = audioCtx.createAnalyser();

// CONFIG: Connect nodes (Gain -> Analyser -> Speakers)
masterGain.connect(analyser);
analyser.connect(audioCtx.destination);

// ANALYSER CONFIG (Visualizer Quality)
analyser.fftSize = 256; // Controls bar count (higher = more bars)
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);

// STATE VARIABLES
let masterVolume = 0.5;
// initial master gain value (ensure masterGain gain reflects masterVolume)
masterGain.gain.value = masterVolume;
let waveform = "triangle";
// Octave range: set the playable min/max octave here. Typical piano -> 0..8, but for UI/UX we limit here
let currentOctave = 4;
const MIN_OCTAVE = 1; // minimum C1
const MAX_OCTAVE = 7; // maximum C7
let isRecording = false;
let mediaRecorder;
let audioChunks = [];
// orientation lock state for mobile; we'll attempt to lock once on first user interaction
let orientationLockTried = false;
let pianoEnabled = true; // piano ON by default for best UX
// Microphone recording support
let micEnabled = false;
let micStream = null;
let micSource = null;
// Recording UI state
let recordStartTimestamp = null;
let recordTimerInterval = null;
// Speed control (affects ADSR envelope timing)
let speedMultiplier = 1.0;

// DOM ELEMENTS
const volumeSlider = document.getElementById("volume-slider");
const canvas = document.getElementById("visualizer");
const canvasCtx = canvas.getContext("2d");
const recordBtn = document.getElementById("record-btn");
const stopBtn = document.getElementById("stop-btn");
const pressedKeyLetterEl = document.getElementById("pressed-key-letter");
const pressedKeyNoteEl = document.getElementById("pressed-key-note");
const recordStatusEl = document.getElementById("record-status");
const recordTimerEl = document.getElementById("record-timer");
const vizOverlay = document.getElementById("viz-overlay");
const rotateOverlay = document.getElementById("rotate-overlay");
// Note: Rotate overlay is now mandatory and controlled entirely by CSS media queries
// It cannot be dismissed by clicking - user must rotate their device

// Build a key map for fast keydown lookup (handles special characters like ; ' / )
const keyElements = Array.from(document.querySelectorAll(".key"));
const keyMap = {};
keyElements.forEach((el) => {
  const k = el.getAttribute("data-key");
  if (k) keyMap[k.toLowerCase()] = el;
});

// keyboard scaling for responsive fitting
function updateKeyboardScaling() {
  const wrapper = document.querySelector(".piano-wrapper");
  const list = document.querySelector(".piano-keys-list");
  if (!wrapper || !list) return;

  const whiteKeys = Array.from(document.querySelectorAll(".key.white"));
  if (!whiteKeys.length) return;

  // Mobile: do NOT scale the keyboard. Scaling made keys tiny and created
  // trailing empty space in the wrapper; instead let CSS sizing handle it.
  const isMobile = window.matchMedia("(max-width: 900px)").matches;
  if (isMobile) {
    list.style.transform = "";
    list.style.width = "max-content";
    const whiteKeyHeight = parseFloat(getComputedStyle(whiteKeys[0]).height);
    // Ensure the wrapper is tall enough so labels are not clipped.
    wrapper.style.minHeight = Math.max(whiteKeyHeight + 18, 140) + "px";
    wrapper.style.height = "";
    resizeVisualizerCanvas();
    return;
  }

  // Desktop/tablet: scale only by width using the real rendered width.
  // This avoids hard-coded padding guesses and avoids height-based scaling.
  list.style.transform = "";
  list.style.width = "max-content";

  const wrapperStyles = getComputedStyle(wrapper);
  const paddingLeft = parseFloat(wrapperStyles.paddingLeft) || 0;
  const paddingRight = parseFloat(wrapperStyles.paddingRight) || 0;
  const containerWidth = Math.max(
    0,
    wrapper.clientWidth - paddingLeft - paddingRight
  );

  const requiredWidth = list.scrollWidth;
  const scaleWidth = requiredWidth > 0 ? containerWidth / requiredWidth : 1;
  const scale = Math.min(1, scaleWidth);

  // Lock base width so scaling results in an exact fit (no end-gap)
  list.style.width = requiredWidth + "px";
  list.style.transform = `scale(${scale})`;

  resizeVisualizerCanvas();
}

// Ensure the canvas pixel buffer matches CSS size for maximum visualizer height
function resizeVisualizerCanvas() {
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.floor(canvas.clientWidth * ratio);
  const height = Math.floor(canvas.clientHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    // Reset any transforms
    canvasCtx.setTransform(1, 0, 0, 1, 0, 0);
    canvasCtx.scale(ratio, ratio);
  }
}

// Play a brief 'power on' jingle sound
function playPowerOnSound() {
  try {
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) {}
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(440, now); // A4
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.5, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.35);
}

// Viz overlay control
let vizOverlayTimeout = null;
function showVizOverlay(text) {
  if (!vizOverlay) return;
  const defaultText = `Welcome to\nKING SON♪C Pro`;
  const t = text || defaultText;
  // place text respecting newlines
  const lines = t.split("\n");
  vizOverlay.innerHTML = ""; // clear
  lines.forEach((line) => {
    const span = document.createElement("span");
    span.textContent = line;
    vizOverlay.appendChild(span);
  });
  vizOverlay.classList.add("visible");
  vizOverlay.setAttribute("aria-hidden", "false");
  if (vizOverlayTimeout) clearTimeout(vizOverlayTimeout);
  vizOverlayTimeout = setTimeout(() => {
    hideVizOverlay();
  }, 3000);
}
function hideVizOverlay() {
  if (!vizOverlay) return;
  vizOverlay.classList.remove("visible");
  vizOverlay.setAttribute("aria-hidden", "true");
  if (vizOverlayTimeout) {
    clearTimeout(vizOverlayTimeout);
    vizOverlayTimeout = null;
  }
}

// call on resize and after DOM ready
window.addEventListener("resize", updateKeyboardScaling);
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(updateKeyboardScaling, 50);
  setTimeout(() => {
    try {
      updateOctaveDisplay();
    } catch (e) {
      /* ignore in case DOM not fully parsed or function not available yet */
    }
  }, 50);
});
// also update scaling after fonts load
window.addEventListener("load", updateKeyboardScaling);
window.addEventListener("orientationchange", updateKeyboardScaling);
// Run once immediately since script is at the bottom of the page
updateKeyboardScaling();

// Update power UI
const powerToggle = document.getElementById("power-toggle");
const powerIndicator = document.getElementById("power-indicator");
function setPowerOn(on) {
  pianoEnabled = !!on;
  if (powerToggle) {
    powerToggle.classList.toggle("on", pianoEnabled);
    powerToggle.classList.toggle("off", !pianoEnabled);
    powerToggle.textContent = pianoEnabled ? "On" : "Off";
    powerToggle.setAttribute("aria-pressed", pianoEnabled ? "true" : "false");
  }
  if (powerIndicator) {
    powerIndicator.classList.toggle("on", pianoEnabled);
    powerIndicator.classList.toggle("off", !pianoEnabled);
  }
  // tiny visual hint: show keys as disabled when off
  document
    .querySelectorAll(".key")
    .forEach((k) => k.classList.toggle("disabled", !pianoEnabled));
  // toggle UI controls disabled state so no functionality works when power is off
  if (volumeSlider) volumeSlider.disabled = !pianoEnabled;
  document.querySelectorAll(".tone-btn").forEach((b) => {
    b.disabled = !pianoEnabled;
    b.classList.toggle("disabled", !pianoEnabled);
  });
  const _octaveUpBtn = document.getElementById("octave-up");
  const _octaveDownBtn = document.getElementById("octave-down");
  if (_octaveUpBtn) _octaveUpBtn.disabled = !pianoEnabled;
  if (_octaveDownBtn) _octaveDownBtn.disabled = !pianoEnabled;
  if (recordBtn) recordBtn.disabled = !pianoEnabled;
  if (stopBtn && !isRecording) stopBtn.disabled = true; // disable stop when not recording
  if (stopBtn && isRecording) stopBtn.disabled = !pianoEnabled; // allow stop only if powered on while recording
  // if powering off while recording, stop the recorder immediately
  if (
    !pianoEnabled &&
    isRecording &&
    mediaRecorder &&
    mediaRecorder.state === "recording"
  ) {
    try {
      mediaRecorder.stop();
    } catch (e) {
      console.warn("Error stopping media recorder during power off", e);
    }
    isRecording = false;
  }
  // dim the piano wrapper to signal off state more visibly
  const pianoWrapper = document.querySelector(".piano-wrapper");
  if (pianoWrapper) pianoWrapper.classList.toggle("disabled", !pianoEnabled);
  // When powering on, play a short tone and show the welcome overlay
  if (pianoEnabled) {
    try {
      // resume audio context (user gesture)
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch (e) {}
    playPowerOnSound();
    showVizOverlay();
  } else {
    hideVizOverlay();
  }
}
if (powerToggle) {
  powerToggle.addEventListener("click", () => setPowerOn(!pianoEnabled));
}
// default state is ON for immediate playability
setPowerOn(true);

// ==============================================
// 2. RECORDER ENGINE (Enhanced with Mic & WAV support)
// ==============================================
// Create a specific destination node just for recording
const dest = audioCtx.createMediaStreamDestination();
analyser.connect(dest); // Connect sound to recorder destination

// Microphone toggle functionality
const micToggle = document.getElementById("mic-toggle");
const micIndicator = document.getElementById("mic-indicator");

async function enableMicrophone() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micSource = audioCtx.createMediaStreamSource(micStream);
    micSource.connect(dest); // Connect mic to recording destination
    micEnabled = true;
    if (micToggle) {
      micToggle.classList.add("on");
      micToggle.classList.remove("off");
      micToggle.textContent = "Mic On";
    }
    if (micIndicator) {
      micIndicator.classList.add("on");
      micIndicator.classList.remove("off");
    }
    showVizOverlay("🎤 Mic Enabled!\nSing along!");
    console.log("🎤 Microphone enabled");
  } catch (err) {
    console.error("Microphone access denied:", err);
    showVizOverlay("🎤 Mic Access Denied\nCheck permissions");
  }
}

function disableMicrophone() {
  if (micStream) {
    micStream.getTracks().forEach((track) => track.stop());
    micStream = null;
  }
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  micEnabled = false;
  if (micToggle) {
    micToggle.classList.remove("on");
    micToggle.classList.add("off");
    micToggle.textContent = "Mic Off";
  }
  if (micIndicator) {
    micIndicator.classList.remove("on");
    micIndicator.classList.add("off");
  }
}

if (micToggle) {
  micToggle.addEventListener("click", () => {
    if (!pianoEnabled) return;
    if (micEnabled) {
      disableMicrophone();
    } else {
      enableMicrophone();
    }
  });
}

// WAV Encoder Utility - Creates universally compatible WAV files
function encodeWAV(samples, sampleRate, numChannels) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");

  // fmt chunk
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
  view.setUint16(32, numChannels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample

  // data chunk
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  // Write samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// Convert WebM blob to WAV for universal compatibility
async function convertToWAV(blob) {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;

    // Mix down to mono or keep stereo
    let samples;
    if (numChannels === 1) {
      samples = audioBuffer.getChannelData(0);
    } else {
      // Mix stereo to mono
      const left = audioBuffer.getChannelData(0);
      const right = audioBuffer.getChannelData(1);
      samples = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        samples[i] = (left[i] + right[i]) / 2;
      }
    }

    return encodeWAV(samples, sampleRate, 1);
  } catch (err) {
    console.error("WAV conversion failed, using original format:", err);
    return blob; // Return original if conversion fails
  }
}

// Check if MediaRecorder is supported
if (window.MediaRecorder) {
  // NOTE: The page may not include record/stop buttons — guard these refs
  mediaRecorder = new MediaRecorder(dest.stream);

  mediaRecorder.ondataavailable = (e) => {
    audioChunks.push(e.data);
  };

  mediaRecorder.onstop = async () => {
    // Create a Blob from the audio chunks
    const webmBlob = new Blob(audioChunks, { type: "audio/webm" });
    audioChunks = []; // Reset for next recording

    // Show processing status
    if (recordStatusEl) {
      recordStatusEl.innerText = "Processing audio...";
    }

    // Convert to WAV for universal compatibility
    const wavBlob = await convertToWAV(webmBlob);

    // Create a download link dynamically
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    a.download = `KingSonicPro_Session_${timestamp}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Cleanup
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    // Ensure final timer display and reset state
    if (recordTimerEl && recordStartTimestamp) {
      recordTimerEl.textContent = formatTime(Date.now() - recordStartTimestamp);
    }
    if (recordStatusEl) {
      recordStatusEl.innerText = "Saved! Ready for download";
      recordStatusEl.classList.remove("recording");
    }
    recordStartTimestamp = null;
  };
} else {
  if (recordBtn) {
    recordBtn.disabled = true;
    recordBtn.innerText = "Not Supported";
  }
}

// ==============================================
// 3. VISUALIZER ENGINE (New Feature)
// ==============================================
function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);

  // Get data from audio source
  analyser.getByteFrequencyData(dataArray);

  // Clear canvas using CSS pixel size (we scale context for high-dpi)
  const drawWidth = canvas.clientWidth;
  const drawHeight = canvas.clientHeight;
  canvasCtx.fillStyle = "#000";
  canvasCtx.fillRect(0, 0, drawWidth, drawHeight);

  // Calculate bar width
  const barWidth = (drawWidth / bufferLength) * 2.5;
  let barHeight;
  let x = 0;

  // Loop through data and draw bars
  for (let i = 0; i < bufferLength; i++) {
    barHeight = dataArray[i] / 2; // Scale height

    // Dynamic coloring based on theme variable would be cool,
    // but for performance we use the computed style color
    const computedColor = getComputedStyle(document.body)
      .getPropertyValue("--primary-color")
      .trim();

    canvasCtx.fillStyle = computedColor;

    // Draw Bar
    canvasCtx.fillRect(x, drawHeight - barHeight, barWidth, barHeight);

    x += barWidth + 1;
  }
}

// Start the visual loop immediately
drawVisualizer();

// Utility: format ms -> mm:ss
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ==============================================
// 4. SOUND ENGINE (Core) - ADSR Envelope for Realistic Sound
// ==============================================

// Active notes tracker - maps note identifier to its audio nodes
const activeNotes = new Map();

// ADSR Envelope settings per waveform type
const ENVELOPE_SETTINGS = {
  triangle: {
    // Piano-like
    attack: 0.005, // Very fast attack
    decay: 0.1, // Quick decay to sustain
    sustainLevel: 0.7, // Sustain at 70% of peak
    release: 2.0, // 2 second release after key up
  },
  sawtooth: {
    // Synth
    attack: 0.02,
    decay: 0.15,
    sustainLevel: 0.6,
    release: 1.5,
  },
  square: {
    // Square wave
    attack: 0.01,
    decay: 0.1,
    sustainLevel: 0.5,
    release: 1.2,
  },
  sine: {
    // Sine wave - smooth
    attack: 0.03,
    decay: 0.2,
    sustainLevel: 0.8,
    release: 2.5,
  },
};

// Start playing a note (called on key down)
function startNote(noteName, octaveShift = 0) {
  // Ensure Context is running (browsers pause it by default)
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  // Create unique identifier for this note
  const noteId = `${noteName}_${currentOctave + octaveShift}`;

  // If note is already playing, stop it first (prevents overlapping)
  if (activeNotes.has(noteId)) {
    stopNote(noteName, octaveShift, true); // Quick stop for re-trigger
  }

  const oscillator = audioCtx.createOscillator();
  const noteGain = audioCtx.createGain();
  let oscillator2 = null;

  // Connect: Oscillator -> Note Gain -> Master Gain
  oscillator.connect(noteGain);
  noteGain.connect(masterGain);

  oscillator.type = waveform;

  // Frequency Calculation
  let targetOctave = currentOctave + octaveShift;
  let fullNote = noteName + targetOctave;
  const frequency = getFrequency(fullNote);

  if (!frequency) {
    console.warn(`No frequency found for note ${fullNote}.`);
    return;
  }

  oscillator.frequency.value = frequency;
  const now = audioCtx.currentTime;
  const env = ENVELOPE_SETTINGS[waveform] || ENVELOPE_SETTINGS.triangle;

  // Apply speed multiplier to ADSR timing (higher speed = faster envelope)
  const attackTime = env.attack / speedMultiplier;
  const decayTime = env.decay / speedMultiplier;

  // ADSR Envelope - Attack & Decay phase
  noteGain.gain.setValueAtTime(0, now);
  noteGain.gain.linearRampToValueAtTime(masterVolume, now + attackTime);
  noteGain.gain.linearRampToValueAtTime(
    masterVolume * env.sustainLevel,
    now + attackTime + decayTime
  );

  oscillator.start(now);

  // Add second oscillator for richer synth/square tones
  if (waveform === "sawtooth" || waveform === "square") {
    oscillator2 = audioCtx.createOscillator();
    oscillator2.type = waveform;
    oscillator2.frequency.value = frequency;
    try {
      oscillator2.detune.value = 8;
    } catch (e) {
      /* ignore */
    }
    oscillator2.connect(noteGain);
    oscillator2.start(now);
  }

  // Store active note data for release on key up
  activeNotes.set(noteId, {
    oscillator,
    oscillator2,
    noteGain,
    startTime: now,
    envelope: env,
  });
}

// Stop playing a note (called on key up)
function stopNote(noteName, octaveShift = 0, quick = false) {
  const noteId = `${noteName}_${currentOctave + octaveShift}`;
  const noteData = activeNotes.get(noteId);

  if (!noteData) return;

  const { oscillator, oscillator2, noteGain, envelope } = noteData;
  const now = audioCtx.currentTime;

  // Release phase - use quick release if re-triggering, else full release
  // Apply speed multiplier to release timing
  const releaseTime = quick ? 0.05 : envelope.release / speedMultiplier;

  // Cancel any scheduled values and start release
  noteGain.gain.cancelScheduledValues(now);
  noteGain.gain.setValueAtTime(noteGain.gain.value, now);
  noteGain.gain.exponentialRampToValueAtTime(0.001, now + releaseTime);

  // Schedule oscillator stop after release
  oscillator.stop(now + releaseTime + 0.1);
  if (oscillator2) {
    oscillator2.stop(now + releaseTime + 0.1);
  }

  // Remove from active notes
  activeNotes.delete(noteId);
}

// Legacy function for compatibility - plays a quick note
function playNote(noteName, octaveShift = 0) {
  startNote(noteName, octaveShift);
  // Auto-release after a short delay if not using hold mechanism
  setTimeout(() => {
    stopNote(noteName, octaveShift);
  }, 150);
}

// Orientation lock helper: Try to lock to landscape on mobile devices
// Note: The rotate overlay visibility is now controlled by CSS media queries
function tryLockLandscape() {
  if (orientationLockTried) return;
  orientationLockTried = true;

  // Consider this a 'mobile' device if user agent or narrow viewport
  const isMobile =
    /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent) ||
    window.innerWidth <= 900;
  if (!isMobile) return;

  // Try to use the Screen Orientation API to lock to landscape
  if (screen.orientation && typeof screen.orientation.lock === "function") {
    screen.orientation
      .lock("landscape")
      .then(() => {
        console.log("📱 Orientation locked to landscape");
        document.body.classList.add("landscape-locked");
      })
      .catch((err) => {
        // Lock failed - CSS will show the rotate overlay automatically
        console.warn("Orientation lock not available:", err.message);
      });
  }
}

// compute frequency for any standard note-name (like 'C4', 'C#5')
const getFrequency = (note) => {
  const match = /^([A-G]#?)(-?\d+)$/.exec(note);
  if (!match) return undefined;
  const pitch = match[1].toUpperCase();
  const octave = parseInt(match[2], 10);
  const semitoneMap = {
    C: 0,
    "C#": 1,
    D: 2,
    "D#": 3,
    E: 4,
    F: 5,
    "F#": 6,
    G: 7,
    "G#": 8,
    A: 9,
    "A#": 10,
    B: 11,
  };
  const noteValue = semitoneMap[pitch];
  if (typeof noteValue === "undefined") return undefined;

  // semitone number relative to C0
  const semitoneNumber = octave * 12 + noteValue;
  const a4Number = 4 * 12 + semitoneMap["A"];
  const semitoneDiff = semitoneNumber - a4Number;
  const frequency = 440 * Math.pow(2, semitoneDiff / 12);
  return parseFloat(frequency.toFixed(2));
};

// ==============================================
// 5. INTERACTION & UI HANDLERS
// ==============================================

// Volume
volumeSlider.addEventListener("input", (e) => {
  if (!pianoEnabled) return;
  masterVolume = parseFloat(e.target.value);
  // Keep the master gain in sync, and keep a small non-zero value for smoothness
  if (masterGain && typeof masterGain.gain !== "undefined") {
    masterGain.gain.setValueAtTime(masterVolume, audioCtx.currentTime);
  }
});

// Speed Control - affects ADSR envelope timing
const speedSlider = document.getElementById("speed-slider");
const speedDisplay = document.getElementById("speed-display");

if (speedSlider) {
  speedSlider.addEventListener("input", (e) => {
    speedMultiplier = parseFloat(e.target.value);
    if (speedDisplay) {
      speedDisplay.textContent = speedMultiplier.toFixed(1) + "x";
    }
    // Update slider background to show filled portion
    const percent = ((speedMultiplier - 0.5) / 1.5) * 100;
    speedSlider.style.background = `linear-gradient(to right, var(--primary-color) ${percent}%, #333 ${percent}%)`;
  });
}

// Tone Switching
document.querySelectorAll(".tone-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!pianoEnabled) return;
    document
      .querySelectorAll(".tone-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    waveform = btn.getAttribute("data-type");
  });
});

// Octave Switching
const octaveUpBtn = document.getElementById("octave-up");
const octaveDownBtn = document.getElementById("octave-down");
if (octaveUpBtn) {
  octaveUpBtn.addEventListener("click", () => {
    if (!pianoEnabled) return;
    if (currentOctave < MAX_OCTAVE) {
      currentOctave++;
      updateOctaveDisplay();
    }
  });
}
if (octaveDownBtn) {
  octaveDownBtn.addEventListener("click", () => {
    if (!pianoEnabled) return;
    if (currentOctave > MIN_OCTAVE) {
      currentOctave--;
      updateOctaveDisplay();
    }
  });
}
function updateOctaveDisplay() {
  document.getElementById("octave-display").innerText = `C${currentOctave}`;
  // update button enabled/disabled states based on min/max octave
  if (octaveUpBtn) octaveUpBtn.disabled = currentOctave >= MAX_OCTAVE;
  if (octaveDownBtn) octaveDownBtn.disabled = currentOctave <= MIN_OCTAVE;
}

// Theme Switching (Exposed to Window for HTML onclick)
window.setTheme = function (themeName) {
  document.body.setAttribute("data-theme", themeName);
  document.querySelectorAll(".dot").forEach((dot) => {
    dot.classList.remove("active");
    if (dot.classList.contains(themeName)) dot.classList.add("active");
  });
};

// ==============================================
// WEB SHARE API - Native Sharing
// ==============================================
(function initShareButton() {
  const shareBtn = document.getElementById("share-btn");
  if (!shareBtn) return;

  const shareData = {
    title: "KING SON♪C Pro",
    text: "Premium Performance • Built with Passion • Built For You! 🎹 Check out this amazing web piano!",
    url: window.location.href,
  };

  shareBtn.addEventListener("click", async () => {
    // Check if Web Share API is available
    if (
      navigator.share &&
      navigator.canShare &&
      navigator.canShare(shareData)
    ) {
      try {
        await navigator.share(shareData);
        console.log("✅ Shared successfully!");
        showVizOverlay("Shared!\nThanks for spreading the music 🎶");
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Share failed:", err);
          fallbackShare();
        }
      }
    } else {
      // Fallback for browsers without Web Share API
      fallbackShare();
    }
  });

  function fallbackShare() {
    // Copy link to clipboard
    const url = window.location.href;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => {
          showVizOverlay("Link Copied!\nShare it anywhere 📋");
        })
        .catch(() => {
          showShareModal();
        });
    } else {
      showShareModal();
    }
  }

  function showShareModal() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(
      "Check out KING SON♪C Pro - Premium Performance • Built with Passion • Built For You! 🎹"
    );

    // Create a simple share modal
    const modal = document.createElement("div");
    modal.className = "share-modal";
    modal.innerHTML = `
      <div class="share-modal-backdrop"></div>
      <div class="share-modal-content">
        <h3>Share KING SON♪C Pro</h3>
        <div class="share-options">
          <a href="https://wa.me/?text=${text}%20${url}" target="_blank" rel="noopener" class="share-option whatsapp">
            <span>📱</span> WhatsApp
          </a>
          <a href="https://twitter.com/intent/tweet?text=${text}&url=${url}" target="_blank" rel="noopener" class="share-option twitter">
            <span>🐦</span> Twitter/X
          </a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${url}" target="_blank" rel="noopener" class="share-option facebook">
            <span>📘</span> Facebook
          </a>
          <a href="https://www.linkedin.com/shareArticle?mini=true&url=${url}&title=${text}" target="_blank" rel="noopener" class="share-option linkedin">
            <span>💼</span> LinkedIn
          </a>
        </div>
        <button class="share-modal-close">Close</button>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    modal
      .querySelector(".share-modal-backdrop")
      .addEventListener("click", () => modal.remove());
    modal
      .querySelector(".share-modal-close")
      .addEventListener("click", () => modal.remove());

    // Auto-remove on link click
    modal.querySelectorAll(".share-option").forEach((link) => {
      link.addEventListener("click", () =>
        setTimeout(() => modal.remove(), 500)
      );
    });
  }
})();

// ==============================================
// EXIT INTENT SHARE PROMPT - Smart Exit Detection
// ==============================================
(function initExitSharePrompt() {
  const EXIT_STORAGE_KEY = "kingsonicpro_exit_share_shown";
  // Make this prompt more likely to appear on real "exit" attempts.
  // The previous thresholds were too strict for many mobile sessions.
  const MIN_SESSION_TIME = 15000; // 15 seconds minimum before showing
  const MIN_NOTES_PLAYED = 1; // At least one note played

  // Session tracking
  let sessionStartTime = Date.now();
  let notesPlayedCount = 0;
  let exitPromptShown = false;

  // DOM Elements
  const exitPrompt = document.getElementById("exit-share-prompt");
  const exitBackdrop = exitPrompt?.querySelector(".exit-share-backdrop");
  const exitClose = exitPrompt?.querySelector(".exit-share-close");
  const exitDismiss = document.getElementById("exit-share-dismiss");
  const exitShareNative = document.getElementById("exit-share-native");
  const statNotesPlayed = document.getElementById("stat-notes-played");
  const statSessionTime = document.getElementById("stat-session-time");

  // Social links
  const whatsappLink = document.getElementById("exit-share-whatsapp");
  const twitterLink = document.getElementById("exit-share-twitter");
  const facebookLink = document.getElementById("exit-share-facebook");
  const copyLink = document.getElementById("exit-share-copy");

  if (!exitPrompt) return;

  // Track notes played (hook into existing triggerKey function)
  const originalTriggerKey = window.triggerKey || null;
  window.trackNotePlayed = function () {
    notesPlayedCount++;
  };

  // Hook into key playing - we'll call this from the existing triggerKey
  const pianoKeys = document.querySelectorAll(".key");
  pianoKeys.forEach((key) => {
    key.addEventListener("mousedown", () => notesPlayedCount++);
  });
  document.addEventListener("keydown", (e) => {
    if (!e.repeat && keyMap && keyMap[e.key?.toLowerCase()]) {
      notesPlayedCount++;
    }
  });

  // Format session time
  function formatSessionTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  // Check if prompt was shown recently (within 24 hours)
  function wasShownRecently() {
    const lastShown = localStorage.getItem(EXIT_STORAGE_KEY);
    if (!lastShown) return false;
    const hoursSince =
      (Date.now() - parseInt(lastShown, 10)) / (1000 * 60 * 60);
    return hoursSince < 24;
  }

  // Check if user is engaged enough to warrant the prompt
  function isUserEngaged() {
    const sessionDuration = Date.now() - sessionStartTime;
    return (
      sessionDuration >= MIN_SESSION_TIME &&
      notesPlayedCount >= MIN_NOTES_PLAYED
    );
  }

  // Update stats display
  function updateStats() {
    if (statNotesPlayed) statNotesPlayed.textContent = notesPlayedCount;
    if (statSessionTime)
      statSessionTime.textContent = formatSessionTime(
        Date.now() - sessionStartTime
      );
  }

  // Set up social share URLs
  function setupSocialLinks() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(
      "🎹 Just played amazing music on KING SON♪C Pro! Premium Performance • Built with Passion • Built For You!"
    );

    if (whatsappLink)
      whatsappLink.href = `https://wa.me/?text=${text}%20${url}`;
    if (twitterLink)
      twitterLink.href = `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
    if (facebookLink)
      facebookLink.href = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
  }

  // Show the exit prompt
  function showExitPrompt() {
    if (exitPromptShown || wasShownRecently() || !isUserEngaged()) return;

    exitPromptShown = true;
    updateStats();
    setupSocialLinks();

    exitPrompt.classList.add("visible");
    exitPrompt.setAttribute("aria-hidden", "false");

    // Mark as shown
    localStorage.setItem(EXIT_STORAGE_KEY, Date.now().toString());
  }

  // Hide the exit prompt
  function hideExitPrompt() {
    exitPrompt.classList.remove("visible");
    exitPrompt.setAttribute("aria-hidden", "true");
  }

  // Native share handler
  async function handleNativeShare() {
    const shareData = {
      title: "KING SON♪C Pro",
      text: `🎹 I just played ${notesPlayedCount} notes on KING SON♪C Pro! Try this amazing Mobile Piano - Premium Performance • Built with Passion • Built For You!`,
      url: window.location.href,
    };

    if (
      navigator.share &&
      navigator.canShare &&
      navigator.canShare(shareData)
    ) {
      try {
        await navigator.share(shareData);
        hideExitPrompt();
        showVizOverlay("Thanks for sharing! 🎶");
      } catch (err) {
        if (err.name !== "AbortError") {
          console.error("Share failed:", err);
        }
      }
    } else {
      // Fallback - copy to clipboard
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(window.location.href);
        hideExitPrompt();
        showVizOverlay("Link copied! 📋");
      }
    }
  }

  // Copy link handler
  async function handleCopyLink(e) {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(window.location.href);
      hideExitPrompt();
      showVizOverlay("Link copied! 📋");
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }

  // Event Listeners for closing
  if (exitBackdrop) exitBackdrop.addEventListener("click", hideExitPrompt);
  if (exitClose) exitClose.addEventListener("click", hideExitPrompt);
  if (exitDismiss) exitDismiss.addEventListener("click", hideExitPrompt);
  if (exitShareNative)
    exitShareNative.addEventListener("click", handleNativeShare);
  if (copyLink) copyLink.addEventListener("click", handleCopyLink);

  // Close social links after clicking
  [whatsappLink, twitterLink, facebookLink].forEach((link) => {
    if (link) {
      link.addEventListener("click", () => {
        setTimeout(hideExitPrompt, 500);
      });
    }
  });

  // EXIT INTENT DETECTION

  // 1. Mouse leaving the viewport (desktop)
  document.addEventListener("mouseout", (e) => {
    if (e.clientY <= 0 && !exitPromptShown) {
      showExitPrompt();
    }
  });

  // 2. Page visibility change (tab switching, mobile app switching)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && !exitPromptShown) {
      // Don't show immediately on visibility change, but mark for next return
      if (isUserEngaged() && !wasShownRecently()) {
        // Show when they come back
        const showOnReturn = () => {
          if (document.visibilityState === "visible") {
            setTimeout(showExitPrompt, 500);
            document.removeEventListener("visibilitychange", showOnReturn);
          }
        };
        document.addEventListener("visibilitychange", showOnReturn);
      }
    }
  });

  // 3. Before unload (closing tab/window)
  window.addEventListener("beforeunload", (e) => {
    if (isUserEngaged() && !wasShownRecently() && !exitPromptShown) {
      // Show prompt - this will delay the close slightly
      showExitPrompt();
      // Note: We can't fully prevent closing, but the prompt might catch some users
    }
  });

  // 4. Mobile: Detect back button (popstate)
  window.addEventListener("popstate", (e) => {
    // If the user tries to go back/close, show prompt (if engaged) and keep them in-app.
    if (!exitPromptShown && isUserEngaged()) {
      showExitPrompt();
      try {
        history.pushState({ __kspExitShare: true }, "", window.location.href);
      } catch (err) {
        /* ignore */
      }
    }
  });

  // Push a sentinel state for popstate detection.
  // Some browsers set a non-null initial state, so check for our marker.
  try {
    if (!history.state || history.state.__kspExitShare !== true) {
      history.pushState({ __kspExitShare: true }, "", window.location.href);
    }
  } catch (err) {
    /* ignore */
  }

  // Escape key to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && exitPrompt.classList.contains("visible")) {
      hideExitPrompt();
    }
  });

  console.log("📤 Exit Share Prompt initialized");
})();

// Recording Handlers (guarded — only bind listeners if elements exist)
if (recordBtn) {
  recordBtn.addEventListener("click", () => {
    if (!pianoEnabled) return;
    if (mediaRecorder && mediaRecorder.state === "inactive") {
      mediaRecorder.start();
      isRecording = true;
      recordBtn.classList.add("recording");
      // For new pro buttons, we don't change text - the animation shows recording state
      // For legacy buttons, update text
      if (recordBtn.classList.contains("record-btn-pro")) {
        // Pro button - just the recording class triggers animation
      } else {
        recordBtn.innerText = "● Recording...";
      }
      if (stopBtn) stopBtn.disabled = false;
      recordBtn.disabled = true;
      // Update the record panel
      if (recordStatusEl) {
        recordStatusEl.innerText = "Recording...";
        recordStatusEl.classList.add("recording");
      }
      if (recordTimerEl) recordTimerEl.textContent = "00:00";
      recordStartTimestamp = Date.now();
      if (recordTimerInterval) clearInterval(recordTimerInterval);
      recordTimerInterval = setInterval(() => {
        if (recordStartTimestamp && recordTimerEl) {
          recordTimerEl.textContent = formatTime(
            Date.now() - recordStartTimestamp
          );
        }
      }, 500);
    }
  });
}

if (stopBtn) {
  stopBtn.addEventListener("click", () => {
    if (!pianoEnabled) return;
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      isRecording = false;
      if (recordBtn) {
        recordBtn.classList.remove("recording");
        // Only set innerText for legacy buttons
        if (!recordBtn.classList.contains("record-btn-pro")) {
          recordBtn.innerText = "● Rec";
        }
        recordBtn.disabled = false;
      }
      stopBtn.disabled = true;
      // Update record panel - stop the timer and show status
      if (recordTimerInterval) {
        clearInterval(recordTimerInterval);
        recordTimerInterval = null;
      }
      if (recordStatusEl) {
        recordStatusEl.innerText = "Saved! Ready for download";
        recordStatusEl.classList.remove("recording");
      }
      // Show overlay feedback
      if (typeof showVizOverlay === "function") {
        showVizOverlay("Recording Saved! 🎵");
      }
    }
  });
}

// Piano Key Handlers (Mouse & Keyboard)
function tryShowPressedKey(keyElement) {
  if (!pressedKeyLetterEl || !pressedKeyNoteEl) return;
  const span = keyElement.querySelector("span");
  const label =
    (span && span.textContent.trim()) ||
    keyElement.getAttribute("data-key") ||
    "";
  const note = keyElement.getAttribute("data-note") || "";
  const shift =
    parseInt(keyElement.getAttribute("data-octave-shift") || "0", 10) || 0;
  const targetOctave = currentOctave + shift;
  pressedKeyLetterEl.textContent = label.toUpperCase();
  pressedKeyNoteEl.textContent = `${note}${targetOctave}`;
  pressedKeyLetterEl.classList.add("active");
  setTimeout(() => pressedKeyLetterEl.classList.remove("active"), 180);
}

// Track which keys are currently being held
const heldKeys = new Set();
const heldKeyElements = new Map();

// Start playing a key (press down)
const keyDown = (keyElement) => {
  if (!orientationLockTried) tryLockLandscape();
  if (!pianoEnabled) return;

  const note = keyElement.getAttribute("data-note");
  const shift = parseInt(keyElement.getAttribute("data-octave-shift") || 0);
  const keyId = `${note}_${shift}`;

  // Prevent re-triggering if already held
  if (heldKeys.has(keyId)) return;

  heldKeys.add(keyId);
  heldKeyElements.set(keyId, keyElement);

  // Start the note with sustain
  startNote(note, shift);

  // Visual feedback
  keyElement.classList.add("active");
  keyElement.classList.add("ripple");
  setTimeout(() => keyElement.classList.remove("ripple"), 400);

  // Update visual pressed key display
  tryShowPressedKey(keyElement);
};

// Stop playing a key (release)
const keyUp = (keyElement) => {
  if (!pianoEnabled) return;

  const note = keyElement.getAttribute("data-note");
  const shift = parseInt(keyElement.getAttribute("data-octave-shift") || 0);
  const keyId = `${note}_${shift}`;

  if (!heldKeys.has(keyId)) return;

  heldKeys.delete(keyId);
  heldKeyElements.delete(keyId);

  // Stop the note with natural release
  stopNote(note, shift);

  // Remove visual feedback
  keyElement.classList.remove("active");
};

// Legacy triggerKey for compatibility (quick tap)
const triggerKey = (keyElement) => {
  keyDown(keyElement);
  // Auto-release after short delay for tap gestures
  setTimeout(() => keyUp(keyElement), 150);
};

// Mouse event handlers for desktop
document.querySelectorAll(".key").forEach((key) => {
  // Mouse down - start note
  key.addEventListener("mousedown", (e) => {
    e.preventDefault();
    keyDown(key);
  });

  // Mouse up - stop note
  key.addEventListener("mouseup", (e) => {
    keyUp(key);
  });

  // Mouse leave while held - stop note
  key.addEventListener("mouseleave", (e) => {
    if (
      heldKeyElements.has(
        `${key.getAttribute("data-note")}_${parseInt(
          key.getAttribute("data-octave-shift") || 0
        )}`
      )
    ) {
      keyUp(key);
    }
  });
});

// Global mouse up to catch releases outside keys
document.addEventListener("mouseup", () => {
  // Release all held keys on global mouse up
  heldKeyElements.forEach((keyElement, keyId) => {
    keyUp(keyElement);
  });
});

// Touch event handlers for mobile (with multi-touch support)
document.querySelectorAll(".key").forEach((key) => {
  key.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      keyDown(key);
    },
    { passive: false }
  );

  key.addEventListener(
    "touchend",
    (e) => {
      e.preventDefault();
      keyUp(key);
    },
    { passive: false }
  );

  key.addEventListener("touchcancel", (e) => {
    keyUp(key);
  });
});

// Keyboard event handlers for desktop
const keyboardHeldKeys = new Set();

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (!pianoEnabled) return;

  const keyLower = e.key.toLowerCase();
  const el = keyMap[keyLower];

  if (el && !keyboardHeldKeys.has(keyLower)) {
    keyboardHeldKeys.add(keyLower);
    keyDown(el);
  }
});

document.addEventListener("keyup", (e) => {
  const keyLower = e.key.toLowerCase();
  const el = keyMap[keyLower];

  if (el && keyboardHeldKeys.has(keyLower)) {
    keyboardHeldKeys.delete(keyLower);
    keyUp(el);
  }
});

// ==============================================
// 6. FIRST-TIME USER ONBOARDING TOUR
// ==============================================
(function initOnboardingTour() {
  const TOUR_STORAGE_KEY = "kingsonicpro_tour_completed";

  // Tour steps configuration - Power button FIRST (critical!)
  const TOUR_STEPS = [
    {
      target: "#power-toggle",
      title: "🔌 Power On/Off",
      tip: "The piano is OFF by default. Click this button to turn it ON and start playing!",
      position: "bottom",
    },
    {
      target: ".pressed-key-display",
      title: "🎵 Key Display",
      tip: "This shows the current key letter and musical note you're playing.",
      position: "bottom",
    },
    {
      target: "#record-btn",
      title: "🎙️ Recorder",
      tip: "Record your creative sessions! Click to start recording and download your music.",
      position: "bottom",
    },
    {
      target: ".toggle-switch",
      title: "🎹 Sound System",
      tip: "Choose your sound: Piano (default), Synth, Square, or Sine wave tones.",
      position: "bottom",
    },
    {
      target: ".octave-controls",
      title: "🎼 Octave Control",
      tip: "Shift the pitch up or down. Use − and + to change octaves.",
      position: "bottom",
    },
    {
      target: ".piano-keys-list",
      title: "🎹 Piano Keys",
      tip: "Click the keys or use your keyboard (A-L, W-P) to play notes. Enjoy!",
      position: "top",
    },
  ];

  let currentStep = 0;

  // DOM Elements
  const tourContainer = document.getElementById("onboarding-tour");
  const spotlight = document.getElementById("tour-spotlight");
  const pointer = document.getElementById("tour-pointer");
  const tooltip = document.getElementById("tour-tooltip");
  const titleEl = document.getElementById("tour-title");
  const tipEl = document.getElementById("tour-tip");
  const progressEl = document.getElementById("tour-progress");
  const skipBtn = document.getElementById("tour-skip");
  const nextBtn = document.getElementById("tour-next");

  // Check if tour was already completed
  function isTourCompleted() {
    return localStorage.getItem(TOUR_STORAGE_KEY) === "true";
  }

  // Mark tour as completed
  function completeTour() {
    localStorage.setItem(TOUR_STORAGE_KEY, "true");
    hideTour();
  }

  // Show the tour
  function showTour() {
    if (!tourContainer) return;
    tourContainer.classList.add("active");
    tourContainer.setAttribute("aria-hidden", "false");
    showStep(0);
  }

  // Hide the tour
  function hideTour() {
    if (!tourContainer) return;
    tourContainer.classList.remove("active");
    tourContainer.setAttribute("aria-hidden", "true");
  }

  // Show a specific step
  function showStep(stepIndex) {
    if (stepIndex >= TOUR_STEPS.length) {
      completeTour();
      return;
    }

    currentStep = stepIndex;
    const step = TOUR_STEPS[stepIndex];
    const targetEl = document.querySelector(step.target);

    if (!targetEl) {
      // Skip this step if target not found
      showStep(stepIndex + 1);
      return;
    }

    // Update content
    if (titleEl) titleEl.textContent = step.title;
    if (tipEl) tipEl.textContent = step.tip;
    if (progressEl)
      progressEl.textContent = `Step ${stepIndex + 1} of ${TOUR_STEPS.length}`;
    if (nextBtn) {
      nextBtn.textContent =
        stepIndex === TOUR_STEPS.length - 1 ? "Got it! ✓" : "Next →";
    }

    // Position spotlight and pointer
    positionElements(targetEl, step.position);
  }

  // Position spotlight, pointer, and tooltip - PRECISE positioning
  function positionElements(targetEl, position) {
    const rect = targetEl.getBoundingClientRect();
    const padding = 6;
    const pointerSize = 40;

    // Spotlight - tighter around element
    if (spotlight) {
      spotlight.style.left = `${rect.left - padding}px`;
      spotlight.style.top = `${rect.top - padding}px`;
      spotlight.style.width = `${rect.width + padding * 2}px`;
      spotlight.style.height = `${rect.height + padding * 2}px`;
    }

    // Pointer - point EXACTLY at the element
    if (pointer) {
      const pointerLeft = rect.left + rect.width / 2 - pointerSize / 2;
      pointer.style.left = `${pointerLeft}px`;

      if (position === "top") {
        // Point DOWN from above
        pointer.style.top = `${rect.top - pointerSize - 4}px`;
        pointer.querySelector("svg").style.transform = "rotate(180deg)";
      } else {
        // Point UP from below - tip touches the bottom edge
        pointer.style.top = `${rect.bottom + 4}px`;
        pointer.querySelector("svg").style.transform = "rotate(0deg)";
      }
    }

    // Tooltip - positioned close to pointer
    if (tooltip) {
      const tooltipWidth = Math.min(300, window.innerWidth - 48);
      let tooltipLeft = rect.left + rect.width / 2 - tooltipWidth / 2;

      // Keep tooltip within screen bounds
      tooltipLeft = Math.max(
        24,
        Math.min(tooltipLeft, window.innerWidth - tooltipWidth - 24)
      );

      tooltip.style.left = `${tooltipLeft}px`;
      tooltip.style.width = `${tooltipWidth}px`;

      if (position === "top") {
        tooltip.style.top = `${rect.top - pointerSize - 160}px`;
      } else {
        tooltip.style.top = `${rect.bottom + pointerSize + 12}px`;
      }
    }
  }

  // Event listeners
  if (skipBtn) {
    skipBtn.addEventListener("click", completeTour);
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      showStep(currentStep + 1);
    });
  }

  // Initialize tour for first-time users
  function initTour() {
    // Only show tour in landscape and if not completed
    if (isTourCompleted()) return;

    // Wait for page to fully render
    setTimeout(() => {
      // Check if we're in portrait on mobile - don't show tour yet
      const isPortrait = window.innerHeight > window.innerWidth;
      const isMobile = window.innerWidth <= 900;

      if (isMobile && isPortrait) {
        // Wait for landscape orientation
        const checkOrientation = () => {
          if (window.innerWidth > window.innerHeight) {
            showTour();
            window.removeEventListener("resize", checkOrientation);
          }
        };
        window.addEventListener("resize", checkOrientation);
      } else {
        showTour();
      }
    }, 1500);
  }

  // Start the tour system
  if (document.readyState === "complete") {
    initTour();
  } else {
    window.addEventListener("load", initTour);
  }

  // Re-position elements on resize
  window.addEventListener("resize", () => {
    if (tourContainer && tourContainer.classList.contains("active")) {
      const step = TOUR_STEPS[currentStep];
      const targetEl = document.querySelector(step.target);
      if (targetEl) {
        positionElements(targetEl, step.position);
      }
    }
  });
})();
