# 🎹 KING SONIC PRO - Real Piano Audio & Visual Playback Plan

> **Project:** KING SON♪C Pro - Premium Web Synthesizer  
> **Feature:** Real Piano Samples + Visual Playback + Song Library  
> **Created:** January 7, 2026  
> **Status:** Planning Phase

---

## 📋 Executive Summary

Transform KING SONIC PRO from a synthesizer-based piano into a **full-featured piano learning and playback platform** with:
- High-quality sampled piano sounds
- Visual key animations synchronized to music
- Built-in song library with multiple playback modes

---

## 🎯 Feature Goals

### User Experience Vision

| Mode | Description | User Value |
|------|-------------|------------|
| **🎧 Listen & Watch** | Music plays automatically, keys animate | Entertainment, relaxation |
| **🎹 Play Along** | Visual guides show notes, user plays along | Learning, practice |
| **🎵 Play Solo** | User plays freely with real piano sounds | Performance, creativity |

---

## 🏗️ Technical Architecture

### Phase 1: Real Piano Sounds
**Timeline: 2-3 weeks**

#### 1.1 Audio Engine Upgrade
- [ ] Install Tone.js library (`npm install tone`)
- [ ] Replace Web Audio oscillators with Tone.js Sampler
- [ ] Implement lazy-loading for piano samples (per octave)
- [ ] Add volume envelope (attack, decay, sustain, release)

#### 1.2 Sample Library Integration
- [ ] Choose sample library:
  - **Option A:** Salamander Grand Piano (Free, ~25MB full, ~5MB compressed)
  - **Option B:** Tone.js built-in samples (Free, lightweight)
  - **Option C:** Custom samples (Higher quality, more storage)
- [ ] Host samples on CDN for fast loading
- [ ] Implement progressive loading (load octave 4 first, then expand)

#### 1.3 Velocity Sensitivity
- [ ] Implement 3 velocity layers (soft, medium, loud)
- [ ] Map click/touch pressure to velocity
- [ ] Add keyboard velocity simulation (hold shift for louder)

**Deliverables:**
- [ ] Real piano sounds working on all keys
- [ ] < 3 second initial load time
- [ ] Smooth playback with no audio glitches

---

### Phase 2: MIDI Song Library
**Timeline: 3-4 weeks**

#### 2.1 MIDI Parser Integration
- [ ] Install MIDI parser (`npm install @tonejs/midi`)
- [ ] Create MIDI file loader and parser
- [ ] Map MIDI notes to piano key elements
- [ ] Handle tempo, timing, and duration

#### 2.2 Song Database
- [ ] Create `songs.json` metadata file:
  ```json
  {
    "songs": [
      {
        "id": "fur-elise",
        "title": "Für Elise",
        "composer": "Ludwig van Beethoven",
        "difficulty": "intermediate",
        "duration": "3:15",
        "midiFile": "songs/fur-elise.mid",
        "category": "classical"
      }
    ]
  }
  ```
- [ ] Organize songs by category (Classical, Jazz, Pop, Learning)
- [ ] Add difficulty ratings (Beginner, Intermediate, Advanced)

#### 2.3 Initial Song Collection (Public Domain)
- [ ] Für Elise - Beethoven
- [ ] Moonlight Sonata - Beethoven
- [ ] Prelude in C Major - Bach
- [ ] Clair de Lune - Debussy
- [ ] Nocturne Op. 9 No. 2 - Chopin
- [ ] Canon in D - Pachelbel
- [ ] Gymnopédie No. 1 - Satie
- [ ] The Entertainer - Joplin
- [ ] River Flows in You - Yiruma (check licensing)
- [ ] Simple learning pieces (scales, arpeggios)

**Deliverables:**
- [ ] 15+ songs available in library
- [ ] Song metadata displaying correctly
- [ ] MIDI files loading and parsing

---

### Phase 3: Visual Playback Engine
**Timeline: 2-3 weeks**

#### 3.1 Key Animation System
- [ ] Create CSS keyframe animations for key press
- [ ] Add glow effect on active keys
- [ ] Implement smooth transitions between notes
- [ ] Color-code keys by hand (left = blue, right = orange)

#### 3.2 Playback Scheduler
- [ ] Use Tone.js Transport for precise timing
- [ ] Schedule key animations ahead of audio
- [ ] Implement play/pause/stop controls
- [ ] Add seek functionality (skip to position)

#### 3.3 Progress Display
- [ ] Show current position in song
- [ ] Display upcoming notes preview
- [ ] Add progress bar with seek capability

**Deliverables:**
- [ ] Keys animate perfectly in sync with music
- [ ] Smooth playback controls
- [ ] Visual progress indicator

---

### Phase 4: Song Browser UI
**Timeline: 1-2 weeks**

#### 4.1 Library Modal Design
- [ ] Create modal overlay for song browser
- [ ] Implement category tabs/filters
- [ ] Add search functionality
- [ ] Show song cards with:
  - Title & composer
  - Duration
  - Difficulty indicator
  - Play button

#### 4.2 Mobile-First Responsive Design
- [ ] Bottom sheet design for mobile
- [ ] Swipe gestures for navigation
- [ ] Large touch targets (48x48 minimum)
- [ ] Landscape-optimized layout

**Deliverables:**
- [ ] Beautiful, intuitive song browser
- [ ] Works great on mobile and desktop
- [ ] Fast search and filtering

---

### Phase 5: Interactive Play Along Mode
**Timeline: 2-3 weeks** *(Future Enhancement)*

#### 5.1 Note Guide System
- [ ] Show upcoming notes falling toward keys
- [ ] Highlight expected keys before they play
- [ ] Display finger numbers (optional)

#### 5.2 Scoring System
- [ ] Track note accuracy (correct/wrong)
- [ ] Measure timing precision
- [ ] Calculate overall score percentage
- [ ] Show real-time feedback

#### 5.3 Learning Tools
- [ ] Tempo adjustment (50% - 150%)
- [ ] Loop specific sections
- [ ] Hand separation (left only, right only, both)
- [ ] Practice mode (wait for correct note)

---

## 📦 Dependencies

```bash
# Required packages
npm install tone
npm install @tonejs/midi

# Tone.js - Professional Web Audio Framework
# @tonejs/midi - MIDI file parsing
```

---

## 💰 Resource Estimates

| Resource | Cost | Notes |
|----------|------|-------|
| **Development** | 8-12 weeks | Phases 1-4 |
| **Piano Samples CDN** | ~$5-15/month | Cloudflare or similar |
| **MIDI File Storage** | Minimal | Small file sizes |
| **Song Licensing** | $0 | Public domain only initially |

---

## 🚀 MVP Definition

**Minimum Viable Product includes:**
- ✅ Real piano samples (Salamander or similar)
- ✅ 10-15 classical songs
- ✅ Listen & Watch mode
- ✅ Basic song browser
- ✅ Play/pause controls

**NOT in MVP:**
- ❌ Play Along scoring
- ❌ User MIDI uploads
- ❌ Advanced learning tools
- ❌ Licensed pop songs

---

## 📊 Success Metrics

| Metric | Target |
|--------|--------|
| Sample load time | < 3 seconds |
| Audio latency | < 20ms |
| Songs in library | 15+ at launch |
| Mobile performance | 60fps animations |
| User engagement | 5+ min average session |

---

## 🔄 Implementation Order

```
Week 1-2:   Phase 1.1 - Tone.js integration
Week 3:     Phase 1.2 - Sample library
Week 4:     Phase 1.3 - Velocity + polish
Week 5-6:   Phase 2 - MIDI parser + songs
Week 7-8:   Phase 3 - Visual playback
Week 9-10:  Phase 4 - Song browser UI
Week 11-12: Testing, polish, optimization
```

---

## ✅ Next Actions

1. [ ] Set up Tone.js in project
2. [ ] Download and test Salamander samples
3. [ ] Create basic sampler with 1 octave
4. [ ] Test on mobile devices

---

## 📝 Notes

- Consider lazy-loading samples by octave to reduce initial load
- Test audio latency on various devices before committing to approach
- Public domain songs avoid legal issues - prioritize these
- Consider WebAssembly for complex audio processing if needed

---

*Document Version: 1.0*  
*Last Updated: January 7, 2026*
