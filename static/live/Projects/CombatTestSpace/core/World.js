(function (global) {
  const { TEAM: TEAMS, BEHAVIOR, STATE, TRACE, EVENT } = global.GAME_CONSTANTS;
  const TEAM = global.TEAM;
  const HEADQUARTERS = global.HEADQUARTERS;
  const TARGET_BEHAVIORS = global.TARGET_BEHAVIORS;
  const COMBAT_BEHAVIORS = global.COMBAT_BEHAVIORS;
  const MOVEMENT_BEHAVIORS = global.MOVEMENT_BEHAVIORS;
  const COMBAT_CONFIG = global.COMBAT_CONFIG;
  const PERCEPTION_CONFIG = global.PERCEPTION_CONFIG;
  const Unit = global.Unit;
  const NavigationSystem = global.NavigationSystem;
  const CombatProcessor = global.CombatProcessor;
  const ReachabilityGraph = global.ReachabilityGraph;
  const OBSTACLE_SIZE = global.OBSTACLE_SIZE;
  const REACHABILITY_AGENT_RADIUS = 2;
  const REACHABILITY_MAX_EXPLORED_NODES = 2000;

  class World {
    constructor(performanceMonitor = null) {
      this.performanceMonitor = performanceMonitor;
      this.units = [];
      this.traces = [];
      this.guardPoints = [];
      this.obstacles = [];
      this.nextGuardPointId = 1;
      this.nextObstacleId = 1;
      this.obstacleRevision = 0;
      this.configureSize('standard');
      this.navigation = new NavigationSystem(this.width, this.depth, 4);
      this.revealByTeam = { Ember: new Set(), Tide: new Set() };
      this.reachabilityByTeam = { Ember: new Set(), Tide: new Set() };
      this.reachabilityByObject = new Map();
      this.reachabilityMode = 'objects';
      this.reachabilityAlgorithm = 'groundTruth';
      this.reachabilityGraph = new ReachabilityGraph({ maxExploredNodes: REACHABILITY_MAX_EXPLORED_NODES });
      this.reachabilityGraphConnections = [];
      this.reachabilityGraphStats = { neighborChecks: 0, headquartersChecks: 0 };
      this.reachabilityCheckUnits = false;
      this.reachabilityAuto = true;
      this.reachabilityInterval = 1;
      this.lastReachabilityUpdate = 0;
      this.elapsed = 0;
      this.timeScale = 1;
      this.paused = false;
      this.nextId = 1;
      this.lastPerceptionUpdate = 0;
      this.onEvent = () => {};
      this.reset();
    }

    configureSize(sizeKey) {
      const size = global.WORLD_SIZES[sizeKey];
      if (!size) throw new Error(`Unknown world size: ${sizeKey}`);
      this.sizeKey = sizeKey;
      this.width = size.width;
      this.depth = size.depth;
      HEADQUARTERS[TEAMS.EMBER].position.x = size.width / 12;
      HEADQUARTERS[TEAMS.EMBER].position.z = size.depth / 2;
      HEADQUARTERS[TEAMS.TIDE].position.x = size.width * 11 / 12;
      HEADQUARTERS[TEAMS.TIDE].position.z = size.depth / 2;
      return size;
    }

    setSize(sizeKey) {
      const size = this.configureSize(sizeKey);
      this.navigation = new NavigationSystem(size.width, size.depth, 4);
      this.reset();
    }

    reset() {
      this.units = [];
      this.traces = [];
      this.guardPoints = [];
      this.obstacles = [];
      this.reachabilityGraphConnections = [];
      this.reachabilityGraphStats = { neighborChecks: 0, headquartersChecks: 0 };
      this.nextGuardPointId = 1;
      this.nextObstacleId = 1;
      this.obstacleRevision++;
      this.revealByTeam = { Ember: new Set(), Tide: new Set() };
      this.reachabilityByObject = new Map();
      this.elapsed = 0;
      this.lastPerceptionUpdate = 0;
      this.nextId = 1;
      for (let index = 0; index < 2; index++) {
        this.addUnit(TEAMS.EMBER, undefined, false);
        this.addUnit(TEAMS.TIDE, undefined, false);
      }
      this.updateReachability();
      this.updateRevealMap();
      this.updatePerception();
    }

    addUnit(team = this.units.length % 2 === 0 ? TEAMS.EMBER : TEAMS.TIDE, position, announce = true) {
      const count = this.units.filter(unit => unit.team === team).length + 1;
      const headquarters = HEADQUARTERS[team].position;
      const spawn = position || {
        x: headquarters.x + (team === TEAMS.EMBER ? 1 : -1) * Math.random() * 4,
        y: 0,
        z: headquarters.z + (Math.random() - 0.5) * 9
      };
      const unit = new Unit(this.nextId++, team, spawn, `${team} ${String(count).padStart(2, '0')}`);
      this.units.push(unit);
      if (announce) this.onEvent(`${unit.label} deployed at ${HEADQUARTERS[team].label}`, 'info');
      return unit;
    }

    resetCombatCycle(unit) {
      unit.combatState = STATE.COMBAT.APPROACH;
      unit.stateTimer = 0;
      unit.shotsRemaining = 0;
      unit.shotTimer = 0;
      unit.hitsThisBurst = 0;
      this.clearPath(unit);
    }

    selectRoamDestination(unit) {
      unit.moveDestination = {
        x: 7 + Math.random() * (this.width - 14),
        z: 7 + Math.random() * (this.depth - 14)
      };
      unit.moveState = STATE.MOVEMENT.MOVING;
      unit.moveWaitRemaining = 0;
    }

    selectGuardWanderDestination(unit) {
      const headquarters = HEADQUARTERS[unit.team].position;
      unit.moveDestination = {
        x: window.clamp(headquarters.x + (Math.random() - 0.5) * 22, 4, this.width - 4),
        z: window.clamp(headquarters.z + (Math.random() - 0.5) * 22, 4, this.depth - 4)
      };
      unit.moveState = STATE.MOVEMENT.MOVING;
      unit.moveWaitRemaining = 0;
    }

    addGuardPoint(position, team, heading, variant = 'guard') {
      if (this.obstacles.some(obstacle => Math.abs(position.x - obstacle.position.x) <= obstacle.width / 2 && Math.abs(position.z - obstacle.position.z) <= obstacle.depth / 2)) return null;
      if (heading === undefined) {
        const center = { x: this.width / 2, z: this.depth / 2 };
        heading = Math.atan2(position.z - center.z, position.x - center.x);
      }
      const point = { id: this.nextGuardPointId++, variant, team, teamId: TEAM[team].id, position: { x: position.x, y: 0, z: position.z }, heading, claimedBy: null };
      this.guardPoints.push(point);
      this.onEvent(`${variant === 'machineGun' ? 'Machine gun' : 'Guard point'} #${point.id} placed for ${HEADQUARTERS[team].label} at (${position.x.toFixed(1)}, ${position.z.toFixed(1)})`, 'info');
      return point;
    }

    claimGuardPoint(unit) {
      const point = this.guardPoints.find(candidate => candidate.claimedBy === null && candidate.teamId === unit.teamId);
      if (!point) return null;
      point.claimedBy = unit.id;
      unit.guardPointId = point.id;
      unit.moveDestination = { x: point.position.x, z: point.position.z };
      unit.moveState = STATE.MOVEMENT.MOVING;
      unit.moveWaitRemaining = 0;
      return point;
    }

    releaseGuardPoint(unit) {
      if (unit.guardPointId === null) return;
      const point = this.guardPoints.find(candidate => candidate.id === unit.guardPointId);
      if (point && point.claimedBy === unit.id) point.claimedBy = null;
      unit.guardPointId = null;
      unit.machineGunState = null;
    }

    snapObstaclePosition(position) {
      const halfSize = OBSTACLE_SIZE / 2;
      return {
        x: window.clamp(Math.round((position.x - this.navigation.cellSize / 2) / this.navigation.cellSize) * this.navigation.cellSize + this.navigation.cellSize / 2, halfSize, this.width - halfSize),
        z: window.clamp(Math.round((position.z - this.navigation.cellSize / 2) / this.navigation.cellSize) * this.navigation.cellSize + this.navigation.cellSize / 2, halfSize, this.depth - halfSize)
      };
    }

    addObstacle(position) {
      const snapped = this.snapObstaclePosition(position);
      if (!this.canPlaceObstacle(snapped)) return null;

      const obstacle = { id: this.nextObstacleId++, position: { x: snapped.x, y: 0, z: snapped.z }, width: OBSTACLE_SIZE, depth: OBSTACLE_SIZE };
      this.obstacles.push(obstacle);
      this.obstacleRevision++;
      for (const unit of this.units) this.clearPath(unit);
      this.updatePerception();
      return obstacle;
    }

    canPlaceObstacle(position) {
      const halfSize = OBSTACLE_SIZE / 2;
      if (position.x - halfSize < 0 || position.x + halfSize > this.width || position.z - halfSize < 0 || position.z + halfSize > this.depth) return false;
      if (this.obstacles.some(obstacle => Math.abs(position.x - obstacle.position.x) < halfSize + obstacle.width / 2 && Math.abs(position.z - obstacle.position.z) < halfSize + obstacle.depth / 2)) return false;
      if (this.units.some(unit => unit.alive && Math.abs(position.x - unit.position.x) < halfSize + unit.navigationRadius + 1 && Math.abs(position.z - unit.position.z) < halfSize + unit.navigationRadius + 1)) return false;
      if (this.guardPoints.some(point => Math.abs(position.x - point.position.x) < halfSize + 1 && Math.abs(position.z - point.position.z) < halfSize + 1)) return false;
      return !Object.values(HEADQUARTERS).some(headquarters => Math.abs(position.x - headquarters.position.x) < halfSize + 7 && Math.abs(position.z - headquarters.position.z) < halfSize + 7);
    }

    captureLevel() {
      return {
        worldSize: this.sizeKey,
        obstacles: this.obstacles.map(obstacle => ({
          id: obstacle.id,
          position: { x: obstacle.position.x, z: obstacle.position.z },
          width: obstacle.width,
          depth: obstacle.depth
        })),
        guardPoints: this.guardPoints.map(point => ({
          id: point.id,
          team: point.team,
          variant: point.variant,
          position: { x: point.position.x, z: point.position.z },
          heading: point.heading
        }))
      };
    }

    applyLevel(levelData) {
      if (levelData?.worldSize && levelData.worldSize !== this.sizeKey) {
        throw new Error('Saved level belongs to a different world size');
      }
      const obstacles = Array.isArray(levelData?.obstacles) ? levelData.obstacles : [];
      const guardPoints = Array.isArray(levelData?.guardPoints) ? levelData.guardPoints : [];
      this.obstacles = obstacles.map((obstacle, index) => {
        const width = Math.min(this.width, Math.max(0.1, Number(obstacle.width) || OBSTACLE_SIZE));
        const depth = Math.min(this.depth, Math.max(0.1, Number(obstacle.depth) || OBSTACLE_SIZE));
        return {
          id: index + 1,
          position: {
            x: window.clamp(Number(obstacle.position?.x) || 0, width / 2, this.width - width / 2),
            y: 0,
            z: window.clamp(Number(obstacle.position?.z) || 0, depth / 2, this.depth - depth / 2)
          },
          width,
          depth
        };
      });
      this.guardPoints = guardPoints.filter(point => TEAM[point.team]).map((point, index) => ({
        id: index + 1,
        team: point.team,
        variant: point.variant === 'machineGun' ? 'machineGun' : 'guard',
        teamId: TEAM[point.team].id,
        position: {
          x: window.clamp(Number(point.position?.x) || 0, 0, this.width),
          y: 0,
          z: window.clamp(Number(point.position?.z) || 0, 0, this.depth)
        },
        heading: Number(point.heading) || 0,
        claimedBy: null
      }));
      this.nextObstacleId = this.obstacles.length + 1;
      this.nextGuardPointId = this.guardPoints.length + 1;
      this.obstacleRevision++;
      this.updateReachability();
      for (const unit of this.units) {
        unit.guardPointId = null;
        unit.machineGunState = null;
        unit.moveDestination = null;
        unit.moveState = STATE.MOVEMENT.SELECTING;
        unit.moveWaitRemaining = 0;
        this.clearPath(unit);
      }
      this.updateRevealMap();
      this.updatePerception();
    }

    clearPath(unit) {
      this.navigation.clearPath(unit, this.obstacleRevision);
    }

    measurePerformance(key, label, callback) {
      if (this.performanceMonitor) return this.performanceMonitor.measure(key, label, callback);
      return callback();
    }

    setReachabilityMode(mode) {
      if (!['grid', 'objects'].includes(mode) || mode === this.reachabilityMode) return;
      this.reachabilityMode = mode;
      this.performanceMonitor?.clear('reachability');
      this.reachabilityByTeam = { Ember: new Set(), Tide: new Set() };
      this.reachabilityByObject = new Map();
      this.reachabilityGraphConnections = [];
      this.updateReachability();
    }

    setReachabilityAlgorithm(algorithm) {
      if (!['groundTruth', 'graph'].includes(algorithm) || algorithm === this.reachabilityAlgorithm) return;
      this.reachabilityAlgorithm = algorithm;
      if (this.reachabilityMode !== 'objects') return;
      this.performanceMonitor?.clear('reachability');
      this.reachabilityByObject = new Map();
      this.reachabilityGraphConnections = [];
      this.updateReachability();
    }

    setReachabilityCheckUnits(checkUnits) {
      const nextValue = Boolean(checkUnits);
      if (nextValue === this.reachabilityCheckUnits) return;
      this.reachabilityCheckUnits = nextValue;
      if (this.reachabilityMode !== 'objects') return;
      this.performanceMonitor?.clear('reachability');
      this.reachabilityByObject = new Map();
      this.reachabilityGraphConnections = [];
      this.updateReachability();
    }

    setReachabilityInterval(seconds) {
      this.reachabilityInterval = window.clamp(Number(seconds) || 1, 0.1, 60);
    }

    objectReachabilityKey(kind, id) {
      return `${kind}:${id}`;
    }

    calculateGridReachability() {
      this.reachabilityByObject = new Map();
      this.reachabilityGraphConnections = [];
      this.reachabilityGraphStats = { neighborChecks: 0, headquartersChecks: 0 };
      for (const [teamName, headquarters] of Object.entries(HEADQUARTERS)) {
        this.reachabilityByTeam[teamName] = this.navigation.findReachableCells(
          headquarters.position,
          this.obstacles,
          REACHABILITY_AGENT_RADIUS
        );
      }
    }

    getReachabilityTargets() {
      return this.reachabilityCheckUnits
        ? this.units.filter(unit => unit.alive).map(unit => ({ kind: 'unit', object: unit }))
        : this.guardPoints.map(point => ({ kind: 'guard', object: point }));
    }

    calculateGroundTruthObjectReachability(targets) {
      this.reachabilityGraphConnections = [];
      this.reachabilityGraphStats = { neighborChecks: 0, headquartersChecks: 0 };
      for (const target of targets) {
        const reachableTeams = new Set();
        const radius = target.kind === 'unit'
          ? Math.max(0, target.object.navigationRadius ?? target.object.radius ?? REACHABILITY_AGENT_RADIUS)
          : REACHABILITY_AGENT_RADIUS;
        for (const [teamName, headquarters] of Object.entries(HEADQUARTERS)) {
          if (!this.navigation.isPointNavigable(target.object.position, this.obstacles, radius)) continue;
          const path = this.navigation.findPath(headquarters.position, target.object.position, this.obstacles, radius, REACHABILITY_MAX_EXPLORED_NODES);
          const finalPoint = path[path.length - 1];
          if (finalPoint && window.distanceSquared(finalPoint, target.object.position) < 0.0001) reachableTeams.add(teamName);
        }
        this.reachabilityByObject.set(this.objectReachabilityKey(target.kind, target.object.id), reachableTeams);
      }
    }

    calculateGraphObjectReachability(targets) {
      const result = this.reachabilityGraph.calculate({
        targets,
        guardPoints: this.guardPoints,
        headquarters: HEADQUARTERS,
        obstacles: this.obstacles,
        navigation: this.navigation,
        defaultRadius: REACHABILITY_AGENT_RADIUS
      });
      this.reachabilityByObject = result.reachableByObject;
      this.reachabilityGraphConnections = result.connections;
      this.reachabilityGraphStats = result.stats;
    }

    calculateObjectReachability() {
      this.reachabilityByTeam = { Ember: new Set(), Tide: new Set() };
      this.reachabilityByObject = new Map();
      const targets = this.getReachabilityTargets();
      if (this.reachabilityAlgorithm === 'graph') this.calculateGraphObjectReachability(targets);
      else this.calculateGroundTruthObjectReachability(targets);
    }

    updateReachability() {
      const calculate = () => {
        if (this.reachabilityMode === 'objects') this.calculateObjectReachability();
        else this.calculateGridReachability();
        this.lastReachabilityUpdate = this.elapsed;
      };
      const objectLabel = this.reachabilityCheckUnits ? 'Units' : 'Guards';
      const algorithmLabel = this.reachabilityAlgorithm === 'graph' ? 'Graph' : 'Ground truth';
      const label = this.reachabilityMode === 'objects'
        ? `Reachability · ${objectLabel} · ${algorithmLabel}`
        : 'Reachability · Grid';
      return this.measurePerformance('reachability', label, calculate);
    }

    getObjectReachableTeams(kind, id) {
      return Array.from(this.reachabilityByObject.get(this.objectReachabilityKey(kind, id)) ?? []);
    }

    isReachableFrom(team, point) {
      return Boolean(HEADQUARTERS[team]) &&
        this.navigation.isPointNavigable(point, this.obstacles, REACHABILITY_AGENT_RADIUS) &&
        this.navigation.isPointInCellSet(point, this.reachabilityByTeam[team]);
    }

    getReachableTeams(point) {
      return Object.keys(HEADQUARTERS).filter(team => this.isReachableFrom(team, point));
    }

    segmentObstacleHit(start, end, obstacle, padding = 0) {
      return this.navigation.segmentObstacleHit(start, end, obstacle, padding);
    }

    moveTowards(unit, destination, delta) {
      return this.navigation.moveTowards(unit, destination, delta, this.obstacles, this.obstacleRevision);
    }

    rotateTowardsHeading(unit, targetHeading, delta) {
      const diff = Math.atan2(Math.sin(targetHeading - unit.heading), Math.cos(targetHeading - unit.heading));
      const turnRate = 3.5;
      unit.heading += window.clamp(diff, -turnRate * delta, turnRate * delta);
    }

    runMovementBehavior(unit, delta) {
      const behavior = MOVEMENT_BEHAVIORS[unit.movementBehavior] || MOVEMENT_BEHAVIORS.roam;
      behavior.update(this, unit, delta);
    }

    setMovementBehavior(unit, behavior) {
      if (unit.movementBehavior === BEHAVIOR.MOVEMENT.GUARD && behavior !== BEHAVIOR.MOVEMENT.GUARD) this.releaseGuardPoint(unit);
      if (behavior !== BEHAVIOR.MOVEMENT.SCOUT) {
        unit.scoutEscapePoint = null;
      }
      unit.movementBehavior = behavior;
      unit.moveDestination = null;
      this.clearPath(unit);
      unit.moveState = STATE.MOVEMENT.SELECTING;
      unit.moveWaitRemaining = 0;
    }

    updatePerception() {
      for (const unit of this.units) {
        if (!unit.alive) {
          unit.perceivedEnemies = [];
          unit.targetId = null;
          continue;
        }

        unit.perceivedEnemies = this.units.filter(other => {
          if (!other.alive || other.team === unit.team) return false;
          const dx = other.position.x - unit.position.x;
          const dz = other.position.z - unit.position.z;
          return dx * dx + dz * dz <= unit.perceptionRange * unit.perceptionRange && this.isClearTrace(unit, other);
        }).map(other => other.id);

        const enemies = unit.perceivedEnemies.map(id => this.units.find(other => other.id === id)).filter(Boolean);
        const currentTarget = enemies.find(other => other.id === unit.targetId);
        const selector = TARGET_BEHAVIORS[unit.targetBehavior] || TARGET_BEHAVIORS.closest;
        const target = unit.targetBehavior === BEHAVIOR.TARGET.RANDOM && currentTarget ? currentTarget : selector.select(unit, enemies);
        const nextTargetId = target ? target.id : null;
        if (unit.targetId !== nextTargetId) this.resetCombatCycle(unit);
        unit.targetId = nextTargetId;
      }
    }

    revealKeyFor(x, z) {
      return `${Math.floor(x / 5)}:${Math.floor(z / 5)}`;
    }

    updateRevealMap() {
      for (const teamName of Object.keys(HEADQUARTERS)) {
        const explored = new Set(this.revealByTeam[teamName] ?? []);

        for (const [otherTeamName, headquarters] of Object.entries(HEADQUARTERS)) {
          if (headquarters.alwaysVisible) {
            const cellX = Math.floor(headquarters.position.x / 5);
            const cellZ = Math.floor(headquarters.position.z / 5);
            for (let offsetX = -2; offsetX <= 2; offsetX++) {
              for (let offsetZ = -2; offsetZ <= 2; offsetZ++) {
                explored.add(`${cellX + offsetX}:${cellZ + offsetZ}`);
              }
            }
          }
        }

        for (const unit of this.units) {
          if (!unit.alive || unit.team !== teamName) continue;
          const radius = unit.perceptionRange;
          const minX = Math.floor((unit.position.x - radius) / 5);
          const maxX = Math.floor((unit.position.x + radius) / 5);
          const minZ = Math.floor((unit.position.z - radius) / 5);
          const maxZ = Math.floor((unit.position.z + radius) / 5);
          for (let cellX = minX; cellX <= maxX; cellX++) {
            for (let cellZ = minZ; cellZ <= maxZ; cellZ++) {
              const centerX = cellX * 5 + 2.5;
              const centerZ = cellZ * 5 + 2.5;
              const dx = centerX - unit.position.x;
              const dz = centerZ - unit.position.z;
              if (dx * dx + dz * dz <= radius * radius + 25) {
                explored.add(`${cellX}:${cellZ}`);
              }
            }
          }
        }

        if (this.units.some(unit => unit.alwaysVisible && unit.team === teamName)) {
          for (const unit of this.units) {
            if (!unit.alive || !unit.alwaysVisible || unit.team !== teamName) continue;
            const cellX = Math.floor(unit.position.x / 5);
            const cellZ = Math.floor(unit.position.z / 5);
            for (let offsetX = -2; offsetX <= 2; offsetX++) {
              for (let offsetZ = -2; offsetZ <= 2; offsetZ++) {
                explored.add(`${cellX + offsetX}:${cellZ + offsetZ}`);
              }
            }
          }
        }

        this.revealByTeam[teamName] = explored;
      }
    }

    isClearTrace(observer, intendedTarget) {
      const start = observer.position;
      const end = intendedTarget.position;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      if (!lengthSquared) return true;
      if (this.obstacles.some(obstacle => this.segmentObstacleHit(start, end, obstacle) !== null)) return false;
      return !this.units.some(unit => {
        if (!unit.alive || unit === observer || unit === intendedTarget) return false;
        if (!PERCEPTION_CONFIG.friendliesBlockSight && unit.team === observer.team) return false;
        const targetDx = unit.position.x - intendedTarget.position.x;
        const targetDz = unit.position.z - intendedTarget.position.z;
        const targetRadius = intendedTarget.radius ?? 1.7;
        const combinedRadius = (unit.radius ?? 1.7) + targetRadius;
        if (targetDx * targetDx + targetDz * targetDz < combinedRadius * combinedRadius) return false;
        const t = ((unit.position.x - start.x) * dx + (unit.position.z - start.z) * dz) / lengthSquared;
        if (t <= 0 || t >= 1) return false;
        const px = start.x + t * dx - unit.position.x;
        const pz = start.z + t * dz - unit.position.z;
        const radius = unit.radius ?? 1.7;
        return px * px + pz * pz < radius * radius;
      });
    }

    trace(start, end, ownerId = null, kind = TRACE.MANUAL) {
      let hit = null;
      let hitObstacle = null;
      let hitDistance = 1;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const rayLengthSquared = dx * dx + dz * dz;
      for (const obstacle of this.obstacles) {
        const distance = this.segmentObstacleHit(start, end, obstacle);
        if (distance !== null && distance < hitDistance) {
          hitObstacle = obstacle;
          hitDistance = distance;
        }
      }
      for (const unit of this.units) {
        if (!unit.alive || unit.id === ownerId || !rayLengthSquared) continue;
        const t = ((unit.position.x - start.x) * dx + (unit.position.z - start.z) * dz) / rayLengthSquared;
        if (t < 0 || t > hitDistance) continue;
        const px = start.x + t * dx - unit.position.x;
        const pz = start.z + t * dz - unit.position.z;
        const radius = unit.radius ?? 1.7;
        if (px * px + pz * pz < radius * radius) {
          hit = unit;
          hitObstacle = null;
          hitDistance = t;
        }
      }
      const trace = {
        id: `${this.elapsed}-${Math.random()}`,
        start: { x: start.x, z: start.z },
        end: hit || hitObstacle ? { x: start.x + dx * hitDistance, z: start.z + dz * hitDistance } : { x: end.x, z: end.z },
        kind,
        hitId: hit?.id ?? null,
        life: kind === TRACE.MANUAL ? 4 : 0.48
      };
      this.traces.push(trace);
      return { trace, hit, obstacle: hitObstacle };
    }

    update(delta) {
      if (this.paused) return;
      this.elapsed += delta;
      if (this.reachabilityAuto && this.elapsed - this.lastReachabilityUpdate >= this.reachabilityInterval) {
        this.updateReachability();
      }
      if (this.elapsed - this.lastPerceptionUpdate >= 0.2) {
        this.measurePerformance('perception', 'Perception', () => this.updatePerception());
        this.measurePerformance('revealMap', 'Fog reveal', () => this.updateRevealMap());
        this.lastPerceptionUpdate = this.elapsed;
      }

      this.measurePerformance('agentUpdates', 'Agent updates', () => {
        for (const unit of this.units) {
          if (!unit.alive) continue;
          const target = this.units.find(other => other.id === unit.targetId && other.alive);

          const machineGun = unit.movementBehavior === BEHAVIOR.MOVEMENT.GUARD
            ? this.guardPoints.find(point => point.id === unit.guardPointId && point.variant === 'machineGun')
            : null;
          if (machineGun) {
            if (Math.hypot(unit.position.x - machineGun.position.x, unit.position.z - machineGun.position.z) <= 1.5) {
              CombatProcessor.runMachineGun(this, unit, machineGun, delta);
            } else {
              this.runMovementBehavior(unit, delta);
            }
          } else if (unit.movementBehavior === BEHAVIOR.MOVEMENT.SCOUT) {
            this.runMovementBehavior(unit, delta);
          } else if (target) {
            const behavior = COMBAT_BEHAVIORS[unit.combatBehavior] || COMBAT_BEHAVIORS.stopAndShoot;
            behavior.update(this, unit, target, delta);
          } else {
            if (unit.combatState !== STATE.COMBAT.APPROACH) this.resetCombatCycle(unit);
            this.runMovementBehavior(unit, delta);
          }

          const boundaryRadius = Math.max(0, unit.navigationRadius ?? unit.radius ?? 0);
          unit.position.x = window.clamp(unit.position.x + unit.velocity.x * delta, boundaryRadius, this.width - boundaryRadius);
          unit.position.z = window.clamp(unit.position.z + unit.velocity.z * delta, boundaryRadius, this.depth - boundaryRadius);
        }
      });

      for (const trace of this.traces) trace.life -= delta;
      this.traces = this.traces.filter(trace => trace.life > 0);
    }

    fireBullet(attacker, target, weapon = null) {
      const dx = target.position.x - attacker.position.x;
      const dz = target.position.z - attacker.position.z;
      const distance = Math.hypot(dx, dz) || 1;
      const angle = weapon ? attacker.heading + (Math.random() - 0.5) * weapon.coneOfFireDegrees * Math.PI / 180 : null;
      const aim = weapon ? { x: Math.cos(angle), z: Math.sin(angle) } : CombatProcessor.applyAccuracySpread(dx / distance, dz / distance);
      const endpoint = { x: attacker.position.x + aim.x * attacker.attackRange, z: attacker.position.z + aim.z * attacker.attackRange };
      const result = this.trace(attacker.position, endpoint, attacker.id, TRACE.COMBAT);
      if (!result.hit || result.hit.team === attacker.team) return null;
      result.hit.health = Math.max(0, result.hit.health - (weapon ? weapon.damage : COMBAT_CONFIG.bulletDamage));
      if (result.hit.health === 0) {
        result.hit.alive = false;
        result.hit.velocity.x = 0;
        result.hit.velocity.z = 0;
        this.releaseGuardPoint(result.hit);
        this.onEvent(`<strong>${attacker.label}</strong> eliminated <span class="event-alert">${result.hit.label}</span>`, EVENT.COMBAT);
        this.updatePerception();
      }
      return result.hit;
    }
  }

  global.World = World;
})(window);
