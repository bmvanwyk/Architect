/* ==========================================================================
   AUDIO ENGINE — Procedural Synthwave Music + SFX
   Generates all sound in the browser using the Web Audio API.
   No external assets are required.

   Architecture:
   ─────────────────────────────────────────────────────────────
   AudioManager
     ├── AudioContext
     ├── MasterGain  ──────────────────────────── (mute toggle)
     │     ├── musicGain ─────── music bus
     │     └── sfxGain   ─────── sound effects bus
     ├── StepSequencer  ── schedules musical events ahead-of-time
     │     ├── Kick drum   (OscillatorNode, exponential pitch drop)
     │     ├── Snare       (BufferSourceNode with noise burst)
     │     ├── Hi-hat      (filtered noise)
     │     ├── Bass synth  (sawtooth + LP filter)
     │     └── Arp lead    (square wave + melody patterns)
     └── SFX helpers  ── called by UI events (deploy, fail, tick…)
   ─────────────────────────────────────────────────────────────

   Panic level (0–100) continuously morphs:
     • BPM      90 → 160
     • LP filter on bass: relaxed → aggressive
     • Arp speed: slow 8th notes → frantic 16th notes
     • Pad brightness: warm dim → sharp bright
     • Snare velocity: soft → hard
   ========================================================================== */

window.AudioManager = class AudioManager {
  constructor() {
    this._ctx        = null;      // AudioContext — lazy-init on first user interaction
    this._masterGain = null;
    this._musicGain  = null;
    this._sfxGain    = null;

    // Sequencer state
    this._bpm          = 90;
    this._panicLevel   = 0;         // 0–100, set every tick
    this._isPlaying    = false;
    this._schedulerId  = null;      // setInterval handle

    // Step sequencer position
    this._currentStep  = 0;
    this._stepCount    = 16;        // 16 steps per bar (16th notes)
    this._nextStepTime = 0;         // AudioContext time of next step
    this._lookAheadMs  = 100;       // ms ahead to schedule
    this._scheduleIntervalMs = 50;  // how often scheduler runs

    // Tone pools
    this._activeOscs   = [];        // oscillators we may need to stop

    // ── Musical content ────────────────────────────────────────────
    // Frequencies for C minor pentatonic (C2, Eb2, F2, G2, Bb2, C3…)
    this._BASS_NOTES = [65.41, 77.78, 87.31, 98.00, 116.54, 130.81];
    this._ARP_NOTES  = [
      261.63, 311.13, 349.23, 392.00, 466.16, // C4 pent
      523.25, 622.25, 698.46, 783.99, 932.33   // C5 pent
    ];

    // 16-step patterns (true = trigger on this step)
    this._PATTERNS = {
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      hatHi: [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],  // panic hi-hat
    };

    // Bass pattern (index into _BASS_NOTES, -1 = rest)
    this._BASS_PAT  = [0,-1,-1,-1, 2,-1,-1,-1, 0,-1,1,-1, 3,-1,-1,-1];
    // Arp pattern (index into _ARP_NOTES, cycling)
    this._ARP_PAT_SLOW = [0,4,2,4, 1,4,3,4, 0,6,2,5, 1,4,3,4];
    this._ARP_PAT_FAST = [0,2,4,6, 1,3,5,7, 0,2,3,5, 1,3,4,6, 0,2,4,8, 1,3,5,7, 2,4,6,8, 0,2,3,5];

    this._arpPatternIndex = 0;

    // muted state
    this._muted = false;
  }

  // ══════════════════════════════════════════════════════════════
  //  INITIALISE — must be called after user gesture
  // ══════════════════════════════════════════════════════════════
  _initCtx() {
    if (this._ctx) return;

    this._ctx        = new (window.AudioContext || window.webkitAudioContext)();
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.setValueAtTime(0.85, this._ctx.currentTime);
    this._masterGain.connect(this._ctx.destination);

    this._musicGain  = this._ctx.createGain();
    this._musicGain.gain.setValueAtTime(0.7, this._ctx.currentTime);
    this._musicGain.connect(this._masterGain);

    this._sfxGain    = this._ctx.createGain();
    this._sfxGain.gain.setValueAtTime(0.9, this._ctx.currentTime);
    this._sfxGain.connect(this._masterGain);

    // Create a reverb convolver for atmosphere
    this._reverb = this._buildReverb(1.2);
    this._reverbGain = this._ctx.createGain();
    this._reverbGain.gain.setValueAtTime(0.18, this._ctx.currentTime);
    this._reverb.connect(this._reverbGain);
    this._reverbGain.connect(this._masterGain);

    // Build a pad drone to run continuously
    this._startPad();
  }

  // ══════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════════

  /** Start the music sequencer (call on game start / unmute) */
  start() {
    this._initCtx();
    if (this._ctx.state === 'suspended') this._ctx.resume();
    if (this._isPlaying) return;

    this._isPlaying    = true;
    this._currentStep  = 0;
    this._nextStepTime = this._ctx.currentTime + 0.05;

    this._schedulerId = setInterval(() => this._scheduler(), this._scheduleIntervalMs);
  }

  /** Pause the sequencer (music fades out) */
  stop() {
    this._isPlaying = false;
    clearInterval(this._schedulerId);
    this._schedulerId = null;
    if (this._musicGain) {
      this._musicGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.3);
    }
  }

  /** Resume after stop */
  resume() {
    if (!this._ctx) { this.start(); return; }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    this._musicGain.gain.setTargetAtTime(0.7, this._ctx.currentTime, 0.4);
    this.start();
  }

  /** Toggle mute/unmute; returns new muted state */
  toggleMute() {
    this._initCtx();
    this._muted = !this._muted;
    if (this._masterGain) {
      if (this._muted) {
        this._masterGain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.15);
      } else {
        this._masterGain.gain.setTargetAtTime(0.85, this._ctx.currentTime, 0.25);
        if (!this._isPlaying) this.start();
        if (this._ctx.state === 'suspended') this._ctx.resume();
      }
    }
    return this._muted;
  }

  get isMuted() { return this._muted; }

  /**
   * Called every simulation tick.
   * @param {number} panicLevel  – 0 to 100
   * @param {boolean} isPlaying  – simulation running
   */
  onSimulationTick(panicLevel, isPlaying) {
    this._panicLevel = panicLevel;
    if (isPlaying && !this._isPlaying && !this._muted) {
      this.start();
    }
    this._morphToPanic(panicLevel);
  }

  // ── SFX calls ────────────────────────────────────────────────

  /** Played when a hero node is deployed */
  sfxDeploy()   { this._initCtx(); this._playSfxDeploy(); }
  /** Played when a packet is resolved successfully */
  sfxResolve()  { this._initCtx(); this._playSfxResolve(); }
  /** Played when packets drop / node fails */
  sfxFail()     { this._initCtx(); this._playSfxFail(); }
  /** Level success fanfare */
  sfxSuccess()  { this._initCtx(); this._playSfxSuccess(); }
  /** Level failure sting */
  sfxGameOver() { this._initCtx(); this._playSfxGameOver(); }
  /** Played when a packet is spawned */
  sfxPacket()   { this._initCtx(); this._playSfxTick(); }

  // ══════════════════════════════════════════════════════════════
  //  SEQUENCER CORE
  // ══════════════════════════════════════════════════════════════

  _secondsPerStep() {
    // At current BPM, 16 steps = 1 bar = 4 beats
    return (60 / this._bpm) / 4;
  }

  _scheduler() {
    if (!this._ctx || !this._isPlaying) return;
    const lookAhead = this._lookAheadMs / 1000;

    while (this._nextStepTime < this._ctx.currentTime + lookAhead) {
      this._scheduleStep(this._currentStep, this._nextStepTime);
      this._nextStepTime += this._secondsPerStep();
      this._currentStep  = (this._currentStep + 1) % this._stepCount;
    }
  }

  _scheduleStep(step, time) {
    const p = this._panicLevel / 100; // 0..1

    // ── Kick ──────────────────────────────────────────────────
    if (this._PATTERNS.kick[step]) {
      this._scheduleKick(time, p);
    }

    // ── Snare ─────────────────────────────────────────────────
    if (this._PATTERNS.snare[step]) {
      const vel = 0.4 + p * 0.6;
      this._scheduleSnare(time, vel);
    }

    // ── Hi-hat ────────────────────────────────────────────────
    const hatPat = p > 0.5 ? this._PATTERNS.hatHi : this._PATTERNS.hat;
    if (hatPat[step]) {
      const vel = 0.15 + p * 0.25;
      this._scheduleHat(time, vel, p > 0.6);
    }

    // ── Bass ──────────────────────────────────────────────────
    const bassIdx = this._BASS_PAT[step];
    if (bassIdx >= 0) {
      const freq = this._BASS_NOTES[bassIdx];
      this._scheduleBass(time, freq, p);
    }

    // ── Arp lead ──────────────────────────────────────────────
    // Slow: every 4 steps; Fast (panic>0.5): every 2 steps; Frantic (panic>0.75): every step
    const arpDiv = p > 0.75 ? 1 : p > 0.5 ? 2 : 4;
    if (step % arpDiv === 0) {
      const pattern = p > 0.45 ? this._ARP_PAT_FAST : this._ARP_PAT_SLOW;
      const noteIdx = this._arpPatternIndex % pattern.length;
      const freq    = this._ARP_NOTES[pattern[noteIdx]];
      this._arpPatternIndex++;
      this._scheduleArp(time, freq, p);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  DRUM INSTRUMENTS
  // ══════════════════════════════════════════════════════════════

  _scheduleKick(time, panic) {
    const ctx = this._ctx;
    // Pitch envelope: 150Hz → 40Hz
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150 + panic * 50, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.06);

    env.gain.setValueAtTime(0.9 + panic * 0.1, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

    osc.connect(env);
    env.connect(this._musicGain);

    osc.start(time);
    osc.stop(time + 0.3);
  }

  _scheduleSnare(time, velocity) {
    const ctx  = this._ctx;
    const dur  = 0.12;
    const bufSize = Math.floor(ctx.sampleRate * dur);
    const buf  = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

    const src  = ctx.createBufferSource();
    src.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type  = 'bandpass';
    filter.frequency.setValueAtTime(1800, time);
    filter.Q.setValueAtTime(0.6, time);

    const env  = ctx.createGain();
    env.gain.setValueAtTime(velocity, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + dur);

    src.connect(filter);
    filter.connect(env);
    env.connect(this._musicGain);

    src.start(time);
    src.stop(time + dur + 0.01);
  }

  _scheduleHat(time, velocity, open) {
    const ctx  = this._ctx;
    const dur  = open ? 0.18 : 0.04;
    const bufSize = Math.floor(ctx.sampleRate * dur);
    const buf  = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

    const src  = ctx.createBufferSource();
    src.buffer = buf;

    const hp   = ctx.createBiquadFilter();
    hp.type    = 'highpass';
    hp.frequency.setValueAtTime(8000, time);

    const env  = ctx.createGain();
    env.gain.setValueAtTime(velocity, time);
    env.gain.exponentialRampToValueAtTime(0.001, time + dur);

    src.connect(hp);
    hp.connect(env);
    env.connect(this._musicGain);
    src.start(time);
    src.stop(time + dur + 0.01);
  }

  // ══════════════════════════════════════════════════════════════
  //  BASS SYNTH
  // ══════════════════════════════════════════════════════════════

  _scheduleBass(time, freq, panic) {
    const ctx = this._ctx;
    const dur = this._secondsPerStep() * 3.5;

    const osc  = ctx.createOscillator();
    osc.type   = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    const lp   = ctx.createBiquadFilter();
    lp.type    = 'lowpass';
    // Panic morphs filter from warm (400Hz) to bright (3000Hz)
    const cutoff = 400 + panic * 2600;
    lp.frequency.setValueAtTime(cutoff, time);
    lp.Q.setValueAtTime(2 + panic * 4, time);

    // Pitch slide for groove
    osc.frequency.setValueAtTime(freq * 1.05, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.03);

    const env  = ctx.createGain();
    env.gain.setValueAtTime(0.5, time);
    env.gain.setValueAtTime(0.5, time + dur * 0.7);
    env.gain.linearRampToValueAtTime(0, time + dur);

    osc.connect(lp);
    lp.connect(env);
    env.connect(this._musicGain);

    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  // ══════════════════════════════════════════════════════════════
  //  ARP LEAD SYNTH
  // ══════════════════════════════════════════════════════════════

  _scheduleArp(time, freq, panic) {
    const ctx  = this._ctx;
    const dur  = this._secondsPerStep() * (panic > 0.5 ? 1.2 : 1.8);

    const osc  = ctx.createOscillator();
    osc.type   = 'square';
    osc.frequency.setValueAtTime(freq, time);

    const lp   = ctx.createBiquadFilter();
    lp.type    = 'lowpass';
    // Bright, cutting sound — ramps up with panic
    lp.frequency.setValueAtTime(1200 + panic * 3800, time);
    lp.Q.setValueAtTime(1 + panic * 3, time);

    // PWM-like detune for vintage feel
    const osc2 = ctx.createOscillator();
    osc2.type  = 'square';
    osc2.frequency.setValueAtTime(freq * 1.007, time); // slight detune

    const env  = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.18 + panic * 0.08, time + 0.005);
    env.gain.setValueAtTime(0.14, time + dur * 0.5);
    env.gain.linearRampToValueAtTime(0, time + dur);

    osc.connect(lp);
    osc2.connect(lp);
    lp.connect(env);
    env.connect(this._musicGain);
    env.connect(this._reverb);

    osc.start(time);  osc.stop(time + dur + 0.01);
    osc2.start(time); osc2.stop(time + dur + 0.01);
  }

  // ══════════════════════════════════════════════════════════════
  //  ATMOSPHERE PAD
  // ══════════════════════════════════════════════════════════════

  _startPad() {
    // Slow chord — Cm: C, Eb, G played as separate detuned sines
    const notes = [65.41, 77.78, 98.00, 130.81]; // C2, Eb2, G2, C3
    this._padOscs = notes.map((freq, i) => {
      const osc = this._ctx.createOscillator();
      osc.type  = 'sine';
      osc.frequency.setValueAtTime(freq + i * 0.3, this._ctx.currentTime);

      const g   = this._ctx.createGain();
      g.gain.setValueAtTime(0, this._ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.04, this._ctx.currentTime + 4);

      osc.connect(g);
      g.connect(this._reverb);
      osc.start();
      return { osc, gain: g };
    });
  }

  /** Continuously morphs tone colour to match panic */
  _morphToPanic(panic) {
    if (!this._ctx) return;

    const p   = panic / 100;
    const now = this._ctx.currentTime;

    // Ramp BPM
    this._bpm = 90 + p * 70; // 90 → 160

    // Pad brightness — slow sine LFO depth increases with panic
    if (this._padOscs) {
      this._padOscs.forEach(({ gain }, i) => {
        const vol = 0.04 + p * 0.06;
        gain.gain.setTargetAtTime(vol, now, 0.8);
      });
    }

    // Music bus volume ever so slightly louder under pressure
    if (this._musicGain) {
      const mv = 0.65 + p * 0.15;
      this._musicGain.gain.setTargetAtTime(mv, now, 1.0);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  REVERB
  // ══════════════════════════════════════════════════════════════

  _buildReverb(decaySecs) {
    const ctx  = this._ctx;
    const rate = ctx.sampleRate;
    const len  = Math.floor(rate * decaySecs);
    const buf  = ctx.createBuffer(2, len, rate);

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
      }
    }

    const conv = ctx.createConvolver();
    conv.buffer = buf;
    return conv;
  }

  // ══════════════════════════════════════════════════════════════
  //  SOUND EFFECTS
  // ══════════════════════════════════════════════════════════════

  /** Rising "power-up" tone — node deployed */
  _playSfxDeploy() {
    const ctx = this._ctx;
    const t   = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type  = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.15);
    env.gain.setValueAtTime(0.4, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(env); env.connect(this._sfxGain);
    osc.start(t); osc.stop(t + 0.3);
  }

  /** Quick high "blip" — packet resolved */
  _playSfxResolve() {
    const ctx = this._ctx;
    const t   = ctx.currentTime;
    [880, 1108].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type  = 'sine';
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0.25, t + i * 0.06);
      env.gain.exponentialRampToValueAtTime(0.001, t + i * 0.06 + 0.1);
      osc.connect(env); env.connect(this._sfxGain);
      osc.start(t + i * 0.06); osc.stop(t + i * 0.06 + 0.15);
    });
  }

  /** Low growl / error buzz — packet dropped / node fail */
  _playSfxFail() {
    const ctx    = this._ctx;
    const t      = ctx.currentTime;
    const buf    = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.18), ctx.sampleRate);
    const data   = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1);
    const src    = ctx.createBufferSource();
    src.buffer   = buf;
    const lp     = ctx.createBiquadFilter();
    lp.type      = 'lowpass'; lp.frequency.value = 250;
    const env    = ctx.createGain();
    env.gain.setValueAtTime(0.5, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    src.connect(lp); lp.connect(env); env.connect(this._sfxGain);
    src.start(t);
  }

  /** Ascending chord arpeggio — level won */
  _playSfxSuccess() {
    const ctx   = this._ctx;
    const t     = ctx.currentTime;
    const chord = [523.25, 659.26, 783.99, 1046.50]; // C-E-G-C
    chord.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const env  = ctx.createGain();
      osc.type   = 'triangle';
      osc.frequency.value = freq;
      const at   = t + i * 0.09;
      env.gain.setValueAtTime(0.35, at);
      env.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
      osc.connect(env); env.connect(this._sfxGain);
      osc.start(at); osc.stop(at + 0.6);
    });
  }

  /** Descending dissonant stab — game over */
  _playSfxGameOver() {
    const ctx   = this._ctx;
    const t     = ctx.currentTime;
    const freqs = [311.13, 246.94, 185.00, 130.81]; // Eb-B-Gb-C descending chromatic
    freqs.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const env  = ctx.createGain();
      osc.type   = 'sawtooth';
      osc.frequency.value = freq;
      const at   = t + i * 0.15;
      env.gain.setValueAtTime(0.3, at);
      env.gain.exponentialRampToValueAtTime(0.001, at + 0.4);
      osc.connect(env); env.connect(this._sfxGain);
      osc.start(at); osc.stop(at + 0.5);
    });
  }

  /** Tiny click for packet spawn */
  _playSfxTick() {
    const ctx  = this._ctx;
    const t    = ctx.currentTime;
    const osc  = ctx.createOscillator();
    const env  = ctx.createGain();
    osc.type   = 'sine';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(600, t + 0.02);
    env.gain.setValueAtTime(0.06, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.connect(env); env.connect(this._sfxGain);
    osc.start(t); osc.stop(t + 0.04);
  }
};
