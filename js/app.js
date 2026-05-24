/* ==========================================================================
   APPLICATION ENTRY POINT
   Ties together the Simulation, Canvas Renderer, and UI panels in a game loop.
   ========================================================================== */

class App {
  constructor() {
    this.levels = window.Levels;
    
    // 1. Instantiate the Simulation core
    this.sim = new window.Simulation(800, 600); // defaults, resized on load
    
    // 2. Locate Canvas and instantiate Renderer
    const canvas = document.getElementById('sim-canvas');
    this.renderer = new window.Renderer(canvas, this.sim);
    
    // 3. Instantiate UI
    this.ui = new window.UI(this.sim, this);
    
    // 4. Bind app-level simulation triggers
    this.sim.onTickCallback = () => this.ui.updateTickUI();
    this.sim.onLevelCompleteCallback = () => this.ui.showSuccessScreen();
    this.sim.onLevelFailCallback = () => this.ui.showFailScreen();
    
    // 5. Handle resizing
    window.addEventListener('resize', () => {
      this.renderer.resize();
    });
    
    // 6. Load initial level (Level 1)
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
  }

  startSimulation() {
    this.sim.start();
    this.ui.updateTickUI();
  }

  pauseSimulation() {
    this.sim.pause();
    this.ui.updateTickUI();
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
