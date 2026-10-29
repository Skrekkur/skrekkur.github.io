(() => {
  const { TEAM: TEAMS, BEHAVIOR, TRACE, TOOL, FOG, EVENT } = window.GAME_CONSTANTS;
  const HEADQUARTERS = window.HEADQUARTERS;
  const MOVEMENT_BEHAVIORS = window.MOVEMENT_BEHAVIORS;
  const GLOBAL_ACCURACY = window.GLOBAL_ACCURACY;
  const PERCEPTION_CONFIG = window.PERCEPTION_CONFIG;
  const PerformanceMonitor = window.PerformanceMonitor;
  const LevelStorage = window.LevelStorage;
  const WORLD_SIZES = window.WORLD_SIZES;
  const OBSTACLE_SIZE = window.OBSTACLE_SIZE;
  const World = window.World;
  const Camera = window.Camera;
  const Renderer = window.Renderer;

  const canvas = document.querySelector('#worldCanvas');
  const levelStorage = new LevelStorage();
  const performanceMonitor = new PerformanceMonitor();
  const world = new World(performanceMonitor);
  let startupDefaultLevel = null;
  try {
    startupDefaultLevel = levelStorage.getDefaultLevel(world.sizeKey);
    if (startupDefaultLevel) world.applyLevel(startupDefaultLevel.save);
  } catch (error) {
    console.warn('Unable to load the default level', error);
  }
  const camera = new Camera(world);
  const renderer = new Renderer(canvas, world, camera);
  const ui = {
    roster: document.querySelector('#rosterList'),
    inspector: document.querySelector('#inspectorContent'),
    events: document.querySelector('#eventList'),
    count: document.querySelector('#unitCount'),
    eventCount: document.querySelector('#eventCount'),
    clock: document.querySelector('#simClock'),
    status: document.querySelector('#simStatus'),
    coordinates: document.querySelector('#pointerCoordinates'),
    rosterToggleButton: document.querySelector('#rosterToggleButton'),
    rosterToggleIcon: document.querySelector('#rosterToggleIcon'),
    traceHint: document.querySelector('#traceHint'),
    zoomLabel: document.querySelector('#zoomLabel'),
    playButton: document.querySelector('#playButton'),
    playLabel: document.querySelector('#playLabel'),
    playIcon: document.querySelector('#playIcon'),
    traceButton: document.querySelector('#traceButton'),
    buildGuardPointEmber: document.querySelector('#buildGuardPointEmber'),
    buildGuardPointTide: document.querySelector('#buildGuardPointTide'),
    buildObstacle: document.querySelector('#buildObstacle'),
    buildHint: document.querySelector('#buildHint'),
    levelNameInput: document.querySelector('#levelNameInput'),
    savedLevelSelect: document.querySelector('#savedLevelSelect'),
    newLevelButton: document.querySelector('#newLevelButton'),
    saveLevelButton: document.querySelector('#saveLevelButton'),
    loadLevelButton: document.querySelector('#loadLevelButton'),
    defaultLevelButton: document.querySelector('#defaultLevelButton'),
    deleteLevelButton: document.querySelector('#deleteLevelButton'),
    themeToggle: document.querySelector('#themeToggle'),
    themeToggleIcon: document.querySelector('#themeToggleIcon'),
    topViewButton: document.querySelector('#topViewButton'),
    isoViewButton: document.querySelector('#isoViewButton'),
    rotateLeftButton: document.querySelector('#rotateLeftButton'),
    rotateRightButton: document.querySelector('#rotateRightButton'),
    navigationGridButton: document.querySelector('#navigationGridButton'),
    worldSizeStandard: document.querySelector('#worldSizeStandard'),
    worldSizeXl: document.querySelector('#worldSizeXl'),
    worldSizeValue: document.querySelector('#worldSizeValue'),
    reachabilityMethod: document.querySelector('#reachabilityMethod'),
    reachabilityAlgorithm: document.querySelector('#reachabilityAlgorithm'),
    reachabilityCheckUnits: document.querySelector('#reachabilityCheckUnits'),
    reachabilityAuto: document.querySelector('#reachabilityAuto'),
    reachabilityInterval: document.querySelector('#reachabilityInterval'),
    runReachabilityButton: document.querySelector('#runReachabilityButton'),
    reachabilityStatus: document.querySelector('#reachabilityStatus'),
    reachabilityGraphToggle: document.querySelector('#reachabilityGraphToggle'),
    reachabilityToggle: document.querySelector('#reachabilityToggle'),
    perceptionDebugButton: document.querySelector('#perceptionDebugButton'),
    perceptionDebugPanel: document.querySelector('#perceptionDebugPanel'),
    perceptionDebugContent: document.querySelector('#perceptionDebugContent'),
    performanceButton: document.querySelector('#performanceButton'),
    performancePanel: document.querySelector('#performancePanel'),
    performanceContent: document.querySelector('#performanceContent'),
    viewEyebrow: document.querySelector('#viewEyebrow'),
    canvasHelp: document.querySelector('#canvasHelp'),
    timeScaleSlider: document.querySelector('#timeScaleSlider'),
    timeScaleValue: document.querySelector('#timeScaleValue'),
    accuracySlider: document.querySelector('#accuracySlider'),
    accuracyValue: document.querySelector('#accuracyValue'),
    toast: document.querySelector('#toast')
  };

  const uiController = new window.UiController(ui);
  let selectedId = 1;
  let selectedLevelId = startupDefaultLevel?.id ?? null;
  let activeTool = null;
  let pendingGuardTeam = null;
  let pendingGuardVariant = 'guard';
  let lastGuardHeadingByTeam = { Ember: null, Tide: null };
  let events = [];
  let uiAccumulator = 0;
  let lastFrame = performance.now();
  let perceptionDebugEnabled = false;
  let performancePanelEnabled = false;
  let performancePanelAccumulator = 0;
  let lastRender = 0;
  let toastTimeout;
  let pointerDown = null;
  const cameraMovementKeys = new Set();

  function addEvent(message, type = 'info') {
    events.unshift({ message, type, time: world.elapsed });
    events = events.slice(0, 24);
    uiController.renderEvents(events);
  }

  function getPerceptionBlocker(observer, target) {
    const obstacle = world.obstacles.find(candidate => world.segmentObstacleHit(observer.position, target.position, candidate) !== null);
    if (obstacle) return `OBSTACLE #${obstacle.id}`;

    const dx = target.position.x - observer.position.x;
    const dz = target.position.z - observer.position.z;
    const lengthSquared = dx * dx + dz * dz;
    if (!lengthSquared) return null;

    const blockingUnit = world.units.find(candidate => {
      if (!candidate.alive || candidate === observer || candidate === target) return false;
      if (!PERCEPTION_CONFIG.friendliesBlockSight && candidate.team === observer.team) return false;
      const targetDx = candidate.position.x - target.position.x;
      const targetDz = candidate.position.z - target.position.z;
      const targetRadius = target.radius ?? 1.7;
      const combinedRadius = (candidate.radius ?? 1.7) + targetRadius;
      if (targetDx * targetDx + targetDz * targetDz < combinedRadius * combinedRadius) return false;
      const t = ((candidate.position.x - observer.position.x) * dx + (candidate.position.z - observer.position.z) * dz) / lengthSquared;
      if (t <= 0 || t >= 1) return false;
      const nearestX = observer.position.x + t * dx;
      const nearestZ = observer.position.z + t * dz;
      const offsetX = nearestX - candidate.position.x;
      const offsetZ = nearestZ - candidate.position.z;
      const radius = candidate.radius ?? 1.7;
      return offsetX * offsetX + offsetZ * offsetZ < radius * radius;
    });

    if (!blockingUnit) return null;
    const relation = blockingUnit.team === observer.team ? 'FRIENDLY' : 'ENEMY';
    return `${relation} ${blockingUnit.label} (#${blockingUnit.id})`;
  }

  function renderPerceptionDebug() {
    const observer = world.units.find(unit => unit.id === selectedId);
    ui.perceptionDebugContent.replaceChildren();

    const summary = document.createElement('div');
    summary.className = 'perception-debug-summary';
    if (!observer) {
      summary.textContent = 'NO UNIT SELECTED';
      ui.perceptionDebugContent.append(summary);
      return;
    }

    const target = world.units.find(unit => unit.id === observer.targetId);
    const tickAge = Math.max(0, world.elapsed - world.lastPerceptionUpdate);
    summary.textContent = `${observer.label} (#${observer.id}) · STORED [${observer.perceivedEnemies.join(', ') || 'NONE'}] · TARGET ${target?.label ?? 'NONE'} · TICK AGE ${tickAge.toFixed(2)}s · FRIENDLY BLOCK ${PERCEPTION_CONFIG.friendliesBlockSight ? 'ON' : 'OFF'}`;
    ui.perceptionDebugContent.append(summary);

    const enemies = world.units
      .filter(unit => unit.alive && unit.team !== observer.team)
      .map(unit => ({ unit, distance: Math.hypot(unit.position.x - observer.position.x, unit.position.z - observer.position.z) }))
      .sort((a, b) => a.distance - b.distance);

    if (!enemies.length) {
      const empty = document.createElement('div');
      empty.className = 'perception-debug-row';
      empty.textContent = 'NO LIVING ENEMIES';
      ui.perceptionDebugContent.append(empty);
      return;
    }

    for (const { unit, distance } of enemies) {
      const withinRange = distance <= observer.perceptionRange;
      const blocker = withinRange ? getPerceptionBlocker(observer, unit) : null;
      const stored = observer.perceivedEnemies.includes(unit.id);
      let status = 'OUT OF RANGE';
      let statusClass = '';
      if (withinRange && blocker) {
        status = `BLOCKED · ${blocker}`;
        statusClass = 'blocked';
      } else if (stored) {
        status = 'PERCEIVED';
        statusClass = 'ok';
      } else if (withinRange) {
        status = 'CLEAR · AWAITING PERCEPTION TICK';
      }

      const row = document.createElement('div');
      row.className = 'perception-debug-row';
      row.textContent = `${unit.label} (#${unit.id}) · ${distance.toFixed(2)} / ${observer.perceptionRange.toFixed(2)}m`;
      const statusElement = document.createElement('span');
      statusElement.className = `perception-debug-status ${statusClass}`;
      statusElement.textContent = `${status} · STORED ${stored ? 'YES' : 'NO'}`;
      row.append(statusElement);
      ui.perceptionDebugContent.append(row);
    }
  }

  function formatMilliseconds(value) {
    if (value < 0.01) return '<0.01 ms';
    return `${value.toFixed(value < 10 ? 2 : 1)} ms`;
  }

  function renderPerformancePanel() {
    const priority = { simulationTick: 0, agentUpdates: 1, perception: 2, revealMap: 3, reachability: 4, worldRender: 5 };
    const metrics = performanceMonitor.getSnapshot()
      .sort((a, b) => (priority[a.key] ?? 99) - (priority[b.key] ?? 99));
    ui.performanceContent.replaceChildren();

    if (!metrics.length) {
      const empty = document.createElement('div');
      empty.className = 'performance-empty';
      empty.textContent = 'WAITING FOR TIMING SAMPLES';
      ui.performanceContent.append(empty);
      return;
    }

    for (const metric of metrics) {
      const row = document.createElement('div');
      row.className = `performance-row ${metric.key === 'simulationTick' ? 'total' : ''}`;
      const values = [
        metric.label,
        formatMilliseconds(metric.latest),
        formatMilliseconds(metric.average),
        formatMilliseconds(metric.maximum),
        metric.callCount.toLocaleString()
      ];
      values.forEach((value, index) => {
        const cell = document.createElement('span');
        if (index === 1) cell.className = 'performance-now';
        cell.textContent = value;
        row.append(cell);
      });
      ui.performanceContent.append(row);
    }
  }

  function renderReachabilityStatus() {
    const age = Math.max(0, world.elapsed - world.lastReachabilityUpdate);
    const objectTarget = world.reachabilityCheckUnits ? 'UNITS' : 'GUARDS';
    const algorithm = world.reachabilityAlgorithm === 'graph' ? 'GRAPH' : 'GROUND TRUTH';
    const mode = world.reachabilityMode === 'objects' ? `${objectTarget} · ${algorithm}` : 'GRID';
    const schedule = world.reachabilityAuto ? `EVERY ${world.reachabilityInterval.toFixed(1)}s` : 'MANUAL';
    ui.reachabilityAlgorithm.disabled = world.reachabilityMode !== 'objects';
    ui.reachabilityInterval.disabled = !world.reachabilityAuto;
    ui.reachabilityStatus.textContent = `${mode} · ${schedule} · LAST ${age.toFixed(1)}s AGO`;
  }

  function renderUI() {
    renderer.selectedId = selectedId;
    uiController.renderUI(world, selectedId, events);
    if (perceptionDebugEnabled) renderPerceptionDebug();
    ui.clock.textContent = window.formatTime(world.elapsed);
    ui.status.textContent = world.units.some(unit => unit.alive && unit.perceivedEnemies.length) ? 'Contact confirmed · engagements active' : 'Agents are acquiring targets';
    ui.playLabel.textContent = world.paused ? 'Resume' : 'Pause';
    ui.playIcon.textContent = world.paused ? '▶' : 'Ⅱ';
    renderReachabilityStatus();
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => ui.toast.classList.remove('visible'), 1800);
  }

  function updateWorldSizeUI() {
    const size = WORLD_SIZES[world.sizeKey];
    const standardSelected = world.sizeKey === 'standard';
    ui.worldSizeStandard.classList.toggle('active', standardSelected);
    ui.worldSizeStandard.setAttribute('aria-selected', String(standardSelected));
    ui.worldSizeStandard.tabIndex = standardSelected ? 0 : -1;
    ui.worldSizeXl.classList.toggle('active', !standardSelected);
    ui.worldSizeXl.setAttribute('aria-selected', String(!standardSelected));
    ui.worldSizeXl.tabIndex = standardSelected ? -1 : 0;
    ui.worldSizeValue.innerHTML = `${size.width} × ${size.depth} <i>m</i>`;
  }

  function switchWorldSize(sizeKey) {
    if (sizeKey === world.sizeKey) return;
    world.setSize(sizeKey);
    selectedId = world.units[0]?.id ?? null;
    selectedLevelId = null;
    events = [];
    ui.levelNameInput.value = '';
    setActiveTool(null, null, false);
    camera.fit();
    setZoom(camera.zoom);
    updateWorldSizeUI();
    refreshLevelLibrary(null);
    const size = WORLD_SIZES[sizeKey];
    addEvent(`New ${size.label} simulation started · ${size.width} × ${size.depth} m`, 'info');
    renderUI();
    showToast(`NEW ${size.label.toUpperCase()} SIMULATION`);
  }

  function refreshLevelLibrary(preferredId = selectedLevelId) {
    let levels;
    try {
      levels = levelStorage.listLevels(world.sizeKey);
    } catch (error) {
      console.warn('Unable to read saved levels', error);
      showToast('LEVEL STORAGE UNAVAILABLE');
      levels = [];
    }

    const placeholder = new Option(levels.length ? 'Select a saved level' : 'No saved levels', '');
    ui.savedLevelSelect.replaceChildren(placeholder);
    for (const level of levels) {
      const option = new Option(`${level.isDefault ? '★ ' : ''}${level.name}`, level.id);
      ui.savedLevelSelect.append(option);
    }

    const selected = levels.find(level => level.id === preferredId) ?? null;
    selectedLevelId = selected?.id ?? null;
    ui.savedLevelSelect.value = selectedLevelId ?? '';
    ui.loadLevelButton.disabled = !selected;
    ui.defaultLevelButton.disabled = !selected;
    ui.deleteLevelButton.disabled = !selected;
    ui.defaultLevelButton.textContent = selected?.isDefault ? 'CLEAR DEFAULT' : 'SET DEFAULT';
    ui.defaultLevelButton.dataset.default = String(Boolean(selected?.isDefault));
    if (selected) ui.levelNameInput.value = selected.name;
    return levels;
  }

  function loadLevelRecord(record, message) {
    world.reset();
    world.applyLevel(record.save);
    selectedLevelId = record.id;
    selectedId = world.units[0]?.id ?? null;
    events = [];
    setActiveTool(null, null, false);
    refreshLevelLibrary(record.id);
    addEvent(message, 'info');
    renderUI();
  }

  function loadDefaultLevelOnReset() {
    let defaultLevel = null;
    try {
      defaultLevel = levelStorage.getDefaultLevel(world.sizeKey);
    } catch (error) {
      console.warn('Unable to load the default level', error);
      showToast('DEFAULT LEVEL UNAVAILABLE');
    }
    world.reset();
    if (defaultLevel) world.applyLevel(defaultLevel.save);
    selectedLevelId = defaultLevel?.id ?? null;
    return defaultLevel;
  }

  function setZoom(value, anchorPoint = null) {
    const anchorWorld = anchorPoint ? camera.screenToWorld(anchorPoint) : null;
    camera.zoom = window.clamp(value, camera.getFitZoom() * 0.55, 2.4);
    if (anchorWorld) {
      const anchoredScreen = camera.worldToScreen(anchorWorld);
      camera.offsetX += anchorPoint.x - anchoredScreen.x;
      camera.offsetY += anchorPoint.y - anchoredScreen.y;
    }
    ui.zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
  }
  function updateCameraFromKeyboard(delta) {
    const horizontal = (cameraMovementKeys.has('KeyA') ? 1 : 0) - (cameraMovementKeys.has('KeyD') ? 1 : 0);
    const vertical = (cameraMovementKeys.has('KeyW') ? 1 : 0) - (cameraMovementKeys.has('KeyS') ? 1 : 0);
    if (!horizontal && !vertical) return;
    const length = Math.hypot(horizontal, vertical);
    const distance = 420 * delta;
    camera.offsetX += horizontal / length * distance;
    camera.offsetY += vertical / length * distance;
  }


  function setFogOfWarTeam(team) {
    renderer.showFog = team !== FOG.OFF;
    renderer.fogOfWarTeam = team;
    document.querySelector('#fogOffButton').classList.toggle('active', team === FOG.OFF);
    document.querySelector('#fogEmberButton').classList.toggle('active', team === TEAMS.EMBER);
    document.querySelector('#fogTideButton').classList.toggle('active', team === TEAMS.TIDE);
  }

  function setView(view) {
    camera.view = view;
    ui.topViewButton.classList.toggle('active', view === 'top');
    ui.isoViewButton.classList.toggle('active', view === 'iso');
    ui.viewEyebrow.textContent = view === 'iso' ? 'ISOMETRIC WORLD' : 'TOP-DOWN WORLD';
    ui.canvasHelp.classList.toggle('isometric', view === 'iso');
    ui.coordinates.textContent = 'X  —  ·  Z  —';
  }

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function clampToArena(point) {
    return { x: window.clamp(point.x, 3, world.width - 3), z: window.clamp(point.z, 3, world.depth - 3) };
  }

  function setActiveTool(tool, team = null, announce = true) {
    pendingGuardVariant = tool === TOOL.MACHINE_GUN ? 'machineGun' : 'guard';
    if (tool === TOOL.MACHINE_GUN) tool = TOOL.GUARD;
    activeTool = tool;
    renderer.pendingGuardVariant = pendingGuardVariant;
    pendingGuardTeam = tool === TOOL.GUARD ? team : FOG.OFF;
    renderer.manualStart = null;
    renderer.pendingGuardPoint = null;
    renderer.pendingObstaclePoint = null;
    renderer.pendingGuardTeam = pendingGuardTeam;
    const savedHeading = tool === TOOL.GUARD && team ? lastGuardHeadingByTeam[team] : null;
    renderer.pendingGuardHeading = savedHeading ?? 0;
    renderer.pendingGuardHeadingManual = savedHeading !== null;
    ui.traceButton.setAttribute('aria-pressed', String(tool === TOOL.TRACE));
    ui.traceHint.hidden = tool !== TOOL.TRACE;
    ui.traceHint.textContent = 'SELECT TRACE START POINT';
    ui.buildGuardPointEmber.setAttribute('aria-pressed', String(tool === TOOL.GUARD && pendingGuardVariant === 'guard' && team === TEAMS.EMBER));
    ui.buildGuardPointTide.setAttribute('aria-pressed', String(tool === TOOL.GUARD && pendingGuardVariant === 'guard' && team === TEAMS.TIDE));
    for (const team of [TEAMS.EMBER, TEAMS.TIDE]) {
      document.querySelector(`#buildMachineGun${team}`).setAttribute('aria-pressed', String(tool === TOOL.GUARD && pendingGuardVariant === 'machineGun' && pendingGuardTeam === team));
    }
    ui.buildObstacle.setAttribute('aria-pressed', String(tool === TOOL.OBSTACLE));
    const teamLabel = team ? HEADQUARTERS[team].label.replace(' HQ', '').toUpperCase() : '';
    ui.buildHint.textContent = tool === TOOL.GUARD
      ? `CLICK TO PLACE ${teamLabel} ${pendingGuardVariant === 'machineGun' ? 'MACHINE GUN' : 'GUARD POINT'} · SCROLL TO ROTATE · RIGHT-CLICK TO CANCEL`
      : tool === TOOL.OBSTACLE ? 'CLICK TO PLACE 12 × 12 M OBSTACLES · RIGHT-CLICK TO CANCEL' : 'Select an item, click the map to place it';
    if (!announce) return;
    if (tool === TOOL.TRACE) showToast('LINE TRACE · SELECT START POINT');
    if (tool === TOOL.GUARD) showToast(`${teamLabel} ${pendingGuardVariant === 'machineGun' ? 'MACHINE GUN' : 'GUARD POINT'} · CLICK TO PLACE`);
    if (tool === TOOL.OBSTACLE) showToast('OBSTACLE · CLICK TO PLACE');
  }

  function handleCanvasClick(point) {
    const worldPoint = camera.screenToWorld(point);
    if (activeTool === TOOL.TRACE) {
      if (!renderer.manualStart) {
        renderer.manualStart = worldPoint;
        ui.traceHint.textContent = 'SELECT TRACE END POINT';
      } else {
        const result = world.trace(renderer.manualStart, worldPoint, null, TRACE.MANUAL);
        setActiveTool(null);
        if (result.hit) {
          showToast(`TRACE HIT ${result.hit.label} · ${result.hit.health.toFixed(0)} HP`);
          addEvent(`Manual trace hit <strong>${result.hit.label}</strong>`, EVENT.TRACE);
        } else if (result.obstacle) {
          showToast(`TRACE BLOCKED · OBSTACLE ${String(result.obstacle.id).padStart(2, '0')}`);
          addEvent(`Manual trace blocked by obstacle #${result.obstacle.id}`, EVENT.TRACE);
        } else {
          showToast('TRACE COMPLETE · NO HIT');
          addEvent('Manual line trace completed · no hit', EVENT.TRACE);
        }
      }
      return;
    }

    if (activeTool === TOOL.OBSTACLE) {
      const obstacle = world.addObstacle(worldPoint);
      if (!obstacle) {
        showToast('OBSTACLE CANNOT BE PLACED HERE');
      } else {
        showToast(`OBSTACLE ${String(obstacle.id).padStart(2, '0')} PLACED`);
        addEvent(`Obstacle #${obstacle.id} placed at (${obstacle.position.x.toFixed(0)}, ${obstacle.position.z.toFixed(0)})`, 'info');
      }
      setActiveTool(TOOL.OBSTACLE, null, false);
      return;
    }

    if (activeTool === TOOL.GUARD) {
      const team = pendingGuardTeam;
      const heading = renderer.pendingGuardHeading;
      const pointResult = world.addGuardPoint(clampToArena(worldPoint), team, heading, pendingGuardVariant);
      if (!pointResult) {
        showToast('GUARD POINT CANNOT BE PLACED INSIDE AN OBSTACLE');
        return;
      }
      lastGuardHeadingByTeam[team] = heading;
      showToast(`${pendingGuardVariant === 'machineGun' ? 'MACHINE GUN' : 'GUARD POINT'} PLACED · ${HEADQUARTERS[pointResult.team].label.toUpperCase()}`);
      setActiveTool(pendingGuardVariant === 'machineGun' ? TOOL.MACHINE_GUN : TOOL.GUARD, team, false);
      return;
    }

    const unit = renderer.pickUnit(point);
    if (unit) {
      selectedId = unit.id;
      renderUI();
    }
  }

  world.onEvent = addEvent;
  window.addEventListener('resize', () => renderer.resize());
  new ResizeObserver(() => renderer.resize()).observe(canvas);
  renderer.resize();
  updateWorldSizeUI();
  refreshLevelLibrary();
  renderUI();
  uiController.renderEvents(events);

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    ui.themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
    ui.themeToggleIcon.textContent = theme === 'dark' ? '☾' : '☀';
    renderer.refreshTheme();
  }

  applyTheme(localStorage.getItem('fieldwork-theme') === 'light' ? 'light' : 'dark');
  ui.themeToggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('fieldwork-theme', nextTheme);
    applyTheme(nextTheme);
  });

  ui.worldSizeStandard.addEventListener('click', () => switchWorldSize('standard'));
  ui.worldSizeXl.addEventListener('click', () => switchWorldSize('xl'));
  document.querySelector('#playButton').addEventListener('click', () => {
    world.paused = !world.paused;
    renderUI();
  });

  document.querySelector('#resetButton').addEventListener('click', () => {
    const defaultLevel = loadDefaultLevelOnReset();
    setActiveTool(null, null, false);
    selectedId = world.units[0].id;
    events = [];
    refreshLevelLibrary(defaultLevel?.id ?? null);
    addEvent(defaultLevel ? `Simulation reset · default level <strong>${defaultLevel.name}</strong> loaded` : 'Simulation reset · four agents deployed at HQ', 'info');
    renderUI();
    showToast(defaultLevel ? `RESET · ${defaultLevel.name.toUpperCase()}` : 'SIMULATION RESET');
  });

  let spawnType = BEHAVIOR.MOVEMENT.ROAM;
  function setSpawnType(type) {
    spawnType = type;
    document.querySelector('#spawnTypeRoam').classList.toggle('active', type === BEHAVIOR.MOVEMENT.ROAM);
    document.querySelector('#spawnTypeGuard').classList.toggle('active', type === BEHAVIOR.MOVEMENT.GUARD);
    document.querySelector('#spawnTypeScout').classList.toggle('active', type === BEHAVIOR.MOVEMENT.SCOUT);
  }

  function spawnUnit(team) {
    const unit = world.addUnit(team);
    world.setMovementBehavior(unit, spawnType);
    selectedId = unit.id;
    renderUI();
    showToast(`${unit.label.toUpperCase()} DEPLOYED · ${MOVEMENT_BEHAVIORS[spawnType].label.toUpperCase()}`);
  }

  document.querySelector('#spawnEmberButton').addEventListener('click', () => spawnUnit(TEAMS.EMBER));
  document.querySelector('#spawnTideButton').addEventListener('click', () => spawnUnit(TEAMS.TIDE));
  document.querySelector('#spawnTypeRoam').addEventListener('click', () => setSpawnType(BEHAVIOR.MOVEMENT.ROAM));
  document.querySelector('#spawnTypeGuard').addEventListener('click', () => setSpawnType(BEHAVIOR.MOVEMENT.GUARD));
  document.querySelector('#spawnTypeScout').addEventListener('click', () => setSpawnType(BEHAVIOR.MOVEMENT.SCOUT));
  ui.traceButton.addEventListener('click', () => setActiveTool(activeTool === TOOL.TRACE ? null : TOOL.TRACE));
  for (const team of [TEAMS.EMBER, TEAMS.TIDE]) {
    document.querySelector(`#buildMachineGun${team}`).addEventListener('click', () => setActiveTool(activeTool === TOOL.GUARD && pendingGuardTeam === team && pendingGuardVariant === 'machineGun' ? null : TOOL.MACHINE_GUN, team));
  }
  ui.buildGuardPointEmber.addEventListener('click', () => setActiveTool(activeTool === TOOL.GUARD && pendingGuardTeam === TEAMS.EMBER && pendingGuardVariant === 'guard' ? null : TOOL.GUARD, TEAMS.EMBER));
  ui.buildGuardPointTide.addEventListener('click', () => setActiveTool(activeTool === TOOL.GUARD && pendingGuardTeam === TEAMS.TIDE && pendingGuardVariant === 'guard' ? null : TOOL.GUARD, TEAMS.TIDE));
  ui.buildObstacle.addEventListener('click', () => setActiveTool(activeTool === TOOL.OBSTACLE ? null : TOOL.OBSTACLE));
  ui.savedLevelSelect.addEventListener('change', () => {
    selectedLevelId = ui.savedLevelSelect.value || null;
    if (selectedLevelId) refreshLevelLibrary(selectedLevelId);
    else {
      ui.levelNameInput.value = '';
      refreshLevelLibrary(null);
    }
  });
  ui.newLevelButton.addEventListener('click', () => {
    selectedLevelId = null;
    ui.savedLevelSelect.value = '';
    ui.levelNameInput.value = '';
    ui.loadLevelButton.disabled = true;
    ui.defaultLevelButton.disabled = true;
    ui.deleteLevelButton.disabled = true;
    ui.defaultLevelButton.textContent = 'SET DEFAULT';
    ui.defaultLevelButton.dataset.default = 'false';
    ui.levelNameInput.focus();
  });
  ui.saveLevelButton.addEventListener('click', () => {
    try {
      const saved = levelStorage.saveLevel(ui.levelNameInput.value, world.captureLevel(), selectedLevelId);
      selectedLevelId = saved.id;
      refreshLevelLibrary(saved.id);
      addEvent(`Level <strong>${saved.name}</strong> saved · obstacles and guard points`, 'info');
      showToast(`LEVEL SAVED · ${saved.name.toUpperCase()}`);
    } catch (error) {
      console.warn('Unable to save level', error);
      showToast(error.message.toUpperCase());
    }
  });
  ui.loadLevelButton.addEventListener('click', () => {
    if (!selectedLevelId) return;
    try {
      const level = levelStorage.getLevel(selectedLevelId);
      if (!level) throw new Error('Saved level not found');
      loadLevelRecord(level, `Level <strong>${level.name}</strong> loaded`);
      showToast(`LEVEL LOADED · ${level.name.toUpperCase()}`);
    } catch (error) {
      console.warn('Unable to load level', error);
      showToast(error.message.toUpperCase());
    }
  });
  ui.defaultLevelButton.addEventListener('click', () => {
    if (!selectedLevelId) return;
    try {
      const selected = levelStorage.listLevels(world.sizeKey).find(level => level.id === selectedLevelId);
      levelStorage.setDefaultLevel(selected?.isDefault ? null : selectedLevelId, world.sizeKey);
      refreshLevelLibrary(selectedLevelId);
      showToast(selected?.isDefault ? 'DEFAULT LEVEL CLEARED' : 'DEFAULT LEVEL SET');
    } catch (error) {
      console.warn('Unable to set default level', error);
      showToast(error.message.toUpperCase());
    }
  });
  ui.deleteLevelButton.addEventListener('click', () => {
    if (!selectedLevelId) return;
    try {
      const level = levelStorage.listLevels(world.sizeKey).find(candidate => candidate.id === selectedLevelId);
      if (!level || !window.confirm(`Delete saved level “${level.name}”?`)) return;
      levelStorage.deleteLevel(selectedLevelId);
      selectedLevelId = null;
      ui.levelNameInput.value = '';
      refreshLevelLibrary(null);
      showToast('LEVEL DELETED');
    } catch (error) {
      console.warn('Unable to delete level', error);
      showToast(error.message.toUpperCase());
    }
  });
  ui.levelNameInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') ui.saveLevelButton.click();
  });
  ui.rosterToggleButton.addEventListener('click', () => {
    const expanded = ui.rosterToggleButton.getAttribute('aria-expanded') !== 'true';
    ui.rosterToggleButton.setAttribute('aria-expanded', String(expanded));
    ui.rosterToggleIcon.textContent = expanded ? '▾' : '▸';
    ui.roster.hidden = !expanded;
    if (expanded) renderUI();
  });
  document.querySelector('#rangesToggle').addEventListener('change', event => { renderer.showRanges = event.target.checked; });
  document.querySelector('#sightToggle').addEventListener('change', event => { renderer.showSight = event.target.checked; });
  document.querySelector('#pathsToggle').addEventListener('change', event => { renderer.showPaths = event.target.checked; });
  ui.reachabilityToggle.addEventListener('change', event => { renderer.showReachability = event.target.checked; });
  ui.reachabilityGraphToggle.addEventListener('change', event => { renderer.showReachabilityGraph = event.target.checked; });
  ui.reachabilityMethod.addEventListener('change', event => {
    world.setReachabilityMode(event.target.value);
    renderReachabilityStatus();
    const target = world.reachabilityCheckUnits ? 'UNITS' : 'GUARD POINTS';
    showToast(`REACHABILITY · ${world.reachabilityMode === 'objects' ? target : 'GRID'}`);
  });
  ui.reachabilityAlgorithm.addEventListener('change', event => {
    world.setReachabilityAlgorithm(event.target.value);
    renderReachabilityStatus();
    if (performancePanelEnabled) renderPerformancePanel();
    showToast(`REACHABILITY ALGORITHM · ${world.reachabilityAlgorithm === 'graph' ? 'GUARD GRAPH' : 'GROUND TRUTH'}`);
  });
  ui.reachabilityCheckUnits.addEventListener('change', event => {
    world.setReachabilityCheckUnits(event.target.checked);
    renderReachabilityStatus();
    if (performancePanelEnabled) renderPerformancePanel();
    showToast(`REACHABILITY TARGET · ${world.reachabilityCheckUnits ? 'UNITS' : 'GUARD POINTS'}`);
  });
  ui.reachabilityAuto.addEventListener('change', event => {
    world.reachabilityAuto = event.target.checked;
    renderReachabilityStatus();
    showToast(world.reachabilityAuto ? 'REACHABILITY AUTO TICK ENABLED' : 'REACHABILITY MANUAL MODE');
  });
  ui.reachabilityInterval.addEventListener('change', event => {
    world.setReachabilityInterval(event.target.value);
    event.target.value = String(world.reachabilityInterval);
    renderReachabilityStatus();
  });
  ui.runReachabilityButton.addEventListener('click', () => {
    world.updateReachability();
    renderReachabilityStatus();
    if (performancePanelEnabled) renderPerformancePanel();
    showToast('REACHABILITY CHECK COMPLETE');
  });
  ui.navigationGridButton.addEventListener('click', () => {
    renderer.showNavigationGrid = !renderer.showNavigationGrid;
    ui.navigationGridButton.classList.toggle('active', renderer.showNavigationGrid);
    ui.navigationGridButton.setAttribute('aria-pressed', String(renderer.showNavigationGrid));
    const unit = world.units.find(candidate => candidate.id === selectedId && candidate.alive) ?? world.units.find(candidate => candidate.alive);
    if (renderer.showNavigationGrid) showToast(`NAV GRID · ${(unit?.navigationRadius ?? 0).toFixed(1)} M RADIUS`);
  });
  ui.perceptionDebugButton.addEventListener('click', () => {
    perceptionDebugEnabled = !perceptionDebugEnabled;
    ui.perceptionDebugButton.classList.toggle('active', perceptionDebugEnabled);
    ui.perceptionDebugButton.setAttribute('aria-pressed', String(perceptionDebugEnabled));
    ui.perceptionDebugPanel.hidden = !perceptionDebugEnabled;
    if (perceptionDebugEnabled) {
      renderPerceptionDebug();
      showToast('PERCEPTION DEBUG ENABLED');
    } else {
      ui.perceptionDebugContent.replaceChildren();
    }
  });
  ui.performanceButton.addEventListener('click', () => {
    performancePanelEnabled = !performancePanelEnabled;
    ui.performanceButton.classList.toggle('active', performancePanelEnabled);
    ui.performanceButton.setAttribute('aria-pressed', String(performancePanelEnabled));
    ui.performancePanel.hidden = !performancePanelEnabled;
    performancePanelAccumulator = 0;
    if (performancePanelEnabled) {
      renderPerformancePanel();
      showToast('PERFORMANCE PANEL ENABLED');
    }
  });
  document.querySelector('#fogHideToggle').addEventListener('change', event => { renderer.fogHideInvisible = event.target.checked; });
  document.querySelector('#fogOffButton').addEventListener('click', () => setFogOfWarTeam(null));
  document.querySelector('#fogEmberButton').addEventListener('click', () => setFogOfWarTeam(TEAMS.EMBER));
  document.querySelector('#fogTideButton').addEventListener('click', () => setFogOfWarTeam(TEAMS.TIDE));
  document.querySelector('#zoomOutButton').addEventListener('click', () => setZoom(camera.zoom / 1.2));
  document.querySelector('#zoomInButton').addEventListener('click', () => setZoom(camera.zoom * 1.2));
  document.querySelector('#fitButton').addEventListener('click', () => { camera.fit(); setZoom(camera.zoom); });
  ui.topViewButton.addEventListener('click', () => setView('top'));
  ui.isoViewButton.addEventListener('click', () => setView('iso'));
  ui.rotateLeftButton.addEventListener('click', () => camera.rotate(-1));
  ui.rotateRightButton.addEventListener('click', () => camera.rotate(1));
  ui.timeScaleSlider.addEventListener('input', event => {
    world.timeScale = Number(event.target.value);
    const label = `${world.timeScale.toFixed(2).replace(/\.?0+$/, '')}×`;
    ui.timeScaleValue.value = label;
    ui.timeScaleSlider.setAttribute('aria-valuetext', `${label} simulation speed`);
  });
  ui.accuracySlider.addEventListener('input', event => {
    const value = Number(event.target.value);
    if (!Number.isFinite(value)) return;
    GLOBAL_ACCURACY.maxDeviationDegrees = value;
    ui.accuracyValue.value = `±${value}°`;
    ui.accuracySlider.setAttribute('aria-valuetext', `±${value}° cone of fire`);
  });

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    pointerDown = { point: canvasPoint(event), x: event.clientX, y: event.clientY, dragged: false };
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', event => {
    const point = canvasPoint(event);
    const worldPoint = camera.screenToWorld(point);
    renderer.cursorWorld = worldPoint;
    if (activeTool === TOOL.OBSTACLE) renderer.pendingObstaclePoint = world.snapObstaclePosition(worldPoint);
    if (activeTool === TOOL.GUARD) {
      renderer.pendingGuardPoint = clampToArena(worldPoint);
      if (!renderer.pendingGuardHeadingManual) {
        const center = { x: world.width / 2, z: world.depth / 2 };
        renderer.pendingGuardHeading = Math.atan2(renderer.pendingGuardPoint.z - center.z, renderer.pendingGuardPoint.x - center.x);
      }
    }
    ui.coordinates.textContent = `X ${worldPoint.x.toFixed(1)}  ·  Z ${worldPoint.z.toFixed(1)}`;
    if (pointerDown && (Math.abs(event.clientX - pointerDown.x) > 3 || Math.abs(event.clientY - pointerDown.y) > 3)) pointerDown.dragged = true;
    if (pointerDown?.dragged) {
      camera.offsetX += event.clientX - pointerDown.x;
      camera.offsetY += event.clientY - pointerDown.y;
      pointerDown.x = event.clientX;
      pointerDown.y = event.clientY;
    }
  });

  window.addEventListener('keydown', event => {
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
    cameraMovementKeys.add(event.code);
    event.preventDefault();
  });
  window.addEventListener('keyup', event => {
    cameraMovementKeys.delete(event.code);
  });
  window.addEventListener('blur', () => {
    cameraMovementKeys.clear();
  });

  canvas.addEventListener('pointerup', event => {
    if (pointerDown && !pointerDown.dragged) handleCanvasClick(canvasPoint(event));
    pointerDown = null;
  });

  canvas.addEventListener('pointercancel', () => { pointerDown = null; });
  canvas.addEventListener('contextmenu', event => {
    if (!activeTool) return;
    event.preventDefault();
    setActiveTool(null);
    showToast('CANCELLED');
  });
  canvas.addEventListener('pointerleave', () => {
    if (!pointerDown) ui.coordinates.textContent = 'X  —  ·  Z  —';
  });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (activeTool === TOOL.GUARD) {
      renderer.pendingGuardHeadingManual = true;
      const step = (Math.PI / 18) * (event.deltaY < 0 ? 1 : -1);
      renderer.pendingGuardHeading = (renderer.pendingGuardHeading + step + Math.PI * 2) % (Math.PI * 2);
      return;
    }
    setZoom(camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), canvasPoint(event));
  }, { passive: false });

  function animate(now) {
    const delta = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    performanceMonitor.measure('simulationTick', 'Total simulation tick', () => world.update(delta * world.timeScale));
    updateCameraFromKeyboard(delta);
    performanceMonitor.measure('worldRender', 'World render', () => renderer.draw());
    uiAccumulator += delta;
    if (uiAccumulator >= 0.12) {
      renderUI();
      uiAccumulator = 0;
    }
    performancePanelAccumulator += delta;
    if (performancePanelEnabled && performancePanelAccumulator >= 0.25) {
      renderPerformancePanel();
      performancePanelAccumulator = 0;
    }
    if (now - lastRender > 950) {
      document.querySelector('#frameRate').textContent = `${Math.round(1 / Math.max(delta, 0.001))} FPS`;
      lastRender = now;
    }
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
})();
