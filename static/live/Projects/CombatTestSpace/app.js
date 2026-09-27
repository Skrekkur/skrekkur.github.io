(() => {
  const WORLD_WIDTH = 120;
  const WORLD_DEPTH = 80;
  const { TEAM: TEAMS, BEHAVIOR, STATE, TRACE, TOOL, FOG, EVENT } = window.GAME_CONSTANTS;
  const TEAM = window.TEAM;
  const TEAM_BY_ID = window.TEAM_BY_ID;
  const HEADQUARTERS = window.HEADQUARTERS;
  const TARGET_BEHAVIORS = window.TARGET_BEHAVIORS;
  const COMBAT_BEHAVIORS = window.COMBAT_BEHAVIORS;
  const MOVEMENT_BEHAVIORS = window.MOVEMENT_BEHAVIORS;
  const GLOBAL_ACCURACY = window.GLOBAL_ACCURACY;
  const Unit = window.Unit;
  const MovementProcessor = window.MovementProcessor;
  const CombatProcessor = window.CombatProcessor;

  class World {
    constructor() {
      this.units = [];
      this.traces = [];
      this.guardPoints = [];
      this.nextGuardPointId = 1;
      this.revealByTeam = { Ember: new Set(), Tide: new Set() };
      this.elapsed = 0;
      this.timeScale = 1;
      this.paused = false;
      this.nextId = 1;
      this.lastPerceptionUpdate = 0;
      this.onEvent = () => {};
      this.reset();
    }

    reset() {
      this.units = [];
      this.traces = [];
      this.guardPoints = [];
      this.nextGuardPointId = 1;
      this.revealByTeam = { Ember: new Set(), Tide: new Set() };
      this.elapsed = 0;
      this.nextId = 1;
      for (let index = 0; index < 2; index++) {
        this.addUnit(TEAMS.EMBER, undefined, false);
        this.addUnit(TEAMS.TIDE, undefined, false);
      }
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
    }

    selectRoamDestination(unit) {
      unit.moveDestination = {
        x: 7 + Math.random() * (WORLD_WIDTH - 14),
        z: 7 + Math.random() * (WORLD_DEPTH - 14)
      };
      unit.moveState = STATE.MOVEMENT.MOVING;
      unit.moveWaitRemaining = 0;
    }

    selectGuardWanderDestination(unit) {
      const headquarters = HEADQUARTERS[unit.team].position;
      unit.moveDestination = {
        x: window.clamp(headquarters.x + (Math.random() - 0.5) * 22, 4, WORLD_WIDTH - 4),
        z: window.clamp(headquarters.z + (Math.random() - 0.5) * 22, 4, WORLD_DEPTH - 4)
      };
      unit.moveState = STATE.MOVEMENT.MOVING;
      unit.moveWaitRemaining = 0;
    }

    addGuardPoint(position, team, heading) {
      if (heading === undefined) {
        const center = { x: WORLD_WIDTH / 2, z: WORLD_DEPTH / 2 };
        heading = Math.atan2(position.z - center.z, position.x - center.x);
      }
      const point = { id: this.nextGuardPointId++, team, teamId: TEAM[team].id, position: { x: position.x, y: 0, z: position.z }, heading, claimedBy: null };
      this.guardPoints.push(point);
      this.onEvent(`Guard point #${point.id} placed for ${HEADQUARTERS[team].label} at (${position.x.toFixed(1)}, ${position.z.toFixed(1)})`, 'info');
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
    }

    moveTowards(unit, destination, delta) {
      const dx = destination.x - unit.position.x;
      const dz = destination.z - unit.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= 1.2) {
        unit.position.x = destination.x;
        unit.position.z = destination.z;
        unit.velocity.x = 0;
        unit.velocity.z = 0;
        return true;
      }
      unit.heading = Math.atan2(dz, dx);
      unit.velocity.x = (dx / distance) * unit.moveSpeed;
      unit.velocity.z = (dz / distance) * unit.moveSpeed;
      return false;
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
      return !this.units.some(unit => {
        if (!unit.alive || unit === observer || unit === intendedTarget) return false;
        const t = Math.max(0, Math.min(1, ((unit.position.x - start.x) * dx + (unit.position.z - start.z) * dz) / lengthSquared));
        const px = start.x + t * dx - unit.position.x;
        const pz = start.z + t * dz - unit.position.z;
        return px * px + pz * pz < 1.7 * 1.7;
      });
    }

    trace(start, end, ownerId = null, kind = TRACE.MANUAL) {
      let hit = null;
      let hitDistance = 1;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      const rayLengthSquared = dx * dx + dz * dz;
      for (const unit of this.units) {
        if (!unit.alive || unit.id === ownerId || !rayLengthSquared) continue;
        const t = ((unit.position.x - start.x) * dx + (unit.position.z - start.z) * dz) / rayLengthSquared;
        if (t < 0 || t > hitDistance) continue;
        const px = start.x + t * dx - unit.position.x;
        const pz = start.z + t * dz - unit.position.z;
        if (px * px + pz * pz < 1.7 * 1.7) {
          hit = unit;
          hitDistance = t;
        }
      }
      const trace = {
        id: `${this.elapsed}-${Math.random()}`,
        start: { x: start.x, z: start.z },
        end: hit ? { x: start.x + dx * hitDistance, z: start.z + dz * hitDistance } : { x: end.x, z: end.z },
        kind,
        hitId: hit?.id ?? null,
        life: kind === TRACE.MANUAL ? 4 : 0.48
      };
      this.traces.push(trace);
      return { trace, hit };
    }

    update(delta) {
      if (this.paused) return;
      this.elapsed += delta;
      if (this.elapsed - this.lastPerceptionUpdate >= 0.2) {
        this.updatePerception();
        this.updateRevealMap();
        this.lastPerceptionUpdate = this.elapsed;
      }

      for (const unit of this.units) {
        if (!unit.alive) continue;
        const target = this.units.find(other => other.id === unit.targetId && other.alive);

        if (unit.movementBehavior === BEHAVIOR.MOVEMENT.SCOUT) {
          this.runMovementBehavior(unit, delta);
        } else if (target) {
          const behavior = COMBAT_BEHAVIORS[unit.combatBehavior] || COMBAT_BEHAVIORS.stopAndShoot;
          behavior.update(this, unit, target, delta);
        } else {
          if (unit.combatState !== STATE.COMBAT.APPROACH) this.resetCombatCycle(unit);
          this.runMovementBehavior(unit, delta);
        }

        unit.position.x = window.clamp(unit.position.x + unit.velocity.x * delta, 2.5, WORLD_WIDTH - 2.5);
        unit.position.z = window.clamp(unit.position.z + unit.velocity.z * delta, 2.5, WORLD_DEPTH - 2.5);
      }

      for (const trace of this.traces) trace.life -= delta;
      this.traces = this.traces.filter(trace => trace.life > 0);
    }

    fireBullet(attacker, target) {
      const dx = target.position.x - attacker.position.x;
      const dz = target.position.z - attacker.position.z;
      const distance = Math.hypot(dx, dz) || 1;
      const aim = CombatProcessor.applyAccuracySpread(dx / distance, dz / distance);
      const endpoint = { x: attacker.position.x + aim.x * attacker.attackRange, z: attacker.position.z + aim.z * attacker.attackRange };
      const result = this.trace(attacker.position, endpoint, attacker.id, TRACE.COMBAT);
      if (!result.hit || result.hit.team === attacker.team) return null;
      result.hit.health = Math.max(0, result.hit.health - 7);
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

  for (const [key, behavior] of Object.entries(COMBAT_BEHAVIORS)) {
    behavior.update = (world, unit, target, delta) => CombatProcessor.runStopAndShoot(world, unit, target, delta, behavior.engagementRange(unit));
    behavior.key = key;
  }

  for (const [key, behavior] of Object.entries(MOVEMENT_BEHAVIORS)) {
    const processorMethod = {
    [BEHAVIOR.MOVEMENT.ROAM]: 'runRoamStep',
    [BEHAVIOR.MOVEMENT.GUARD]: 'runGuardStep',
    [BEHAVIOR.MOVEMENT.SCOUT]: 'runScoutStep'
    }[key] || 'runRoamStep';
    behavior.update = (world, unit, delta) => MovementProcessor[processorMethod](world, unit, delta);
  }

  class Camera {
    constructor() {
      this.zoom = 1;
      this.offsetX = 0;
      this.offsetY = 0;
      this.width = 1;
      this.height = 1;
      this.scale = 1;
      this.view = 'top';
      this.yaw = Math.PI / 4;
    }

    resize(width, height) {
      this.width = width;
      this.height = height;
    }

    fit() {
      this.offsetX = 0;
      this.offsetY = 0;
      this.zoom = 1;
    }

    rotate(direction) {
      this.yaw += direction * Math.PI / 4;
    }

    getScale() {
      this.scale = Math.min(this.width / (WORLD_WIDTH + 17), this.height / (WORLD_DEPTH + 16)) * this.zoom;
      return this.scale;
    }

    worldToScreen(position) {
      const scale = this.getScale();
      if (this.view === 'iso') {
        const dx = position.x - WORLD_WIDTH / 2;
        const dz = position.z - WORLD_DEPTH / 2;
        const cos = Math.cos(this.yaw);
        const sin = Math.sin(this.yaw);
        const horizontal = dx * cos - dz * sin;
        const depth = dx * sin + dz * cos;
        return {
          x: this.width / 2 + horizontal * scale + this.offsetX,
          y: this.height / 2 + depth * scale * 0.52 - (position.y || 0) * scale + this.offsetY
        };
      }
      return {
        x: this.width / 2 + (position.x - WORLD_WIDTH / 2) * scale + this.offsetX,
        y: this.height / 2 + (position.z - WORLD_DEPTH / 2) * scale + this.offsetY
      };
    }

    screenToWorld(point) {
      const scale = this.getScale();
      if (this.view === 'iso') {
        const horizontal = (point.x - this.width / 2 - this.offsetX) / scale;
        const depth = (point.y - this.height / 2 - this.offsetY) / (scale * 0.52);
        const cos = Math.cos(this.yaw);
        const sin = Math.sin(this.yaw);
        return {
          x: horizontal * cos + depth * sin + WORLD_WIDTH / 2,
          z: -horizontal * sin + depth * cos + WORLD_DEPTH / 2
        };
      }
      return {
        x: (point.x - this.width / 2 - this.offsetX) / scale + WORLD_WIDTH / 2,
        z: (point.y - this.height / 2 - this.offsetY) / scale + WORLD_DEPTH / 2
      };
    }
  }

  class Renderer {
    constructor(canvas, world, camera) {
      this.canvas = canvas;
      this.context = canvas.getContext('2d');
      this.fogCanvas = document.createElement('canvas');
      this.fogContext = this.fogCanvas.getContext('2d');
      this.pixelRatio = 1;
      this.world = world;
      this.camera = camera;
      this.showRanges = false;
      this.showSight = true;
      this.showFog = false;
      this.fogOfWarTeam = null;
      this.fogHideInvisible = false;
      this.selectedId = 1;
      this.manualStart = null;
      this.cursorWorld = null;
      this.pendingGuardPoint = null;
      this.pendingGuardTeam = null;
      this.pendingGuardHeading = 0;
      this.pendingGuardHeadingManual = false;
      this.theme = {};
      this.refreshTheme();
    }

    refreshTheme() {
      const styles = getComputedStyle(document.documentElement);
      const read = name => styles.getPropertyValue(name).trim();
      this.theme = {
        canvasBg: read('--canvas-bg'),
        gridLine: read('--canvas-grid'),
        arenaFill: read('--canvas-arena-fill'),
        arenaBorder: read('--canvas-arena-border'),
        arenaGrid: read('--canvas-arena-grid'),
        mutedLabel: read('--canvas-muted-label'),
        strongLabel: read('--canvas-strong-label'),
        axisLine: read('--canvas-axis-line'),
        isoWallFill: read('--canvas-iso-wall-fill'),
        isoWallBorder: read('--canvas-iso-wall-border')
      };
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      this.pixelRatio = pixelRatio;
      this.canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
      this.canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));
      this.fogCanvas.width = this.canvas.width;
      this.fogCanvas.height = this.canvas.height;
      this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      this.fogContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      this.camera.resize(rect.width, rect.height);
    }

    draw() {
      const context = this.context;
      const rect = this.canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const camera = this.camera;
      const scale = camera.getScale();
      context.clearRect(0, 0, width, height);
      context.globalAlpha = 1;
      context.fillStyle = this.theme.canvasBg;
      context.fillRect(0, 0, width, height);
      if (camera.view === 'iso') {
        this.drawIsoArena(scale);
        this.drawIsoHeadquarters(scale);
      } else {
        this.drawGrid(width, height, scale);
        this.drawArena(scale);
        this.drawHeadquarters(scale);
      }
      this.drawMoveDestinations(scale);
      this.drawGuardPoints(scale);
      this.drawSightLines();
      this.drawTraces();
      if (camera.view === 'iso') this.drawIsoUnits(scale);
      else this.drawUnits(scale);
      if (this.showFog && this.fogOfWarTeam !== null) this.drawFogOfWar();
      if (this.manualStart) this.drawManualPreview();
      if (this.pendingGuardPoint) this.drawGuardPreview();
    }

    drawIsoArena(scale) {
      const context = this.context;
      const corners = [
        this.camera.worldToScreen({ x: 0, y: 0, z: 0 }),
        this.camera.worldToScreen({ x: WORLD_WIDTH, y: 0, z: 0 }),
        this.camera.worldToScreen({ x: WORLD_WIDTH, y: 0, z: WORLD_DEPTH }),
        this.camera.worldToScreen({ x: 0, y: 0, z: WORLD_DEPTH })
      ];
      context.beginPath();
      corners.forEach((corner, index) => index ? context.lineTo(corner.x, corner.y) : context.moveTo(corner.x, corner.y));
      context.closePath();
      context.fillStyle = 'rgba(255, 255, 250, 0.65)';
      context.fill();
      context.strokeStyle = this.theme.arenaBorder;
      context.lineWidth = Math.max(1, scale * 0.23);
      context.setLineDash([5, 5]);
      context.stroke();
      context.setLineDash([]);
      context.strokeStyle = this.theme.arenaGrid;
      context.lineWidth = 1;
      for (let value = 10; value < WORLD_WIDTH; value += 10) this.drawIsoLine({ x: value, y: 0, z: 0 }, { x: value, y: 0, z: WORLD_DEPTH });
      for (let value = 10; value < WORLD_DEPTH; value += 10) this.drawIsoLine({ x: 0, y: 0, z: value }, { x: WORLD_WIDTH, y: 0, z: value });
      this.drawIsoWall(corners[0], corners[1], 8 * scale);
      this.drawIsoWall(corners[1], corners[2], 8 * scale);
      context.fillStyle = this.theme.mutedLabel;
      context.font = '9px "DM Mono", monospace';
      context.textAlign = 'center';
      context.fillText('TEAM 1 SIDE', corners[0].x - 10, corners[0].y - 8);
      context.fillText('TEAM 2 SIDE', corners[2].x + 10, corners[2].y - 8);
    }

    drawIsoLine(start, end) {
      const context = this.context;
      const a = this.camera.worldToScreen(start);
      const b = this.camera.worldToScreen(end);
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    }

    drawIsoWall(start, end, height) {
      const context = this.context;
      context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(end.x, end.y); context.lineTo(end.x, end.y - height); context.lineTo(start.x, start.y - height); context.closePath();
      context.fillStyle = this.theme.isoWallFill; context.fill(); context.strokeStyle = this.theme.isoWallBorder; context.stroke();
    }

    drawIsoHeadquarters(scale) {
      for (const [teamName, headquarters] of Object.entries(HEADQUARTERS)) {
        const point = this.camera.worldToScreen({ ...headquarters.position, y: 0 });
        const team = TEAM[teamName];
        const width = Math.max(10, scale * 4.2);
        const height = Math.max(12, scale * 8);
        this.drawIsoBox(point, width, width * 0.6, height, team.color);
        this.context.fillStyle = team.color;
        this.context.font = '600 9px "DM Mono", monospace';
        this.context.textAlign = 'center';
        this.context.fillText(headquarters.label.toUpperCase(), point.x, point.y + height + 14);
      }
    }

    drawMoveDestinations(scale) {
      const context = this.context;
      const fogActive = this.showFog && this.fogOfWarTeam !== FOG.OFF;
      for (const unit of this.world.units) {
        if (!unit.alive || unit.targetId !== null || !unit.moveDestination) continue;
        const visible = !fogActive || this.isVisibleToTeam(unit, this.fogOfWarTeam);
        if (fogActive && !visible) {
          if (this.fogHideInvisible) continue;
        }
        const point = this.camera.worldToScreen({ ...unit.moveDestination, y: 0 });
        const color = TEAM[unit.team].color;
        context.save();
        context.globalAlpha = fogActive ? (visible ? 1 : 0.18) : (unit.moveState === STATE.MOVEMENT.WAITING ? 0.85 : 0.45);
        context.strokeStyle = color;
        context.lineWidth = 1.2;
        context.setLineDash([3, 3]);
        if (this.camera.view === 'iso') {
          context.beginPath();
          context.ellipse(point.x, point.y, 5 * scale, 2.6 * scale, 0, 0, Math.PI * 2);
          context.stroke();
        } else {
          context.beginPath();
          context.arc(point.x, point.y, 5, 0, Math.PI * 2);
          context.stroke();
        }
        context.setLineDash([]);
        context.restore();
      }
    }

    drawGuardPoints(scale) {
      const context = this.context;
      const fogActive = this.showFog && this.fogOfWarTeam !== FOG.OFF;
      for (const point of this.world.guardPoints) {
        const visible = !fogActive || this.isVisibleToTeam({ alive: true, team: point.team, alwaysVisible: false, position: point.position }, this.fogOfWarTeam);
        if (fogActive && !visible && this.fogHideInvisible) continue;
        const screen = this.camera.worldToScreen(point.position);
        const claimant = point.claimedBy !== null ? this.world.units.find(unit => unit.id === point.claimedBy) : null;
        const color = TEAM[point.team].color;
        const radius = Math.max(7, scale * 1.1);
        context.save();
        context.globalAlpha = fogActive ? (visible ? 1 : 0.18) : 1;
        context.translate(screen.x, screen.y);
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.fillStyle = claimant ? `${color}33` : `${color}18`;
        context.fill();
        context.strokeStyle = color;
        context.lineWidth = 1.4;
        context.setLineDash(claimant ? [] : [3, 3]);
        context.stroke();
        context.setLineDash([]);
        context.rotate(point.heading);
        context.beginPath();
        context.moveTo(radius * 0.2, 0);
        context.lineTo(radius * 1.6, -radius * 0.45);
        context.lineTo(radius * 1.6, radius * 0.45);
        context.closePath();
        context.fillStyle = color;
        context.fill();
        context.restore();
        context.fillStyle = this.theme.mutedLabel;
        context.font = '8px "DM Mono", monospace';
        context.textAlign = 'center';
        context.fillText(claimant ? `GUARDED · ${claimant.label}` : `OPEN · ${HEADQUARTERS[point.team].label.replace(' HQ', '').toUpperCase()}`, screen.x, screen.y + radius + 10);
      }
    }

    drawGuardPreview() {
      const context = this.context;
      const screen = this.camera.worldToScreen(this.pendingGuardPoint);
      const color = TEAM[this.pendingGuardTeam]?.color || this.theme.strongLabel;
      const radius = 9;
      context.save();
      context.globalAlpha = 0.75;
      context.translate(screen.x, screen.y);
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.strokeStyle = color;
      context.setLineDash([4, 3]);
      context.lineWidth = 1.4;
      context.stroke();
      context.setLineDash([]);
      context.rotate(this.pendingGuardHeading);
      context.beginPath();
      context.moveTo(radius * 0.2, 0);
      context.lineTo(radius * 1.8, -radius * 0.5);
      context.lineTo(radius * 1.8, radius * 0.5);
      context.closePath();
      context.fillStyle = color;
      context.fill();
      context.restore();
      context.fillStyle = color;
      context.font = '9px "DM Mono", monospace';
      context.textAlign = 'center';
      const teamLabel = HEADQUARTERS[this.pendingGuardTeam]?.label.replace(' HQ', '').toUpperCase() || '';
      context.fillText(`GUARD POINT · ${teamLabel} · SCROLL TO ROTATE`, screen.x, screen.y - radius - 10);
    }

    drawIsoBox(point, width, depth, height, color) {
      const context = this.context;
      const top = { x: point.x, y: point.y - height };
      context.fillStyle = color;
      context.beginPath(); context.moveTo(top.x, top.y - depth / 2); context.lineTo(top.x + width, top.y); context.lineTo(top.x, top.y + depth / 2); context.lineTo(top.x - width, top.y); context.closePath(); context.fill();
      context.fillStyle = 'rgba(0,0,0,.16)';
      context.beginPath(); context.moveTo(top.x - width, top.y); context.lineTo(top.x, top.y + depth / 2); context.lineTo(top.x, point.y + depth / 2); context.lineTo(top.x - width, point.y); context.closePath(); context.fill();
      context.fillStyle = 'rgba(0,0,0,.26)';
      context.beginPath(); context.moveTo(top.x + width, top.y); context.lineTo(top.x, top.y + depth / 2); context.lineTo(top.x, point.y + depth / 2); context.lineTo(top.x + width, point.y); context.closePath(); context.fill();
      context.strokeStyle = '#fffefa'; context.lineWidth = 1; context.stroke();
    }

    drawIsoUnits(scale) {
      const context = this.context;
      const fogActive = this.showFog && this.fogOfWarTeam !== FOG.OFF;
      const units = this.world.units.slice().sort((a, b) => (a.position.x + a.position.z) - (b.position.x + b.position.z));
      for (const unit of units) {
        const isVisible = !fogActive || this.isVisibleToTeam(unit, this.fogOfWarTeam);
        if (fogActive && !isVisible && this.fogHideInvisible) continue;
        const point = this.camera.worldToScreen(unit.position);
        const radius = Math.max(6, scale * 1.7);
        const height = Math.max(11, scale * 5.3);
        const color = unit.alive ? TEAM[unit.team].color : '#75817b';
        const alpha = fogActive ? (isVisible ? 1 : 0.18) : 1;
        if (this.showRanges && unit.alive) {
          context.beginPath(); context.ellipse(point.x, point.y, unit.perceptionRange * scale, unit.perceptionRange * scale * 0.52, 0, 0, Math.PI * 2); context.fillStyle = TEAM[unit.team].pale; context.fill();
        }
        context.globalAlpha = unit.alive ? alpha : 0.42;
        context.fillStyle = color;
        context.beginPath(); context.ellipse(point.x, point.y - height, radius, radius * 0.52, 0, 0, Math.PI * 2); context.fill();
        context.fillRect(point.x - radius, point.y - height, radius * 2, height);
        context.beginPath(); context.ellipse(point.x, point.y, radius, radius * 0.52, 0, 0, Math.PI * 2); context.fill();
        context.strokeStyle = '#fffefa'; context.lineWidth = 1.5; context.stroke();
        context.save();
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.font = `500 ${Math.max(7, radius * 1.05)}px "DM Mono", monospace`;
        context.fillStyle = '#fffefa';
        context.fillText(MOVEMENT_BEHAVIORS[unit.movementBehavior]?.letter || 'R', point.x, point.y - height + 0.5);
        context.restore();
        context.globalAlpha = 1;
        context.fillStyle = unit.alive ? this.theme.strongLabel : this.theme.mutedLabel; context.font = '9px "DM Mono", monospace'; context.textAlign = 'center'; context.fillText(unit.label, point.x, point.y + 13);
        if (unit.alive) { context.fillStyle = unit.health > 35 ? '#55be81' : '#ef765e'; context.fillRect(point.x - radius, point.y - height - 5, radius * 2 * unit.health / unit.maxHealth, 2); }
      }
    }

    drawGrid(width, height, scale) {
      const context = this.context;
      const camera = this.camera;
      const spacing = Math.max(16, 10 * scale);
      const origin = camera.worldToScreen({ x: 0, z: 0 });
      context.beginPath();
      for (let x = ((origin.x % spacing) + spacing) % spacing; x < width; x += spacing) {
        context.moveTo(x, 0);
        context.lineTo(x, height);
      }
      for (let y = ((origin.y % spacing) + spacing) % spacing; y < height; y += spacing) {
        context.moveTo(0, y);
        context.lineTo(width, y);
      }
      context.strokeStyle = this.theme.gridLine;
      context.lineWidth = 1;
      context.stroke();
    }

    drawArena(scale) {
      const context = this.context;
      const topLeft = this.camera.worldToScreen({ x: 0, z: 0 });
      const bottomRight = this.camera.worldToScreen({ x: WORLD_WIDTH, z: WORLD_DEPTH });
      const left = topLeft.x;
      const top = topLeft.y;
      const width = bottomRight.x - left;
      const height = bottomRight.y - top;
      context.fillStyle = this.theme.arenaFill;
      context.fillRect(left, top, width, height);
      context.save();
      context.beginPath();
      context.rect(left, top, width, height);
      context.clip();
      this.drawArenaGrid(left, top, scale);
      context.restore();
      context.strokeStyle = this.theme.arenaBorder;
      context.lineWidth = Math.max(1, scale * 0.23);
      context.setLineDash([5, 5]);
      context.strokeRect(left, top, width, height);
      context.setLineDash([]);
      const markerWidth = Math.max(13, Math.min(24, scale * 2.3));
      context.lineWidth = Math.max(3, scale * 0.75);
      context.lineCap = 'square';
      context.strokeStyle = '#ec785e';
      for (const x of [left, left + width]) {
        for (const y of [top + height * 0.2, top + height * 0.5, top + height * 0.8]) {
          context.beginPath();
          context.moveTo(x - markerWidth / 2, y);
          context.lineTo(x + markerWidth / 2, y);
          context.stroke();
        }
      }
      context.lineCap = 'butt';
      context.fillStyle = this.theme.mutedLabel;
      context.font = '9px "DM Mono", monospace';
      context.textAlign = 'center';
      context.fillText('WEST WALL', left - 2, top - 8);
      context.fillText('EAST WALL', left + width + 2, top - 8);
      context.fillStyle = '#bd725e';
      context.textAlign = 'left';
      context.fillText('NORTH', left + 5, top + 12);
      context.textAlign = 'right';
      context.fillText('SOUTH', left + width - 5, top + height - 6);
      context.strokeStyle = this.theme.axisLine;
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(left + 8, top + height + 16);
      context.lineTo(left + 36, top + height + 16);
      context.lineTo(left + 36, top + height + 12);
      context.moveTo(left + 8, top + height + 16);
      context.lineTo(left + 8, top + height - 12);
      context.lineTo(left + 4, top + height - 12);
      context.stroke();
      context.fillStyle = this.theme.strongLabel;
      context.font = '9px "DM Mono", monospace';
      context.textAlign = 'left';
      context.fillText('X', left + 39, top + height + 19);
      context.fillText('Z', left + 2, top + height - 16);
    }

    drawArenaGrid(left, top, scale) {
      const context = this.context;
      context.strokeStyle = this.theme.arenaGrid;
      context.lineWidth = 1;
      context.beginPath();
      for (let x = 0; x <= WORLD_WIDTH; x += 10) {
        const point = this.camera.worldToScreen({ x, z: 0 });
        context.moveTo(point.x, top);
        context.lineTo(point.x, top + WORLD_DEPTH * scale);
      }
      for (let z = 0; z <= WORLD_DEPTH; z += 10) {
        const point = this.camera.worldToScreen({ x: 0, z });
        context.moveTo(left, point.y);
        context.lineTo(left + WORLD_WIDTH * scale, point.y);
      }
      context.stroke();
    }

    drawHeadquarters(scale) {
      const context = this.context;
      for (const [teamName, headquarters] of Object.entries(HEADQUARTERS)) {
        const team = TEAM[teamName];
        const point = this.camera.worldToScreen(headquarters.position);
        const radius = Math.max(13, 7 * scale);
        const buildingSize = Math.max(9, 3.2 * scale);
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fillStyle = team.pale;
        context.fill();
        context.setLineDash([4, 4]);
        context.strokeStyle = `${team.color}aa`;
        context.lineWidth = 1.2;
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = '#fffefa';
        context.fillRect(point.x - buildingSize / 2 - 2, point.y - buildingSize / 2 - 2, buildingSize + 4, buildingSize + 4);
        context.fillStyle = team.color;
        context.fillRect(point.x - buildingSize / 2, point.y - buildingSize / 2, buildingSize, buildingSize);
        context.fillStyle = '#fffefa';
        context.font = '600 9px "DM Mono", monospace';
        context.textAlign = 'center';
        context.fillText(headquarters.label.toUpperCase(), point.x, point.y + radius + 12);
      }
    }

    drawSightLines() {
      if (!this.showSight) return;
      const context = this.context;
      for (const unit of this.world.units) {
        if (!unit.alive || unit.targetId === null) continue;
        const target = this.world.units.find(other => other.id === unit.targetId && other.alive);
        if (!target) continue;
        const start = this.camera.worldToScreen(unit.position);
        const end = this.camera.worldToScreen(target.position);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.strokeStyle = 'rgba(56, 130, 91, 0.40)';
        context.lineWidth = 1.15;
        context.setLineDash([4, 4]);
        context.stroke();
        context.setLineDash([]);
      }
    }

    drawFogOfWar() {
      const context = this.fogContext;
      const rect = this.canvas.getBoundingClientRect();
      const left = 0;
      const top = 0;
      const width = rect.width;
      const height = rect.height;
      const team = this.fogOfWarTeam;
      const reveal = this.world.revealByTeam[team] ?? new Set();

      context.save();
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = 'source-over';
      context.fillStyle = 'rgba(3, 7, 12, 0.92)';
      context.fillRect(left, top, width, height);
      context.globalCompositeOperation = 'destination-out';

      const cellSize = 5 * this.camera.getScale();
      for (const key of reveal) {
        const [cellX, cellZ] = key.split(':').map(Number);
        const center = this.camera.worldToScreen({ x: cellX * 5 + 2.5, z: cellZ * 5 + 2.5 });
        context.fillRect(center.x - cellSize / 2, center.y - cellSize / 2, cellSize, cellSize);
      }

      this.clearAlwaysVisibleHeadquarters(context);

      for (const unit of this.world.units) {
        if (!unit.alive || unit.team !== team) continue;
        const center = this.camera.worldToScreen(unit.position);
        const radius = unit.perceptionRange * this.camera.getScale();
        context.beginPath();
        if (this.camera.view === 'iso') {
          context.ellipse(center.x, center.y, radius, radius * 0.52, 0, 0, Math.PI * 2);
        } else {
          context.arc(center.x, center.y, radius, 0, Math.PI * 2);
        }
        context.fill();
      }
      context.restore();

      this.context.save();
      this.context.globalCompositeOperation = 'source-over';
      this.context.drawImage(this.fogCanvas, 0, 0, this.canvas.width / this.pixelRatio, this.canvas.height / this.pixelRatio);
      this.context.restore();
    }

    clearAlwaysVisibleHeadquarters(context) {
      for (const headquarters of Object.values(HEADQUARTERS)) {
        if (!headquarters.alwaysVisible) continue;
        const point = this.camera.worldToScreen(headquarters.position);
        context.beginPath();
        if (this.camera.view === 'iso') {
          const scale = this.camera.getScale();
          const width = Math.max(16, scale * 7);
          const height = Math.max(22, scale * 12);
          context.moveTo(point.x, point.y - height);
          context.lineTo(point.x + width, point.y - height * 0.5);
          context.lineTo(point.x + width, point.y + 8);
          context.lineTo(point.x, point.y + 14);
          context.lineTo(point.x - width, point.y + 8);
          context.lineTo(point.x - width, point.y - height * 0.5);
        } else {
          context.arc(point.x, point.y, Math.max(22, 10 * this.camera.getScale()), 0, Math.PI * 2);
        }
        context.fill();
      }
    }

    isVisibleToTeam(unit, team) {
      if (!this.showFog || !team) return true;
      if (!unit.alive) return false;
      if (unit.alwaysVisible) return true;
      if (unit.team === team) return true;
      return this.world.units.some(other => {
        if (!other.alive || other.team !== team || other.alwaysVisible) return false;
        const dx = unit.position.x - other.position.x;
        const dz = unit.position.z - other.position.z;
        return dx * dx + dz * dz <= other.perceptionRange * other.perceptionRange && this.world.isClearTrace(other, unit);
      });
    }

    drawTraces() {
      const context = this.context;
      for (const trace of this.world.traces) {
        const start = this.camera.worldToScreen(trace.start);
        const end = this.camera.worldToScreen(trace.end);
        const alpha = trace.kind === TRACE.MANUAL ? Math.min(1, trace.life) : Math.min(1, trace.life / 0.2);
        context.save();
        context.globalAlpha = alpha;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.strokeStyle = trace.kind === TRACE.MANUAL ? '#e05b43' : '#ffb06b';
        context.lineWidth = trace.kind === TRACE.MANUAL ? 2 : 1.8;
        context.setLineDash(trace.kind === TRACE.MANUAL ? [] : [3, 3]);
        context.stroke();
        context.setLineDash([]);
        if (trace.kind === TRACE.MANUAL) {
          context.beginPath();
          context.arc(end.x, end.y, 4, 0, Math.PI * 2);
          context.fillStyle = trace.hitId ? '#e05b43' : '#fffefa';
          context.fill();
          context.strokeStyle = '#e05b43';
          context.lineWidth = 1.5;
          context.stroke();
        }
        context.restore();
      }
    }

    drawUnits(scale) {
      const context = this.context;
      const minRadius = 5.3;
      const fogActive = this.showFog && this.fogOfWarTeam !== null;
      for (const unit of this.world.units) {
        const isVisible = !fogActive || this.isVisibleToTeam(unit, this.fogOfWarTeam);
        if (fogActive && !isVisible && this.fogHideInvisible) continue;
        const point = this.camera.worldToScreen(unit.position);
        const radius = Math.max(minRadius, scale * 1.65);
        const team = TEAM[unit.team];
        const selected = unit.id === this.selectedId;
        const alpha = fogActive ? (isVisible ? 1 : 0.18) : 1;
        if (this.showRanges && unit.alive) {
          context.beginPath();
          context.arc(point.x, point.y, unit.perceptionRange * scale, 0, Math.PI * 2);
          context.fillStyle = team.pale;
          context.fill();
          context.strokeStyle = `${team.color}66`;
          context.lineWidth = 1;
          context.setLineDash([4, 5]);
          context.stroke();
          context.setLineDash([]);
        }
        if (selected) {
          context.beginPath();
          context.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
          context.strokeStyle = 'rgba(28, 54, 43, 0.48)';
          context.lineWidth = 1;
          context.stroke();
        }
        context.save();
        context.globalAlpha = unit.alive ? alpha : 0.42;
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fillStyle = unit.alive ? team.color : '#75817b';
        context.fill();
        context.lineWidth = 2;
        context.strokeStyle = '#fffefa';
        context.stroke();
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(point.x + Math.cos(unit.heading) * radius * 1.55, point.y + Math.sin(unit.heading) * radius * 1.55);
        context.strokeStyle = '#fffefa';
        context.lineWidth = 1.5;
        context.stroke();
        if (unit.alive) {
          const healthWidth = Math.max(17, radius * 2.3);
          context.fillStyle = 'rgba(25, 46, 36, 0.3)';
          context.fillRect(point.x - healthWidth / 2, point.y - radius - 7, healthWidth, 2.5);
          context.fillStyle = unit.health > 35 ? '#55be81' : '#ef765e';
          context.fillRect(point.x - healthWidth / 2, point.y - radius - 7, healthWidth * unit.health / unit.maxHealth, 2.5);
        }
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.font = `500 ${Math.max(8, radius * 1.05)}px "DM Mono", monospace`;
        context.fillStyle = '#fffefa';
        context.fillText(MOVEMENT_BEHAVIORS[unit.movementBehavior]?.letter || 'R', point.x, point.y + 0.5);
        context.textBaseline = 'alphabetic';
        context.restore();
        context.fillStyle = unit.alive ? this.theme.strongLabel : this.theme.mutedLabel;
        context.font = '9px "DM Mono", monospace';
        context.textAlign = 'center';
        context.fillText(unit.label, point.x, point.y + radius + 13);
      }
    }

    drawManualPreview() {
      if (!this.cursorWorld) return;
      const start = this.camera.worldToScreen(this.manualStart);
      const end = this.camera.worldToScreen(this.cursorWorld);
      const context = this.context;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.strokeStyle = '#e05b43';
      context.lineWidth = 1.7;
      context.setLineDash([5, 4]);
      context.stroke();
      context.setLineDash([]);
      context.beginPath();
      context.arc(start.x, start.y, 4, 0, Math.PI * 2);
      context.fillStyle = '#e05b43';
      context.fill();
    }

    pickUnit(screenPoint) {
      let nearest = null;
      let nearestDistance = Infinity;
      for (const unit of this.world.units) {
        const point = this.camera.worldToScreen(unit.position);
        const distance = Math.hypot(screenPoint.x - point.x, screenPoint.y - point.y);
        if (distance < 18 && distance < nearestDistance) {
          nearest = unit;
          nearestDistance = distance;
        }
      }
      return nearest;
    }
  }

  const canvas = document.querySelector('#worldCanvas');
  const world = new World();
  const camera = new Camera();
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
    traceHint: document.querySelector('#traceHint'),
    zoomLabel: document.querySelector('#zoomLabel'),
    playButton: document.querySelector('#playButton'),
    playLabel: document.querySelector('#playLabel'),
    playIcon: document.querySelector('#playIcon'),
    traceButton: document.querySelector('#traceButton'),
    buildGuardPointEmber: document.querySelector('#buildGuardPointEmber'),
    buildGuardPointTide: document.querySelector('#buildGuardPointTide'),
    buildHint: document.querySelector('#buildHint'),
    themeToggle: document.querySelector('#themeToggle'),
    themeToggleIcon: document.querySelector('#themeToggleIcon'),
    topViewButton: document.querySelector('#topViewButton'),
    isoViewButton: document.querySelector('#isoViewButton'),
    rotateLeftButton: document.querySelector('#rotateLeftButton'),
    rotateRightButton: document.querySelector('#rotateRightButton'),
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
  let activeTool = null;
  let pendingGuardTeam = null;
  let lastGuardHeadingByTeam = { Ember: null, Tide: null };
  let events = [];
  let uiAccumulator = 0;
  let lastFrame = performance.now();
  let lastRender = 0;
  let toastTimeout;
  let pointerDown = null;

  function addEvent(message, type = 'info') {
    events.unshift({ message, type, time: world.elapsed });
    events = events.slice(0, 24);
    uiController.renderEvents(events);
  }

  function renderUI() {
    renderer.selectedId = selectedId;
    uiController.renderUI(world, selectedId, events);
    ui.clock.textContent = window.formatTime(world.elapsed);
    ui.status.textContent = world.units.some(unit => unit.alive && unit.perceivedEnemies.length) ? 'Contact confirmed · engagements active' : 'Agents are acquiring targets';
    ui.playLabel.textContent = world.paused ? 'Resume' : 'Pause';
    ui.playIcon.textContent = world.paused ? '▶' : 'Ⅱ';
  }

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('visible');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => ui.toast.classList.remove('visible'), 1800);
  }

  function setZoom(value) {
    camera.zoom = window.clamp(value, 0.55, 2.4);
    ui.zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
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
    return { x: window.clamp(point.x, 3, WORLD_WIDTH - 3), z: window.clamp(point.z, 3, WORLD_DEPTH - 3) };
  }

  function setActiveTool(tool, team = null, announce = true) {
    activeTool = tool;
    pendingGuardTeam = tool === TOOL.GUARD ? team : FOG.OFF;
    renderer.manualStart = null;
    renderer.pendingGuardPoint = null;
    renderer.pendingGuardTeam = pendingGuardTeam;
    const savedHeading = tool === TOOL.GUARD && team ? lastGuardHeadingByTeam[team] : null;
    renderer.pendingGuardHeading = savedHeading ?? 0;
    renderer.pendingGuardHeadingManual = savedHeading !== null;
    ui.traceButton.setAttribute('aria-pressed', String(tool === TOOL.TRACE));
    ui.traceHint.hidden = tool !== TOOL.TRACE;
    ui.traceHint.textContent = 'SELECT TRACE START POINT';
    ui.buildGuardPointEmber.setAttribute('aria-pressed', String(tool === TOOL.GUARD && team === TEAMS.EMBER));
    ui.buildGuardPointTide.setAttribute('aria-pressed', String(tool === TOOL.GUARD && team === TEAMS.TIDE));
    const teamLabel = team ? HEADQUARTERS[team].label.replace(' HQ', '').toUpperCase() : '';
    ui.buildHint.textContent = tool === TOOL.GUARD ? `CLICK TO PLACE ${teamLabel} GUARD POINT · SCROLL TO ROTATE · RIGHT-CLICK TO CANCEL` : 'Select an item, click the map to place it';
    if (!announce) return;
    if (tool === TOOL.TRACE) showToast('LINE TRACE · SELECT START POINT');
    if (tool === TOOL.GUARD) showToast(`${teamLabel} GUARD POINT · CLICK TO PLACE`);
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
        } else {
          showToast('TRACE COMPLETE · NO HIT');
          addEvent('Manual line trace completed · no hit', EVENT.TRACE);
        }
      }
      return;
    }

    if (activeTool === TOOL.GUARD) {
      const team = pendingGuardTeam;
      const heading = renderer.pendingGuardHeading;
      const pointResult = world.addGuardPoint(clampToArena(worldPoint), team, heading);
      lastGuardHeadingByTeam[team] = heading;
      showToast(`GUARD POINT PLACED · ${HEADQUARTERS[pointResult.team].label.toUpperCase()}`);
      setActiveTool(TOOL.GUARD, team, false);
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

  document.querySelector('#playButton').addEventListener('click', () => {
    world.paused = !world.paused;
    renderUI();
  });

  document.querySelector('#resetButton').addEventListener('click', () => {
    world.reset();
    selectedId = world.units[0].id;
    events = [];
    addEvent('Simulation reset · four agents deployed at HQ', 'info');
    renderUI();
    showToast('SIMULATION RESET');
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
  ui.buildGuardPointEmber.addEventListener('click', () => setActiveTool(activeTool === TOOL.GUARD && pendingGuardTeam === TEAMS.EMBER ? null : TOOL.GUARD, TEAMS.EMBER));
  ui.buildGuardPointTide.addEventListener('click', () => setActiveTool(activeTool === TOOL.GUARD && pendingGuardTeam === TEAMS.TIDE ? null : TOOL.GUARD, TEAMS.TIDE));
  document.querySelector('#rangesToggle').addEventListener('change', event => { renderer.showRanges = event.target.checked; });
  document.querySelector('#sightToggle').addEventListener('change', event => { renderer.showSight = event.target.checked; });
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
    if (activeTool === TOOL.GUARD) {
      renderer.pendingGuardPoint = clampToArena(worldPoint);
      if (!renderer.pendingGuardHeadingManual) {
        const center = { x: WORLD_WIDTH / 2, z: WORLD_DEPTH / 2 };
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
    setZoom(camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  function animate(now) {
    const delta = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    world.update(delta * world.timeScale);
    renderer.draw();
    uiAccumulator += delta;
    if (uiAccumulator >= 0.12) {
      renderUI();
      uiAccumulator = 0;
    }
    if (now - lastRender > 950) {
      document.querySelector('#frameRate').textContent = `${Math.round(1 / Math.max(delta, 0.001))} FPS`;
      lastRender = now;
    }
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
})();
