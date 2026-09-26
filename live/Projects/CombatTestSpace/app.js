(() => {
  const WORLD_WIDTH = 120;
  const WORLD_DEPTH = 80;
  const TEAM = {
    Ember: { id: 1, color: '#ec785e', pale: 'rgba(236,120,94,0.14)' },
    Tide: { id: 2, color: '#439eb1', pale: 'rgba(67,158,177,0.14)' }
  };
  const TEAM_BY_ID = Object.fromEntries(Object.entries(TEAM).map(([name, def]) => [def.id, name]));
  const HEADQUARTERS = {
    Ember: { label: 'Team 1 HQ', position: { x: 10, z: 40 } },
    Tide: { label: 'Team 2 HQ', position: { x: 110, z: 40 } }
  };
  const TARGET_BEHAVIORS = {
    closest: {
      label: 'Closest in range',
      select: (unit, enemies) => enemies.slice().sort((a, b) => distanceSquared(unit.position, a.position) - distanceSquared(unit.position, b.position))[0] ?? null
    },
    random: {
      label: 'Random in range',
      select: (_unit, enemies) => enemies[Math.floor(Math.random() * enemies.length)] ?? null
    }
  };
  const COMBAT_BEHAVIORS = {
    stopAndShoot: { label: 'Stop & shoot', engagementRange: unit => unit.attackRange },
    closeAndShoot: { label: 'Close & shoot', engagementRange: unit => unit.attackRange * 0.45 }
  };
  const MOVEMENT_BEHAVIORS = {
    roam: { label: 'Roam', letter: 'R', update: (world, unit, delta) => world.runRoamStep(unit, delta) },
    guard: { label: 'Guard', letter: 'G', update: (world, unit, delta) => world.runGuardStep(unit, delta) }
  };
  const GLOBAL_ACCURACY = { maxDeviationDegrees: 8 };

  function applyAccuracySpread(dirX, dirZ) {
    const maxDeviationRadians = GLOBAL_ACCURACY.maxDeviationDegrees * Math.PI / 180;
    const deviation = (Math.random() * 2 - 1) * maxDeviationRadians;
    const cos = Math.cos(deviation);
    const sin = Math.sin(deviation);
    return { x: dirX * cos - dirZ * sin, z: dirX * sin + dirZ * cos };
  }

  class Unit {
    constructor(id, team, position, label) {
      this.id = id;
      this.team = team;
      this.teamId = TEAM[team].id;
      this.label = label;
      this.position = { x: position.x, y: 0, z: position.z };
      this.velocity = { x: 0, z: 0 };
      this.health = 100;
      this.maxHealth = 100;
      this.perceptionRange = 35;
      this.moveSpeed = 4.2;
      this.attackRange = 33;
      this.perceivedEnemies = [];
      this.targetId = null;
      this.targetBehavior = 'closest';
      this.combatBehavior = 'stopAndShoot';
      this.shootingConfig = { stopDelay: 0.3, timeUntilShoot: 0.45, bulletsPerBurst: 3 };
      this.combatState = 'approach';
      this.stateTimer = 0;
      this.shotsRemaining = 0;
      this.shotTimer = 0;
      this.hitsThisBurst = 0;
      this.heading = Math.random() * Math.PI * 2;
      this.movementBehavior = 'roam';
      this.guardPointId = null;
      this.moveDestination = null;
      this.moveState = 'selecting';
      this.moveWaitRemaining = 0;
      this.movementConfig = { waitTime: 2 };
      this.alive = true;
    }
  }

  class World {
    constructor() {
      this.units = [];
      this.traces = [];
      this.guardPoints = [];
      this.nextGuardPointId = 1;
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
      this.elapsed = 0;
      this.nextId = 1;
      for (let index = 0; index < 2; index++) {
        this.addUnit('Ember', undefined, false);
        this.addUnit('Tide', undefined, false);
      }
      this.updatePerception();
    }

    addUnit(team = this.units.length % 2 === 0 ? 'Ember' : 'Tide', position, announce = true) {
      const count = this.units.filter(unit => unit.team === team).length + 1;
      const headquarters = HEADQUARTERS[team].position;
      const spawn = position || {
        x: headquarters.x + (team === 'Ember' ? 1 : -1) * Math.random() * 4,
        y: 0,
        z: headquarters.z + (Math.random() - 0.5) * 9
      };
      const unit = new Unit(this.nextId++, team, spawn, `${team} ${String(count).padStart(2, '0')}`);
      this.units.push(unit);
      if (announce) this.onEvent(`${unit.label} deployed at ${HEADQUARTERS[team].label}`, 'info');
      return unit;
    }

    resetCombatCycle(unit) {
      unit.combatState = 'approach';
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
      unit.moveState = 'moving';
      unit.moveWaitRemaining = 0;
    }

    selectGuardWanderDestination(unit) {
      const headquarters = HEADQUARTERS[unit.team].position;
      unit.moveDestination = {
        x: clamp(headquarters.x + (Math.random() - 0.5) * 22, 4, WORLD_WIDTH - 4),
        z: clamp(headquarters.z + (Math.random() - 0.5) * 22, 4, WORLD_DEPTH - 4)
      };
      unit.moveState = 'moving';
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
      unit.moveState = 'moving';
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
      unit.heading += clamp(diff, -turnRate * delta, turnRate * delta);
    }

    runMovementBehavior(unit, delta) {
      const behavior = MOVEMENT_BEHAVIORS[unit.movementBehavior] || MOVEMENT_BEHAVIORS.roam;
      behavior.update(this, unit, delta);
    }

    runRoamStep(unit, delta) {
      if (!unit.moveDestination || unit.moveState === 'selecting') this.selectRoamDestination(unit);
      if (unit.moveState === 'waiting') {
        unit.velocity.x = 0;
        unit.velocity.z = 0;
        unit.moveWaitRemaining -= delta;
        if (unit.moveWaitRemaining <= 0) this.selectRoamDestination(unit);
        return;
      }
      const arrived = this.moveTowards(unit, unit.moveDestination, delta);
      if (arrived) {
        unit.moveState = 'waiting';
        unit.moveWaitRemaining = unit.movementConfig.waitTime;
      }
    }

    runGuardStep(unit, delta) {
      const guardPoint = unit.guardPointId !== null ? this.guardPoints.find(point => point.id === unit.guardPointId) : null;
      if (unit.moveState === 'guarding') {
        if (!guardPoint) {
          unit.moveState = 'selecting';
        } else {
          const distance = Math.hypot(guardPoint.position.x - unit.position.x, guardPoint.position.z - unit.position.z);
          if (distance > 1.5) {
            unit.moveState = 'moving';
            unit.moveDestination = { x: guardPoint.position.x, z: guardPoint.position.z };
          } else {
            unit.velocity.x = 0;
            unit.velocity.z = 0;
            this.rotateTowardsHeading(unit, guardPoint.heading, delta);
            return;
          }
        }
      }
      if (unit.moveState === 'waiting') {
        unit.velocity.x = 0;
        unit.velocity.z = 0;
        unit.moveWaitRemaining -= delta;
        if (unit.moveWaitRemaining <= 0) {
          if (!this.claimGuardPoint(unit)) this.selectGuardWanderDestination(unit);
        }
        return;
      }
      if (!unit.moveDestination || unit.moveState === 'selecting') {
        if (!this.claimGuardPoint(unit)) this.selectGuardWanderDestination(unit);
      }
      const arrived = this.moveTowards(unit, unit.moveDestination, delta);
      if (arrived) {
        unit.moveState = unit.guardPointId !== null ? 'guarding' : 'waiting';
        if (unit.moveState === 'waiting') unit.moveWaitRemaining = unit.movementConfig.waitTime;
      }
    }

    setMovementBehavior(unit, behavior) {
      if (unit.movementBehavior === 'guard' && behavior !== 'guard') this.releaseGuardPoint(unit);
      unit.movementBehavior = behavior;
      unit.moveDestination = null;
      unit.moveState = 'selecting';
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
          return dx * dx + dz * dz <= unit.perceptionRange * unit.perceptionRange &&
            this.isClearTrace(unit, other);
        }).map(other => other.id);
        const enemies = unit.perceivedEnemies.map(id => this.units.find(other => other.id === id)).filter(Boolean);
        const currentTarget = enemies.find(other => other.id === unit.targetId);
        const selector = TARGET_BEHAVIORS[unit.targetBehavior] || TARGET_BEHAVIORS.closest;
        const target = unit.targetBehavior === 'random' && currentTarget
          ? currentTarget
          : selector.select(unit, enemies);
        const nextTargetId = target ? target.id : null;
        if (unit.targetId !== nextTargetId) this.resetCombatCycle(unit);
        unit.targetId = nextTargetId;
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

    trace(start, end, ownerId = null, kind = 'manual') {
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
        life: kind === 'manual' ? 4 : 0.48
      };
      this.traces.push(trace);
      return { trace, hit };
    }

    update(delta) {
      if (this.paused) return;
      this.elapsed += delta;
      if (this.elapsed - this.lastPerceptionUpdate >= 0.2) {
        this.updatePerception();
        this.lastPerceptionUpdate = this.elapsed;
      }

      for (const unit of this.units) {
        if (!unit.alive) continue;
        const target = this.units.find(other => other.id === unit.targetId && other.alive);
        if (target) {
          const behavior = COMBAT_BEHAVIORS[unit.combatBehavior] || COMBAT_BEHAVIORS.stopAndShoot;
          behavior.update(this, unit, target, delta);
        } else {
          if (unit.combatState !== 'approach') this.resetCombatCycle(unit);
          this.runMovementBehavior(unit, delta);
        }
        unit.position.x = clamp(unit.position.x + unit.velocity.x * delta, 2.5, WORLD_WIDTH - 2.5);
        unit.position.z = clamp(unit.position.z + unit.velocity.z * delta, 2.5, WORLD_DEPTH - 2.5);
      }

      for (const trace of this.traces) trace.life -= delta;
      this.traces = this.traces.filter(trace => trace.life > 0);
    }

    fireBullet(attacker, target) {
      const dx = target.position.x - attacker.position.x;
      const dz = target.position.z - attacker.position.z;
      const distance = Math.hypot(dx, dz) || 1;
      const aim = applyAccuracySpread(dx / distance, dz / distance);
      const endpoint = { x: attacker.position.x + aim.x * attacker.attackRange, z: attacker.position.z + aim.z * attacker.attackRange };
      const result = this.trace(attacker.position, endpoint, attacker.id, 'combat');
      if (!result.hit || result.hit.team === attacker.team) return null;
      result.hit.health = Math.max(0, result.hit.health - 7);
      if (result.hit.health === 0) {
        result.hit.alive = false;
        result.hit.velocity.x = 0;
        result.hit.velocity.z = 0;
        this.releaseGuardPoint(result.hit);
        this.onEvent(`<strong>${attacker.label}</strong> eliminated <span class="event-alert">${result.hit.label}</span>`, 'combat');
        this.updatePerception();
      }
      return result.hit;
    }
  }

  function runStopAndShoot(world, unit, target, delta, engagementRange) {
    const dx = target.position.x - unit.position.x;
    const dz = target.position.z - unit.position.z;
    const distance = Math.hypot(dx, dz);
    unit.heading = Math.atan2(dz, dx);

    if (distance > engagementRange) {
      unit.combatState = 'approach';
      unit.stateTimer = 0;
      unit.shotsRemaining = 0;
      unit.velocity.x = (dx / distance) * unit.moveSpeed;
      unit.velocity.z = (dz / distance) * unit.moveSpeed;
      return;
    }

    unit.velocity.x = 0;
    unit.velocity.z = 0;
    if (unit.combatState === 'approach') {
      unit.combatState = 'stopDelay';
      unit.stateTimer = unit.shootingConfig.stopDelay;
      if (unit.stateTimer === 0) {
        unit.combatState = 'windup';
        unit.stateTimer = unit.shootingConfig.timeUntilShoot;
      }
      return;
    }

    if (unit.combatState === 'stopDelay' || unit.combatState === 'windup' || unit.combatState === 'recovery') {
      unit.stateTimer -= delta;
      if (unit.stateTimer > 0) return;
      if (unit.combatState === 'stopDelay') {
        unit.combatState = 'windup';
        unit.stateTimer = unit.shootingConfig.timeUntilShoot;
        return;
      }
      if (unit.combatState === 'windup') {
        unit.combatState = 'firing';
        unit.shotsRemaining = unit.shootingConfig.bulletsPerBurst;
        unit.shotTimer = 0;
        unit.hitsThisBurst = 0;
        world.onEvent(`<strong>${unit.label}</strong> firing ${unit.shotsRemaining}-round burst at ${target.label}`, 'combat');
      } else {
        unit.combatState = 'stopDelay';
        unit.stateTimer = unit.shootingConfig.stopDelay;
        return;
      }
    }

    if (unit.combatState !== 'firing') return;
    unit.shotTimer -= delta;
    while (unit.shotsRemaining > 0 && unit.shotTimer <= 0) {
      if (!target.alive) {
        unit.shotsRemaining = 0;
        break;
      }
      if (world.fireBullet(unit, target)) unit.hitsThisBurst++;
      unit.shotsRemaining--;
      unit.shotTimer += 0.14;
    }
    if (unit.shotsRemaining === 0) {
      if (unit.hitsThisBurst > 0) world.onEvent(`${unit.label} landed ${unit.hitsThisBurst} hit${unit.hitsThisBurst === 1 ? '' : 's'} on ${target.label}`, 'combat');
      unit.combatState = 'recovery';
      unit.stateTimer = 0.75;
    }
  }

  for (const [key, behavior] of Object.entries(COMBAT_BEHAVIORS)) {
    behavior.update = (world, unit, target, delta) => runStopAndShoot(world, unit, target, delta, behavior.engagementRange(unit));
    behavior.key = key;
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
      this.world = world;
      this.camera = camera;
      this.showRanges = false;
      this.showSight = true;
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
      this.canvas.width = Math.max(1, Math.floor(rect.width * pixelRatio));
      this.canvas.height = Math.max(1, Math.floor(rect.height * pixelRatio));
      this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
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
      for (const unit of this.world.units) {
        if (!unit.alive || unit.targetId !== null || !unit.moveDestination) continue;
        const point = this.camera.worldToScreen({ ...unit.moveDestination, y: 0 });
        const color = TEAM[unit.team].color;
        context.save();
        context.globalAlpha = unit.moveState === 'waiting' ? 0.85 : 0.45;
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
      for (const point of this.world.guardPoints) {
        const screen = this.camera.worldToScreen(point.position);
        const claimant = point.claimedBy !== null ? this.world.units.find(unit => unit.id === point.claimedBy) : null;
        const color = TEAM[point.team].color;
        const radius = Math.max(7, scale * 1.1);
        context.save();
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
      const units = this.world.units.slice().sort((a, b) => (a.position.x + a.position.z) - (b.position.x + b.position.z));
      for (const unit of units) {
        const point = this.camera.worldToScreen(unit.position);
        const radius = Math.max(6, scale * 1.7);
        const height = Math.max(11, scale * 5.3);
        const color = unit.alive ? TEAM[unit.team].color : '#75817b';
        if (this.showRanges && unit.alive) {
          context.beginPath(); context.ellipse(point.x, point.y, unit.perceptionRange * scale, unit.perceptionRange * scale * 0.52, 0, 0, Math.PI * 2); context.fillStyle = TEAM[unit.team].pale; context.fill();
        }
        context.globalAlpha = unit.alive ? 1 : 0.42;
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

    drawTraces() {
      const context = this.context;
      for (const trace of this.world.traces) {
        const start = this.camera.worldToScreen(trace.start);
        const end = this.camera.worldToScreen(trace.end);
        const alpha = trace.kind === 'manual' ? Math.min(1, trace.life) : Math.min(1, trace.life / 0.2);
        context.save();
        context.globalAlpha = alpha;
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.strokeStyle = trace.kind === 'manual' ? '#e05b43' : '#ffb06b';
        context.lineWidth = trace.kind === 'manual' ? 2 : 1.8;
        context.setLineDash(trace.kind === 'manual' ? [] : [3, 3]);
        context.stroke();
        context.setLineDash([]);
        if (trace.kind === 'manual') {
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
      for (const unit of this.world.units) {
        const point = this.camera.worldToScreen(unit.position);
        const radius = Math.max(minRadius, scale * 1.65);
        const team = TEAM[unit.team];
        const selected = unit.id === this.selectedId;
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
        if (!unit.alive) context.globalAlpha = 0.42;
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

  function distanceSquared(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = (seconds % 60).toFixed(1).padStart(4, '0');
    return `T+ ${String(minutes).padStart(2, '0')}:${remainder}`;
  }

  function addEvent(message, type = 'info') {
    events.unshift({ message, type, time: world.elapsed });
    events = events.slice(0, 24);
    renderEvents();
  }

  function renderRoster() {
    ui.count.textContent = String(world.units.length).padStart(2, '0');
    ui.roster.replaceChildren();
    for (const unit of world.units) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `roster-item${unit.id === selectedId ? ' selected' : ''}`;
      button.setAttribute('aria-pressed', String(unit.id === selectedId));
      button.innerHTML = `<span class="unit-swatch" style="background:${unit.alive ? TEAM[unit.team].color : '#9aa39d'}"></span><span class="roster-copy"><span class="roster-name">${unit.label}</span><span class="roster-team">${unit.team.toUpperCase()}</span></span><span class="roster-health${unit.alive ? '' : ' dead'}">${unit.alive ? `${Math.ceil(unit.health)}%` : 'DOWN'}</span>`;
      button.addEventListener('click', () => {
        selectedId = unit.id;
        renderer.selectedId = selectedId;
        renderUI();
      });
      ui.roster.append(button);
    }
  }

  function renderInspector() {
    if (ui.inspector.contains(document.activeElement)) return;
    const unit = world.units.find(candidate => candidate.id === selectedId) || world.units[0];
    if (!unit) {
      ui.inspector.innerHTML = '<p class="empty-copy">No units in arena.</p>';
      return;
    }
    const team = TEAM[unit.team];
    const target = world.units.find(candidate => candidate.id === unit.targetId && candidate.alive);
    const perceived = unit.perceivedEnemies.map(id => world.units.find(candidate => candidate.id === id)).filter(Boolean);
    const combatOptions = Object.entries(COMBAT_BEHAVIORS).map(([key, behavior]) => `<option value="${key}"${unit.combatBehavior === key ? ' selected' : ''}>${behavior.label}</option>`).join('');
    const targetOptions = Object.entries(TARGET_BEHAVIORS).map(([key, behavior]) => `<option value="${key}"${unit.targetBehavior === key ? ' selected' : ''}>${behavior.label}</option>`).join('');
    const movementOptions = Object.entries(MOVEMENT_BEHAVIORS).map(([key, behavior]) => `<option value="${key}"${unit.movementBehavior === key ? ' selected' : ''}>${behavior.label}</option>`).join('');
    const guardStatus = unit.movementBehavior === 'guard'
      ? `<div class="target-row"><span>Guard point</span><span class="target-value">${unit.guardPointId !== null ? `#${unit.guardPointId} · ${unit.moveState === 'guarding' ? 'HOLDING' : 'EN ROUTE'}` : 'SEEKING'}</span></div>`
      : '';
    ui.inspector.innerHTML = `
      <div class="selected-unit-head"><span class="selected-unit-mark" style="background:${unit.alive ? team.color : '#8a9690'}">${unit.team[0]}</span><span><span class="selected-unit-name">${unit.label}</span><span class="selected-unit-team">${unit.team.toUpperCase()} · ${unit.alive ? 'ACTIVE' : 'DOWN'}</span></span></div>
      <div class="health-row"><span>Health</span><span class="health-value">${Math.ceil(unit.health)} <span style="color:#9aa69f">/ ${unit.maxHealth} HP</span></span></div>
      <div class="health-track"><div class="health-fill${unit.health < 36 ? ' low' : ''}" style="width:${unit.health}%"></div></div>
      <div class="stat-grid"><div><div class="stat-label">POSITION X</div><div class="stat-value">${unit.position.x.toFixed(1)} m</div></div><div><div class="stat-label">POSITION Z</div><div class="stat-value">${unit.position.z.toFixed(1)} m</div></div><div><div class="stat-label">HEIGHT Y</div><div class="stat-value">${unit.position.y.toFixed(1)} m</div></div><div><div class="stat-label">PERCEPTION</div><div class="stat-value">${unit.perceptionRange} m</div></div></div>
      <div class="target-row"><span>Current target</span><span class="target-value">${target ? target.label : 'NONE'}</span></div>
      <div class="perceived-block"><div class="subheading"><span>PERCEIVED ENEMIES</span><span>${perceived.length.toString().padStart(2, '0')}</span></div><div class="perceived-list">${perceived.length ? perceived.map(enemy => `<span class="perceived-chip" style="--chip-color:${TEAM[enemy.team].color}">${enemy.label}</span>`).join('') : '<span class="empty-copy">No contacts</span>'}</div></div>
      <div class="behavior-block"><div class="subheading"><span>COMBAT BEHAVIOUR</span><span class="section-index">03</span></div><label class="config-field">Combat style<select class="config-select" data-setting="combatBehavior">${combatOptions}</select></label><label class="config-field target-setting">Target selection<select class="config-select" data-setting="targetBehavior">${targetOptions}</select></label><label class="config-field target-setting">Movement style<select class="config-select" data-setting="movementBehavior">${movementOptions}</select></label>${guardStatus}
      <div class="subheading shooting-heading"><span>BURST CONFIG</span></div><div class="shooting-grid">
        <label class="config-field">Stop delay<span class="number-control"><input data-setting="stopDelay" type="number" min="0" max="5" step="0.1" value="${unit.shootingConfig.stopDelay.toFixed(1)}"><span>s</span></span></label>
        <label class="config-field">Time until shoot<span class="number-control"><input data-setting="timeUntilShoot" type="number" min="0" max="5" step="0.1" value="${unit.shootingConfig.timeUntilShoot.toFixed(1)}"><span>s</span></span></label>
        <label class="config-field bullet-count-field">Bullets per burst<span class="number-control"><input data-setting="bulletsPerBurst" type="number" min="1" max="20" step="1" value="${unit.shootingConfig.bulletsPerBurst}"><span>rnd</span></span></label>
      </div></div>`;

    const movementField = document.createElement('div');
    movementField.className = 'movement-config';
    movementField.innerHTML = `<div class="subheading movement-heading"><span>WAYPOINT CONFIG</span></div><label class="config-field">Wait at destination<span class="number-control"><input data-setting="moveWaitTime" type="number" min="0" max="20" step="0.5" value="${unit.movementConfig.waitTime.toFixed(1)}"><span>s</span></span></label>`;
    ui.inspector.append(movementField);

    ui.inspector.querySelector('[data-setting="combatBehavior"]').addEventListener('change', event => {
      unit.combatBehavior = event.target.value;
      world.resetCombatCycle(unit);
      renderUI();
    });
    ui.inspector.querySelector('[data-setting="targetBehavior"]').addEventListener('change', event => {
      unit.targetBehavior = event.target.value;
      unit.targetId = null;
      world.updatePerception();
      renderUI();
    });
    ui.inspector.querySelector('[data-setting="movementBehavior"]').addEventListener('change', event => {
      world.setMovementBehavior(unit, event.target.value);
      renderUI();
    });
    for (const [key, min, max, integer] of [
      ['stopDelay', 0, 5, false],
      ['timeUntilShoot', 0, 5, false],
      ['bulletsPerBurst', 1, 20, true]
    ]) {
      ui.inspector.querySelector(`[data-setting="${key}"]`).addEventListener('input', event => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value)) return;
        unit.shootingConfig[key] = integer ? Math.round(clamp(value, min, max)) : clamp(value, min, max);
      });
    }
    ui.inspector.querySelector('[data-setting="moveWaitTime"]').addEventListener('input', event => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) unit.movementConfig.waitTime = clamp(value, 0, 20);
    });
  }

  function renderEvents() {
    ui.eventCount.textContent = String(events.length).padStart(2, '0');
    ui.events.innerHTML = events.length ? events.map(event => `<div class="event-item"><span class="event-time">${formatTime(event.time).slice(3)}</span><span class="event-message">${event.message}</span></div>`).join('') : '<p class="empty-copy">Waiting for activity</p>';
  }

  function renderUI() {
    renderer.selectedId = selectedId;
    renderRoster();
    renderInspector();
    ui.clock.textContent = formatTime(world.elapsed);
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
    camera.zoom = clamp(value, 0.55, 2.4);
    ui.zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
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
    return { x: clamp(point.x, 3, WORLD_WIDTH - 3), z: clamp(point.z, 3, WORLD_DEPTH - 3) };
  }

  function setActiveTool(tool, team = null, announce = true) {
    activeTool = tool;
    pendingGuardTeam = tool === 'guard' ? team : null;
    renderer.manualStart = null;
    renderer.pendingGuardPoint = null;
    renderer.pendingGuardTeam = pendingGuardTeam;
    const savedHeading = tool === 'guard' && team ? lastGuardHeadingByTeam[team] : null;
    renderer.pendingGuardHeading = savedHeading ?? 0;
    renderer.pendingGuardHeadingManual = savedHeading !== null;
    ui.traceButton.setAttribute('aria-pressed', String(tool === 'trace'));
    ui.traceHint.hidden = tool !== 'trace';
    ui.traceHint.textContent = 'SELECT TRACE START POINT';
    ui.buildGuardPointEmber.setAttribute('aria-pressed', String(tool === 'guard' && team === 'Ember'));
    ui.buildGuardPointTide.setAttribute('aria-pressed', String(tool === 'guard' && team === 'Tide'));
    const teamLabel = team ? HEADQUARTERS[team].label.replace(' HQ', '').toUpperCase() : '';
    ui.buildHint.textContent = tool === 'guard' ? `CLICK TO PLACE ${teamLabel} GUARD POINT · SCROLL TO ROTATE · RIGHT-CLICK TO CANCEL` : 'Select an item, click the map to place it';
    if (!announce) return;
    if (tool === 'trace') showToast('LINE TRACE · SELECT START POINT');
    if (tool === 'guard') showToast(`${teamLabel} GUARD POINT · CLICK TO PLACE`);
  }

  function handleCanvasClick(point) {
    const worldPoint = camera.screenToWorld(point);
    if (activeTool === 'trace') {
      if (!renderer.manualStart) {
        renderer.manualStart = worldPoint;
        ui.traceHint.textContent = 'SELECT TRACE END POINT';
      } else {
        const result = world.trace(renderer.manualStart, worldPoint, null, 'manual');
        setActiveTool(null);
        if (result.hit) {
          showToast(`TRACE HIT ${result.hit.label} · ${result.hit.health.toFixed(0)} HP`);
          addEvent(`Manual trace hit <strong>${result.hit.label}</strong>`, 'trace');
        } else {
          showToast('TRACE COMPLETE · NO HIT');
          addEvent('Manual line trace completed · no hit', 'trace');
        }
      }
      return;
    }
    if (activeTool === 'guard') {
      const team = pendingGuardTeam;
      const heading = renderer.pendingGuardHeading;
      const point = world.addGuardPoint(clampToArena(worldPoint), team, heading);
      lastGuardHeadingByTeam[team] = heading;
      showToast(`GUARD POINT PLACED · ${HEADQUARTERS[point.team].label.toUpperCase()}`);
      setActiveTool('guard', team, false);
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
  renderEvents();

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
  let spawnType = 'roam';
  function setSpawnType(type) {
    spawnType = type;
    document.querySelector('#spawnTypeRoam').classList.toggle('active', type === 'roam');
    document.querySelector('#spawnTypeGuard').classList.toggle('active', type === 'guard');
  }
  function spawnUnit(team) {
    const unit = world.addUnit(team);
    world.setMovementBehavior(unit, spawnType);
    selectedId = unit.id;
    renderUI();
    showToast(`${unit.label.toUpperCase()} DEPLOYED \u00b7 ${MOVEMENT_BEHAVIORS[spawnType].label.toUpperCase()}`);
  }
  document.querySelector('#spawnEmberButton').addEventListener('click', () => spawnUnit('Ember'));
  document.querySelector('#spawnTideButton').addEventListener('click', () => spawnUnit('Tide'));
  document.querySelector('#spawnTypeRoam').addEventListener('click', () => setSpawnType('roam'));
  document.querySelector('#spawnTypeGuard').addEventListener('click', () => setSpawnType('guard'));
  ui.traceButton.addEventListener('click', () => {
    setActiveTool(activeTool === 'trace' ? null : 'trace');
  });
  ui.buildGuardPointEmber.addEventListener('click', () => {
    setActiveTool(activeTool === 'guard' && pendingGuardTeam === 'Ember' ? null : 'guard', 'Ember');
  });
  ui.buildGuardPointTide.addEventListener('click', () => {
    setActiveTool(activeTool === 'guard' && pendingGuardTeam === 'Tide' ? null : 'guard', 'Tide');
  });
  document.querySelector('#rangesToggle').addEventListener('change', event => { renderer.showRanges = event.target.checked; });
  document.querySelector('#sightToggle').addEventListener('change', event => { renderer.showSight = event.target.checked; });
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
    if (activeTool === 'guard') {
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
    if (activeTool === 'guard') {
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