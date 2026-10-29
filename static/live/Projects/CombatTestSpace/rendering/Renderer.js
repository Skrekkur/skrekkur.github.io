(function (global) {
  const { STATE, TRACE, FOG } = global.GAME_CONSTANTS;
  const TEAM = global.TEAM;
  const HEADQUARTERS = global.HEADQUARTERS;
  const MOVEMENT_BEHAVIORS = global.MOVEMENT_BEHAVIORS;
  const OBSTACLE_SIZE = global.OBSTACLE_SIZE;

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
      this.showPaths = false;
      this.showReachability = true;
      this.showReachabilityGraph = false;
      this.showNavigationGrid = false;
      this.showFog = false;
      this.fogOfWarTeam = null;
      this.fogHideInvisible = false;
      this.selectedId = 1;
      this.manualStart = null;
      this.cursorWorld = null;
      this.pendingGuardPoint = null;
      this.pendingGuardTeam = null;
      this.pendingGuardVariant = 'guard';
      this.pendingGuardHeading = 0;
      this.pendingGuardHeadingManual = false;
      this.pendingObstaclePoint = null;
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
      this.drawObstacles(scale);
      this.drawReachabilityGraph();
      this.drawReachability(scale);
      this.drawNavigationGrid();
      this.drawPaths();
      this.drawMoveDestinations(scale);
      this.drawGuardPoints(scale);
      this.drawSightLines();
      this.drawTraces();
      if (camera.view === 'iso') this.drawIsoUnits(scale);
      else this.drawUnits(scale);
      if (this.showFog && this.fogOfWarTeam !== null) this.drawFogOfWar();
      if (this.manualStart) this.drawManualPreview();
      if (this.pendingGuardPoint) this.drawGuardPreview();
      if (this.pendingObstaclePoint) this.drawObstaclePreview();
    }

    drawIsoArena(scale) {
      const context = this.context;
      const corners = [
        this.camera.worldToScreen({ x: 0, y: 0, z: 0 }),
        this.camera.worldToScreen({ x: this.world.width, y: 0, z: 0 }),
        this.camera.worldToScreen({ x: this.world.width, y: 0, z: this.world.depth }),
        this.camera.worldToScreen({ x: 0, y: 0, z: this.world.depth })
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
      for (let value = 10; value < this.world.width; value += 10) this.drawIsoLine({ x: value, y: 0, z: 0 }, { x: value, y: 0, z: this.world.depth });
      for (let value = 10; value < this.world.depth; value += 10) this.drawIsoLine({ x: 0, y: 0, z: value }, { x: this.world.width, y: 0, z: value });
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
        this.drawIsoBox(headquarters.position, 6, 6, 8, team.color, {
          minFootprint: 20,
          minHeight: 12
        });
        this.context.fillStyle = team.color;
        this.context.font = '600 9px "DM Mono", monospace';
        this.context.textAlign = 'center';
        this.context.fillText(headquarters.label.toUpperCase(), point.x, point.y + 16);
      }
    }

    drawObstacles(scale) {
      const context = this.context;
      const obstacles = this.camera.view === 'iso'
        ? this.world.obstacles.slice().sort((left, right) =>
          this.camera.worldToScreen(left.position).y - this.camera.worldToScreen(right.position).y)
        : this.world.obstacles;
      for (const obstacle of obstacles) {
        if (this.camera.view === 'iso') {
          this.drawIsoBox(obstacle.position, obstacle.width, obstacle.depth, 5, '#75624f', { minHeight: 7 });
          continue;
        }
        const topLeft = this.camera.worldToScreen({ x: obstacle.position.x - obstacle.width / 2, z: obstacle.position.z - obstacle.depth / 2 });
        const bottomRight = this.camera.worldToScreen({ x: obstacle.position.x + obstacle.width / 2, z: obstacle.position.z + obstacle.depth / 2 });
        context.fillStyle = '#75624f';
        context.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        context.strokeStyle = '#c5ad8f';
        context.lineWidth = 1.3;
        context.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        context.strokeStyle = 'rgba(255,255,255,.13)';
        context.beginPath();
        context.moveTo(topLeft.x, topLeft.y);
        context.lineTo(bottomRight.x, bottomRight.y);
        context.moveTo(bottomRight.x, topLeft.y);
        context.lineTo(topLeft.x, bottomRight.y);
        context.stroke();
      }
    }

    drawNavigationGrid() {
      if (!this.showNavigationGrid) return;
      const context = this.context;
      const navigation = this.world.navigation;
      const selectedUnit = this.world.units.find(unit => unit.id === this.selectedId && unit.alive) ?? this.world.units.find(unit => unit.alive);
      const agentRadius = Math.max(0, selectedUnit?.navigationRadius ?? selectedUnit?.radius ?? 0);

      context.save();
      context.lineWidth = 0.75;
      for (let z = 0; z < navigation.rows; z++) {
        for (let x = 0; x < navigation.columns; x++) {
          const cell = { x, z };
          const minX = x * navigation.cellSize;
          const minZ = z * navigation.cellSize;
          const maxX = Math.min(this.world.width, minX + navigation.cellSize);
          const maxZ = Math.min(this.world.depth, minZ + navigation.cellSize);
          const corners = [
            this.camera.worldToScreen({ x: minX, z: minZ }),
            this.camera.worldToScreen({ x: maxX, z: minZ }),
            this.camera.worldToScreen({ x: maxX, z: maxZ }),
            this.camera.worldToScreen({ x: minX, z: maxZ })
          ];
          const blocked = navigation.isCellBlocked(cell, this.world.obstacles, agentRadius);
          context.beginPath();
          corners.forEach((corner, index) => index ? context.lineTo(corner.x, corner.y) : context.moveTo(corner.x, corner.y));
          context.closePath();
          context.fillStyle = blocked ? 'rgba(224,91,67,.2)' : 'rgba(56,184,122,.025)';
          context.fill();
          context.strokeStyle = blocked ? 'rgba(224,91,67,.48)' : 'rgba(56,184,122,.25)';
          context.stroke();
        }
      }
      context.restore();
    }

    drawReachability(scale) {
      if (!this.showReachability) return;
      if (this.world.reachabilityMode === 'objects') {
        this.drawObjectReachability(scale);
        return;
      }
      const context = this.context;
      const navigation = this.world.navigation;
      const teams = Object.keys(HEADQUARTERS);
      const markerOffset = navigation.cellSize * 0.16;
      const cellPixels = navigation.cellSize * scale;
      const stride = Math.max(1, Math.ceil(7 / Math.max(cellPixels, 0.01)));

      context.save();
      for (let z = 0; z < navigation.rows; z += stride) {
        for (let x = 0; x < navigation.columns; x += stride) {
          const key = z * navigation.columns + x;
          const center = navigation.cellToPoint({ x, z });
          teams.forEach((teamName, teamIndex) => {
            if (!this.world.reachabilityByTeam[teamName]?.has(key)) return;
            const direction = teamIndex === 0 ? -1 : 1;
            const position = {
              x: center.x + markerOffset * direction,
              y: 0,
              z: center.z + markerOffset * direction
            };
            const color = TEAM[teamName].color;
            const screen = this.camera.worldToScreen(position);
            if (screen.x < -10 || screen.x > this.camera.width + 10 || screen.y < -10 || screen.y > this.camera.height + 10) return;
            if (this.camera.view === 'iso') {
              this.drawIsoMarkerBox(screen, Math.max(1.8, scale * 0.38), Math.max(1.1, scale * 0.2), Math.max(2.5, scale * 0.55), color);
            } else {
              const size = Math.max(3, Math.min(6, scale * 0.7));
              context.fillStyle = color;
              context.globalAlpha = 0.82;
              context.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
              context.strokeStyle = 'rgba(255,255,250,.72)';
              context.lineWidth = 0.65;
              context.strokeRect(screen.x - size / 2, screen.y - size / 2, size, size);
            }
          });
        }
      }
      context.restore();
    }

    drawReachabilityGraph() {
      if (!this.showReachabilityGraph ||
          this.world.reachabilityMode !== 'objects' ||
          this.world.reachabilityAlgorithm !== 'graph') return;

      const context = this.context;
      context.save();
      context.globalAlpha = 0.72;
      context.setLineDash([5, 4]);
      for (const connection of this.world.reachabilityGraphConnections) {
        const start = this.camera.worldToScreen(connection.from.position);
        const end = this.camera.worldToScreen(connection.to.position);
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.strokeStyle = TEAM[connection.team]?.color ?? this.theme.strongLabel;
        context.lineWidth = connection.source === 'headquarters' ? 1.2 : 2;
        context.stroke();
      }
      context.restore();
    }

    drawObjectReachability(scale) {
      const context = this.context;
      const teams = Object.keys(HEADQUARTERS);
      const targets = this.world.reachabilityCheckUnits
        ? this.world.units.filter(unit => unit.alive).map(unit => ({ kind: 'unit', object: unit }))
        : this.world.guardPoints.map(point => ({ kind: 'guard', object: point }));

      context.save();
      context.globalAlpha = 0.9;
      for (const target of targets) {
        const reachableTeams = this.world.reachabilityByObject.get(
          this.world.objectReachabilityKey(target.kind, target.object.id)
        ) ?? new Set();
        const base = this.camera.worldToScreen(target.object.position);
        teams.forEach((teamName, teamIndex) => {
          if (!reachableTeams.has(teamName)) return;
          const direction = teamIndex === 0 ? -1 : 1;
          const screen = { x: base.x + direction * 7, y: base.y - 14 };
          const color = TEAM[teamName].color;
          if (this.camera.view === 'iso') {
            this.drawIsoMarkerBox(screen, Math.max(2.2, scale * 0.4), Math.max(1.3, scale * 0.22), Math.max(3, scale * 0.6), color);
          } else {
            const size = 5;
            context.fillStyle = color;
            context.fillRect(screen.x - size / 2, screen.y - size / 2, size, size);
            context.strokeStyle = 'rgba(255,255,250,.8)';
            context.lineWidth = 0.7;
            context.strokeRect(screen.x - size / 2, screen.y - size / 2, size, size);
          }
        });
      }
      context.restore();
    }

    drawPaths() {
      if (!this.showPaths) return;
      const context = this.context;
      const fogActive = this.showFog && this.fogOfWarTeam !== FOG.OFF;
      for (const unit of this.world.units) {
        if (!unit.alive || unit.pathIndex >= unit.path.length) continue;
        const visible = !fogActive || this.isVisibleToTeam(unit, this.fogOfWarTeam);
        if (fogActive && !visible && this.fogHideInvisible) continue;
        const points = [unit.position, ...unit.path.slice(unit.pathIndex)];
        context.save();
        context.globalAlpha = fogActive && !visible ? 0.12 : 0.58;
        context.strokeStyle = TEAM[unit.team].color;
        context.lineWidth = 1.5;
        context.setLineDash([5, 4]);
        context.beginPath();
        points.forEach((point, index) => {
          const screen = this.camera.worldToScreen(point);
          if (index === 0) context.moveTo(screen.x, screen.y);
          else context.lineTo(screen.x, screen.y);
        });
        context.stroke();
        context.setLineDash([]);
        for (const point of points.slice(1, -1)) {
          const screen = this.camera.worldToScreen(point);
          context.beginPath();
          context.arc(screen.x, screen.y, 2.3, 0, Math.PI * 2);
          context.fillStyle = TEAM[unit.team].color;
          context.fill();
        }
        context.restore();
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
        context.rotate(point.variant === 'machineGun' && claimant ? claimant.heading : point.heading);
        if (point.variant === 'machineGun') this.drawMachineGunCone(claimant?.attackRange ?? 70, scale, color);
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
        context.fillText(claimant ? `${point.variant === 'machineGun' ? 'MG' : 'GUARDED'} · ${claimant.label}` : `${point.variant === 'machineGun' ? 'MG · ' : ''}OPEN · ${HEADQUARTERS[point.team].label.replace(' HQ', '').toUpperCase()}`, screen.x, screen.y + radius + 10);
      }
    }

    drawMachineGunCone(range, scale, color) {
      const context = this.context;
      const halfAngle = window.MACHINE_GUN_CONFIG.coneOfFireDegrees * Math.PI / 360;
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, range * scale, -halfAngle, halfAngle);
      context.closePath();
      context.fillStyle = `${color}18`;
      context.fill();
      context.strokeStyle = `${color}66`;
      context.lineWidth = 1;
      context.stroke();
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
      if (this.pendingGuardVariant === 'machineGun') this.drawMachineGunCone(70, this.camera.scale, color);
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
      context.fillText(`${this.pendingGuardVariant === 'machineGun' ? 'MACHINE GUN' : 'GUARD POINT'} · ${teamLabel} · SCROLL TO ROTATE`, screen.x, screen.y - radius - 10);
    }

    drawObstaclePreview() {
      const point = this.pendingObstaclePoint;
      const valid = this.world.canPlaceObstacle(point);
      const half = OBSTACLE_SIZE / 2;
      const corners = [
        this.camera.worldToScreen({ x: point.x - half, z: point.z - half }),
        this.camera.worldToScreen({ x: point.x + half, z: point.z - half }),
        this.camera.worldToScreen({ x: point.x + half, z: point.z + half }),
        this.camera.worldToScreen({ x: point.x - half, z: point.z + half })
      ];
      const context = this.context;
      context.save();
      context.globalAlpha = 0.7;
      context.fillStyle = valid ? 'rgba(167,137,105,.42)' : 'rgba(224,91,67,.36)';
      context.strokeStyle = valid ? '#c5ad8f' : '#e05b43';
      context.lineWidth = 1.5;
      context.setLineDash([5, 3]);
      context.beginPath();
      corners.forEach((corner, index) => index ? context.lineTo(corner.x, corner.y) : context.moveTo(corner.x, corner.y));
      context.closePath();
      context.fill();
      context.stroke();
      context.restore();
    }

    drawIsoBox(position, width, depth, height, color, options = {}) {
      const context = this.context;
      const halfWidth = width / 2;
      const halfDepth = depth / 2;
      const baseY = position.y ?? 0;
      const center = this.camera.worldToScreen({ ...position, y: baseY });
      let bottom = [
        this.camera.worldToScreen({ x: position.x - halfWidth, y: baseY, z: position.z - halfDepth }),
        this.camera.worldToScreen({ x: position.x + halfWidth, y: baseY, z: position.z - halfDepth }),
        this.camera.worldToScreen({ x: position.x + halfWidth, y: baseY, z: position.z + halfDepth }),
        this.camera.worldToScreen({ x: position.x - halfWidth, y: baseY, z: position.z + halfDepth })
      ];
      const spanX = Math.max(...bottom.map(point => point.x)) - Math.min(...bottom.map(point => point.x));
      const spanY = Math.max(...bottom.map(point => point.y)) - Math.min(...bottom.map(point => point.y));
      const footprintScale = Math.max(1, (options.minFootprint ?? 0) / Math.max(spanX, spanY, 0.001));
      if (footprintScale > 1) {
        bottom = bottom.map(point => ({
          x: center.x + (point.x - center.x) * footprintScale,
          y: center.y + (point.y - center.y) * footprintScale
        }));
      }

      const heightPixels = Math.max(options.minHeight ?? 0, height * this.camera.getScale());
      const top = bottom.map(point => ({ x: point.x, y: point.y - heightPixels }));
      const nearestIndex = bottom.reduce((nearest, point, index) => point.y > bottom[nearest].y ? index : nearest, 0);
      const visibleEdges = [
        [(nearestIndex + 3) % 4, nearestIndex],
        [nearestIndex, (nearestIndex + 1) % 4]
      ].sort((left, right) =>
        (bottom[left[0]].y + bottom[left[1]].y) - (bottom[right[0]].y + bottom[right[1]].y)
      );
      const tracePolygon = points => {
        context.beginPath();
        points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
        context.closePath();
      };

      context.save();
      context.lineJoin = 'round';
      visibleEdges.forEach(([from, to], index) => {
        const face = [top[from], top[to], bottom[to], bottom[from]];
        tracePolygon(face);
        context.fillStyle = color;
        context.fill();
        tracePolygon(face);
        context.fillStyle = index ? 'rgba(0,0,0,.27)' : 'rgba(0,0,0,.16)';
        context.fill();
        context.strokeStyle = 'rgba(255,254,250,.65)';
        context.lineWidth = 1;
        context.stroke();
      });
      tracePolygon(top);
      context.fillStyle = color;
      context.fill();
      context.strokeStyle = 'rgba(255,254,250,.78)';
      context.lineWidth = 1;
      context.stroke();
      context.restore();
    }

    drawIsoMarkerBox(point, width, depth, height, color) {
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
        const radius = Math.max(6, scale * unit.radius);
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
      const bottomRight = this.camera.worldToScreen({ x: this.world.width, z: this.world.depth });
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
      for (let x = 0; x <= this.world.width; x += 10) {
        const point = this.camera.worldToScreen({ x, z: 0 });
        context.moveTo(point.x, top);
        context.lineTo(point.x, top + this.world.depth * scale);
      }
      for (let z = 0; z <= this.world.depth; z += 10) {
        const point = this.camera.worldToScreen({ x: 0, z });
        context.moveTo(left, point.y);
        context.lineTo(left + this.world.width * scale, point.y);
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
        const radius = Math.max(minRadius, scale * unit.radius);
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

  global.Renderer = Renderer;
})(window);
