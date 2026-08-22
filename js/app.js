/* ==========================================================================
   APPLICATION ENTRY POINT
   Ties together the Simulation, Canvas Renderer, and UI panels in a game loop.
   ========================================================================== */

class App {
  constructor() {
    this.levels = window.Levels;
    
    // 1. Instantiate the Simulation core
    this.sim = new window.Simulation(800, 600); // defaults, resized on load

    // 1b. Viewport camera (pan + zoom)
    this.camera = new window.Camera();

    // 2. Locate Canvas and instantiate Renderer
    const canvas = document.getElementById('sim-canvas');
    this.renderer = new window.Renderer(canvas, this.sim);
    this.renderer.camera = this.camera;

    // 3. Instantiate UI
    this.ui = new window.UI(this.sim, this);

    // 4. Instantiate Audio Engine (lazy-init on first user gesture)
    this.audio = new window.AudioManager();
    
    // 4. Bind app-level simulation triggers
    this.sim.onTickCallback = () => this.ui.updateTickUI();
    this.sim.onLevelCompleteCallback = () => this.ui.showSuccessScreen();
    this.sim.onLevelFailCallback = () => this.ui.showFailScreen();

    // 4b. Failure-entity breach: shake the viewport + alarm sting
    this.sim.onBreach = (kind) => {
      this.camera.shake(kind === 'partition' ? 16 : 11, 16);
      if (this.audio && !this.audio.isMuted) this.audio.sfxBreach();
    };
    
    // 5. Handle resizing
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.camera.centerOn(this.sim.width, this.sim.height);
    });

    // 6. Load initial level (Level 1)
    this.camera.centerOn(this.sim.width, this.sim.height);
    this.loadLevel(1);
    
    // 7. Auto-start tutorial on first load
    this.ui.startTutorial();
    
    // 8. Start graphics drawing loop
    this.lastTime = 0;
    this.loop();
  }

  loadLevel(levelId) {
    this.sim.loadLevel(levelId);
    this.ui.rebuildLevelSelector();
    this.ui.updateBriefing();
    this.ui.updateTickUI();
    this.ui.setTool('select');
    
    // Refresh canvas dimensions just in case grid changed
    this.renderer.resize();

    // Tighter default framing: nodes and packets feel substantial at ~1.25x
    this.camera.scale = 1.25;
  }

  startSimulation() {
    this.sim.start();
    this.ui.updateTickUI();
    // Start audio on first simulation play (browser autoplay policy safe)
    if (!this.audio.isMuted) this.audio.start();
  }

  pauseSimulation() {
    this.sim.pause();
    this.ui.updateTickUI();
    this.audio.stop();
  }

  restartLevel() {
    this.loadLevel(this.sim.currentLevelId);
  }

  loop(timestamp = 0) {
    // Limit tick cycles to match roughly 60 FPS (16.6ms intervals)
    const elapsed = timestamp - this.lastTime;
    
    if (elapsed >= 16.6) {
      this.lastTime = timestamp;
      
      // Execute a simulation tick
      this.sim.tick();
    }
    
    // Draw canvas frames on every animation tick for fluid visuals
    this.renderer.draw();
    
    // Recurse game loop
    requestAnimationFrame((t) => this.loop(t));
  }
}

// Bootstrap the app once document elements load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
