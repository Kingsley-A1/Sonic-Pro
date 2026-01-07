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
let pianoEnabled = false; // piano OFF by default — user must click ON
// Recording UI state
let recordStartTimestamp = null;
let recordTimerInterval = null;

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
  const whiteKeys = Array.from(document.querySelectorAll(".key.white"));
  if (!whiteKeys.length) return;
  const whiteKeyWidth = parseFloat(getComputedStyle(whiteKeys[0]).width);
  const requiredWidth =
    whiteKeyWidth * whiteKeys.length + (whiteKeys.length - 1) * 2; // gap 2px
  const wrapper = document.querySelector(".piano-wrapper");
  const containerWidth = wrapper.clientWidth - 20; // small padding
  // Calculate width-based scale
  const scaleWidth = containerWidth / requiredWidth;
  // Calculate height-based scale using available app container space to avoid vertical scroll
  const appContainer = document.querySelector(".app-container");
  const headerH = document.querySelector(".synth-header")?.clientHeight || 0;
  const visualH =
    document.querySelector(".visual-dashboard")?.clientHeight || 0;
  const dashboardH = document.querySelector(".dashboard")?.clientHeight || 0;
  const paddingEstimate = 32; // small buffer for gaps/padding
  const availableHeight =
    (appContainer?.clientHeight || window.innerHeight) -
    (headerH + visualH + dashboardH + paddingEstimate);
  const whiteKeyHeight = parseFloat(getComputedStyle(whiteKeys[0]).height);
  const scaleHeight =
    availableHeight > 0 ? (availableHeight - 20) / whiteKeyHeight : 1;
  const scale = Math.min(1, scaleWidth, scaleHeight);
  const list = document.querySelector(".piano-keys-list");
  if (list) {
    list.style.transform = `scale(${scale})`;
    // set wrapper height to scaled height so nothing overflows
    wrapper.style.height = Math.max(whiteKeyHeight * scale + 40, 120) + "px";
  }
  // update visualizer size to match the new layout
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
  } catch (e) { }
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
    } catch (e) { }
    playPowerOnSound();
    showVizOverlay();
  } else {
    hideVizOverlay();
  }
}
if (powerToggle) {
  powerToggle.addEventListener("click", () => setPowerOn(!pianoEnabled));
}
// default state is off, show the UI accordingly
setPowerOn(false);

// ==============================================
// 2. RECORDER ENGINE (New Feature)
// ==============================================
// Create a specific destination node just for recording
const dest = audioCtx.createMediaStreamDestination();
analyser.connect(dest); // Connect sound to recorder destination

// Check if MediaRecorder is supported
if (window.MediaRecorder) {
  // NOTE: The page may not include record/stop buttons — guard these refs
  mediaRecorder = new MediaRecorder(dest.stream);

  mediaRecorder.ondataavailable = (e) => {
    audioChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    // Create a Blob from the audio chunks
    const blob = new Blob(audioChunks, { type: "audio/webm" });
    audioChunks = []; // Reset for next recording

    // Create a download link dynamically
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = `GOODEALS_Session_${new Date().getTime()}.webm`;
    document.body.appendChild(a);
    a.click();

    // Cleanup
    // window.URL.revokeObjectURL(url);
    // alert("Recording saved! Check your downloads.");
    // Ensure final timer display and reset state
    if (recordTimerEl && recordStartTimestamp) {
      recordTimerEl.textContent = formatTime(Date.now() - recordStartTimestamp);
    }
    if (recordStatusEl) {
      recordStatusEl.innerText = "Record Stopped, Ready for download!";
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
// 4. SOUND ENGINE (Core)
// ==============================================
function playNote(noteName, octaveShift = 0) {
  // Ensure Context is running (browsers pause it by default)
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  const oscillator = audioCtx.createOscillator();
  const noteGain = audioCtx.createGain();

  // Connect: Oscillator -> Note Gain -> Master Gain
  oscillator.connect(noteGain);
  noteGain.connect(masterGain);

  oscillator.type = waveform;

  // Frequency Calculation
  let targetOctave = currentOctave + octaveShift;

  // If note is "C" and octave is 4, fullNote is "C4"
  let fullNote = noteName + targetOctave;
  const frequency = getFrequency(fullNote);

  if (frequency) {
    oscillator.frequency.value = frequency;
    const now = audioCtx.currentTime;

    // Attack (Fade in fast)
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(masterVolume, now + 0.02);

    // Decay (Fade out)
    noteGain.gain.exponentialRampToValueAtTime(0.001, now + 1);

    oscillator.start(now);
    // If waveform is 'sawtooth' or 'square', add a second detuned oscillator for a richer tone
    let oscillator2;
    if (waveform === "sawtooth" || waveform === "square") {
      oscillator2 = audioCtx.createOscillator();
      oscillator2.type = waveform;
      oscillator2.frequency.value = frequency;
      // Slight detune using frequency ratio (cents could be used via .detune)
      try {
        oscillator2.detune.value = 8;
      } catch (e) {
        /* not all browsers support detune directly */
      }
      oscillator2.connect(noteGain);
      oscillator2.start(now);
      oscillator2.stop(now + 1);
    }
    oscillator.stop(now + 1);
  } else {
    console.warn(
      `No frequency found for note ${fullNote}. Make sure the note mapping exists (getFrequency).`
    );
  }
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
  const shareBtn = document.getElementById('share-btn');
  if (!shareBtn) return;

  const shareData = {
    title: 'KING SON♪C Pro',
    text: 'Premium Performance • Built with Passion • Built For You! 🎹 Check out this amazing web piano!',
    url: window.location.href
  };

  shareBtn.addEventListener('click', async () => {
    // Check if Web Share API is available
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        console.log('✅ Shared successfully!');
        showVizOverlay('Shared!\nThanks for spreading the music 🎶');
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Share failed:', err);
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
      navigator.clipboard.writeText(url).then(() => {
        showVizOverlay('Link Copied!\nShare it anywhere 📋');
      }).catch(() => {
        showShareModal();
      });
    } else {
      showShareModal();
    }
  }

  function showShareModal() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent('Check out KING SON♪C Pro - Premium Performance • Built with Passion • Built For You! 🎹');

    // Create a simple share modal
    const modal = document.createElement('div');
    modal.className = 'share-modal';
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
    modal.querySelector('.share-modal-backdrop').addEventListener('click', () => modal.remove());
    modal.querySelector('.share-modal-close').addEventListener('click', () => modal.remove());

    // Auto-remove on link click
    modal.querySelectorAll('.share-option').forEach(link => {
      link.addEventListener('click', () => setTimeout(() => modal.remove(), 500));
    });
  }
})();

// ==============================================
// EXIT INTENT SHARE PROMPT - Smart Exit Detection
// ==============================================
(function initExitSharePrompt() {
  const EXIT_STORAGE_KEY = 'kingsonicpro_exit_share_shown';
  const MIN_SESSION_TIME = 30000; // 30 seconds minimum before showing
  const MIN_NOTES_PLAYED = 5; // Minimum notes to be considered engaged

  // Session tracking
  let sessionStartTime = Date.now();
  let notesPlayedCount = 0;
  let exitPromptShown = false;

  // DOM Elements
  const exitPrompt = document.getElementById('exit-share-prompt');
  const exitBackdrop = exitPrompt?.querySelector('.exit-share-backdrop');
  const exitClose = exitPrompt?.querySelector('.exit-share-close');
  const exitDismiss = document.getElementById('exit-share-dismiss');
  const exitShareNative = document.getElementById('exit-share-native');
  const statNotesPlayed = document.getElementById('stat-notes-played');
  const statSessionTime = document.getElementById('stat-session-time');

  // Social links
  const whatsappLink = document.getElementById('exit-share-whatsapp');
  const twitterLink = document.getElementById('exit-share-twitter');
  const facebookLink = document.getElementById('exit-share-facebook');
  const copyLink = document.getElementById('exit-share-copy');

  if (!exitPrompt) return;

  // Track notes played (hook into existing triggerKey function)
  const originalTriggerKey = window.triggerKey || null;
  window.trackNotePlayed = function () {
    notesPlayedCount++;
  };

  // Hook into key playing - we'll call this from the existing triggerKey
  const pianoKeys = document.querySelectorAll('.key');
  pianoKeys.forEach(key => {
    key.addEventListener('mousedown', () => notesPlayedCount++);
  });
  document.addEventListener('keydown', (e) => {
    if (!e.repeat && keyMap && keyMap[e.key?.toLowerCase()]) {
      notesPlayedCount++;
    }
  });

  // Format session time
  function formatSessionTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  // Check if prompt was shown recently (within 24 hours)
  function wasShownRecently() {
    const lastShown = localStorage.getItem(EXIT_STORAGE_KEY);
    if (!lastShown) return false;
    const hoursSince = (Date.now() - parseInt(lastShown, 10)) / (1000 * 60 * 60);
    return hoursSince < 24;
  }

  // Check if user is engaged enough to warrant the prompt
  function isUserEngaged() {
    const sessionDuration = Date.now() - sessionStartTime;
    return sessionDuration >= MIN_SESSION_TIME && notesPlayedCount >= MIN_NOTES_PLAYED;
  }

  // Update stats display
  function updateStats() {
    if (statNotesPlayed) statNotesPlayed.textContent = notesPlayedCount;
    if (statSessionTime) statSessionTime.textContent = formatSessionTime(Date.now() - sessionStartTime);
  }

  // Set up social share URLs
  function setupSocialLinks() {
    const url = encodeURIComponent(window.location.href);
    const text = encodeURIComponent('🎹 Just played amazing music on KING SON♪C Pro! Premium Performance • Built with Passion • Built For You!');

    if (whatsappLink) whatsappLink.href = `https://wa.me/?text=${text}%20${url}`;
    if (twitterLink) twitterLink.href = `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
    if (facebookLink) facebookLink.href = `https://www.facebook.com/sharer/sharer.php?u=${url}`;
  }

  // Show the exit prompt
  function showExitPrompt() {
    if (exitPromptShown || wasShownRecently() || !isUserEngaged()) return;

    exitPromptShown = true;
    updateStats();
    setupSocialLinks();

    exitPrompt.classList.add('visible');
    exitPrompt.setAttribute('aria-hidden', 'false');

    // Mark as shown
    localStorage.setItem(EXIT_STORAGE_KEY, Date.now().toString());
  }

  // Hide the exit prompt
  function hideExitPrompt() {
    exitPrompt.classList.remove('visible');
    exitPrompt.setAttribute('aria-hidden', 'true');
  }

  // Native share handler
  async function handleNativeShare() {
    const shareData = {
      title: 'KING SON♪C Pro',
      text: `🎹 I just played ${notesPlayedCount} notes on KING SON♪C Pro! Try this amazing web piano - Premium Performance • Built with Passion • Built For You!`,
      url: window.location.href
    };

    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
      try {
        await navigator.share(shareData);
        hideExitPrompt();
        showVizOverlay('Thanks for sharing! 🎶');
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error('Share failed:', err);
        }
      }
    } else {
      // Fallback - copy to clipboard
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(window.location.href);
        hideExitPrompt();
        showVizOverlay('Link copied! 📋');
      }
    }
  }

  // Copy link handler
  async function handleCopyLink(e) {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(window.location.href);
      hideExitPrompt();
      showVizOverlay('Link copied! 📋');
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }

  // Event Listeners for closing
  if (exitBackdrop) exitBackdrop.addEventListener('click', hideExitPrompt);
  if (exitClose) exitClose.addEventListener('click', hideExitPrompt);
  if (exitDismiss) exitDismiss.addEventListener('click', hideExitPrompt);
  if (exitShareNative) exitShareNative.addEventListener('click', handleNativeShare);
  if (copyLink) copyLink.addEventListener('click', handleCopyLink);

  // Close social links after clicking
  [whatsappLink, twitterLink, facebookLink].forEach(link => {
    if (link) {
      link.addEventListener('click', () => {
        setTimeout(hideExitPrompt, 500);
      });
    }
  });

  // EXIT INTENT DETECTION

  // 1. Mouse leaving the viewport (desktop)
  document.addEventListener('mouseout', (e) => {
    if (e.clientY <= 0 && !exitPromptShown) {
      showExitPrompt();
    }
  });

  // 2. Page visibility change (tab switching, mobile app switching)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !exitPromptShown) {
      // Don't show immediately on visibility change, but mark for next return
      if (isUserEngaged() && !wasShownRecently()) {
        // Show when they come back
        const showOnReturn = () => {
          if (document.visibilityState === 'visible') {
            setTimeout(showExitPrompt, 500);
            document.removeEventListener('visibilitychange', showOnReturn);
          }
        };
        document.addEventListener('visibilitychange', showOnReturn);
      }
    }
  });

  // 3. Before unload (closing tab/window)
  window.addEventListener('beforeunload', (e) => {
    if (isUserEngaged() && !wasShownRecently() && !exitPromptShown) {
      // Show prompt - this will delay the close slightly
      showExitPrompt();
      // Note: We can't fully prevent closing, but the prompt might catch some users
    }
  });

  // 4. Mobile: Detect back button (popstate)
  window.addEventListener('popstate', (e) => {
    if (!exitPromptShown && isUserEngaged()) {
      e.preventDefault();
      showExitPrompt();
      // Re-push state to prevent actual navigation
      history.pushState(null, '', window.location.href);
    }
  });

  // Push initial state for popstate detection
  if (history.state === null) {
    history.pushState(null, '', window.location.href);
  }

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && exitPrompt.classList.contains('visible')) {
      hideExitPrompt();
    }
  });

  console.log('📤 Exit Share Prompt initialized');
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
      if (recordBtn.classList.contains('record-btn-pro')) {
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
        if (!recordBtn.classList.contains('record-btn-pro')) {
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
      if (typeof showVizOverlay === 'function') {
        showVizOverlay('Recording Saved! 🎵');
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

const triggerKey = (keyElement) => {
  if (!orientationLockTried) tryLockLandscape();
  if (!pianoEnabled) return; // ignore key presses if turned off
  const note = keyElement.getAttribute("data-note");
  const shift = parseInt(keyElement.getAttribute("data-octave-shift") || 0);

  playNote(note, shift);

  // Visual feedback
  keyElement.classList.add("active");
  setTimeout(() => keyElement.classList.remove("active"), 150);
  // Update visual pressed key display
  tryShowPressedKey(keyElement);
};

document.querySelectorAll(".key").forEach((key) => {
  key.addEventListener("mousedown", () => triggerKey(key));
});

// also start orientation/overlay logic on the first mobile touch
document.addEventListener("touchstart", tryLockLandscape, { once: true });

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (!pianoEnabled) return;
  const el = keyMap[e.key.toLowerCase()];
  if (el) triggerKey(el);
});

// ==============================================
// 6. FIRST-TIME USER ONBOARDING TOUR
// ==============================================
(function initOnboardingTour() {
  const TOUR_STORAGE_KEY = 'kingsonicpro_tour_completed';

  // Tour steps configuration - Power button FIRST (critical!)
  const TOUR_STEPS = [
    {
      target: '#power-toggle',
      title: '🔌 Power On/Off',
      tip: 'The piano is OFF by default. Click this button to turn it ON and start playing!',
      position: 'bottom'
    },
    {
      target: '.pressed-key-display',
      title: '🎵 Key Display',
      tip: 'This shows the current key letter and musical note you\'re playing.',
      position: 'bottom'
    },
    {
      target: '#record-btn',
      title: '🎙️ Recorder',
      tip: 'Record your creative sessions! Click to start recording and download your music.',
      position: 'bottom'
    },
    {
      target: '.toggle-switch',
      title: '🎹 Sound System',
      tip: 'Choose your sound: Piano (default), Synth, Square, or Sine wave tones.',
      position: 'bottom'
    },
    {
      target: '.octave-controls',
      title: '🎼 Octave Control',
      tip: 'Shift the pitch up or down. Use − and + to change octaves.',
      position: 'bottom'
    },
    {
      target: '.piano-keys-list',
      title: '🎹 Piano Keys',
      tip: 'Click the keys or use your keyboard (A-L, W-P) to play notes. Enjoy!',
      position: 'top'
    }
  ];

  let currentStep = 0;

  // DOM Elements
  const tourContainer = document.getElementById('onboarding-tour');
  const spotlight = document.getElementById('tour-spotlight');
  const pointer = document.getElementById('tour-pointer');
  const tooltip = document.getElementById('tour-tooltip');
  const titleEl = document.getElementById('tour-title');
  const tipEl = document.getElementById('tour-tip');
  const progressEl = document.getElementById('tour-progress');
  const skipBtn = document.getElementById('tour-skip');
  const nextBtn = document.getElementById('tour-next');

  // Check if tour was already completed
  function isTourCompleted() {
    return localStorage.getItem(TOUR_STORAGE_KEY) === 'true';
  }

  // Mark tour as completed
  function completeTour() {
    localStorage.setItem(TOUR_STORAGE_KEY, 'true');
    hideTour();
  }

  // Show the tour
  function showTour() {
    if (!tourContainer) return;
    tourContainer.classList.add('active');
    tourContainer.setAttribute('aria-hidden', 'false');
    showStep(0);
  }

  // Hide the tour
  function hideTour() {
    if (!tourContainer) return;
    tourContainer.classList.remove('active');
    tourContainer.setAttribute('aria-hidden', 'true');
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
    if (progressEl) progressEl.textContent = `Step ${stepIndex + 1} of ${TOUR_STEPS.length}`;
    if (nextBtn) {
      nextBtn.textContent = stepIndex === TOUR_STEPS.length - 1 ? 'Got it! ✓' : 'Next →';
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

      if (position === 'top') {
        // Point DOWN from above
        pointer.style.top = `${rect.top - pointerSize - 4}px`;
        pointer.querySelector('svg').style.transform = 'rotate(180deg)';
      } else {
        // Point UP from below - tip touches the bottom edge
        pointer.style.top = `${rect.bottom + 4}px`;
        pointer.querySelector('svg').style.transform = 'rotate(0deg)';
      }
    }

    // Tooltip - positioned close to pointer
    if (tooltip) {
      const tooltipWidth = Math.min(300, window.innerWidth - 48);
      let tooltipLeft = rect.left + rect.width / 2 - tooltipWidth / 2;

      // Keep tooltip within screen bounds
      tooltipLeft = Math.max(24, Math.min(tooltipLeft, window.innerWidth - tooltipWidth - 24));

      tooltip.style.left = `${tooltipLeft}px`;
      tooltip.style.width = `${tooltipWidth}px`;

      if (position === 'top') {
        tooltip.style.top = `${rect.top - pointerSize - 160}px`;
      } else {
        tooltip.style.top = `${rect.bottom + pointerSize + 12}px`;
      }
    }
  }

  // Event listeners
  if (skipBtn) {
    skipBtn.addEventListener('click', completeTour);
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
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
            window.removeEventListener('resize', checkOrientation);
          }
        };
        window.addEventListener('resize', checkOrientation);
      } else {
        showTour();
      }
    }, 1500);
  }

  // Start the tour system
  if (document.readyState === 'complete') {
    initTour();
  } else {
    window.addEventListener('load', initTour);
  }

  // Re-position elements on resize
  window.addEventListener('resize', () => {
    if (tourContainer && tourContainer.classList.contains('active')) {
      const step = TOUR_STEPS[currentStep];
      const targetEl = document.querySelector(step.target);
      if (targetEl) {
        positionElements(targetEl, step.position);
      }
    }
  });
})();
