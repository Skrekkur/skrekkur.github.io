(function (global) {
  class NavigationSystem {
    constructor(width, depth, cellSize = 4) {
      this.width = width;
      this.depth = depth;
      this.cellSize = cellSize;
      this.columns = Math.ceil(width / cellSize);
      this.rows = Math.ceil(depth / cellSize);
    }

    clearPath(unit, revision) {
      unit.path = [];
      unit.pathIndex = 0;
      unit.pathDestination = null;
      unit.pathRevision = revision;
      unit.pathRadius = null;
    }

    pointToCell(point) {
      return {
        x: global.clamp(Math.floor(point.x / this.cellSize), 0, this.columns - 1),
        z: global.clamp(Math.floor(point.z / this.cellSize), 0, this.rows - 1)
      };
    }

    cellToPoint(cell) {
      return { x: (cell.x + 0.5) * this.cellSize, z: (cell.z + 0.5) * this.cellSize };
    }

    isCellInBounds(cell) {
      return cell.x >= 0 && cell.z >= 0 && cell.x < this.columns && cell.z < this.rows;
    }

    segmentObstacleHit(start, end, obstacle, padding = 0) {
      const minX = obstacle.position.x - obstacle.width / 2 - padding;
      const maxX = obstacle.position.x + obstacle.width / 2 + padding;
      const minZ = obstacle.position.z - obstacle.depth / 2 - padding;
      const maxZ = obstacle.position.z + obstacle.depth / 2 + padding;
      const dx = end.x - start.x;
      const dz = end.z - start.z;
      let near = 0;
      let far = 1;

      for (const [origin, direction, min, max] of [[start.x, dx, minX, maxX], [start.z, dz, minZ, maxZ]]) {
        if (Math.abs(direction) < 0.000001) {
          if (origin < min || origin > max) return null;
          continue;
        }
        const first = (min - origin) / direction;
        const second = (max - origin) / direction;
        near = Math.max(near, Math.min(first, second));
        far = Math.min(far, Math.max(first, second));
        if (near > far) return null;
      }
      return near >= 0 && near <= 1 ? near : null;
    }

    isPointNavigable(point, obstacles, agentRadius) {
      if (point.x - agentRadius < 0 || point.x + agentRadius > this.width || point.z - agentRadius < 0 || point.z + agentRadius > this.depth) return false;
      return !obstacles.some(obstacle => {
        const halfWidth = obstacle.width / 2 + agentRadius;
        const halfDepth = obstacle.depth / 2 + agentRadius;
        return Math.abs(point.x - obstacle.position.x) <= halfWidth && Math.abs(point.z - obstacle.position.z) <= halfDepth;
      });
    }

    isClearSegment(start, end, obstacles, agentRadius) {
      if (!this.isPointNavigable(end, obstacles, agentRadius)) return false;
      return !obstacles.some(obstacle => this.segmentObstacleHit(start, end, obstacle, agentRadius) !== null);
    }

    isCellBlocked(cell, obstacles, agentRadius) {
      return !this.isCellInBounds(cell) || !this.isPointNavigable(this.cellToPoint(cell), obstacles, agentRadius);
    }

    nearestWalkableCell(cell, obstacles, agentRadius) {
      if (!this.isCellBlocked(cell, obstacles, agentRadius)) return cell;
      for (let searchRadius = 1; searchRadius < Math.max(this.columns, this.rows); searchRadius++) {
        for (let dz = -searchRadius; dz <= searchRadius; dz++) {
          for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== searchRadius) continue;
            const candidate = { x: cell.x + dx, z: cell.z + dz };
            if (!this.isCellBlocked(candidate, obstacles, agentRadius)) return candidate;
          }
        }
      }
      return null;
    }

    nearestReachableCell(point, obstacles, agentRadius) {
      const originCell = this.pointToCell(point);
      for (let searchRadius = 0; searchRadius < Math.max(this.columns, this.rows); searchRadius++) {
        for (let dz = -searchRadius; dz <= searchRadius; dz++) {
          for (let dx = -searchRadius; dx <= searchRadius; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== searchRadius) continue;
            const candidate = { x: originCell.x + dx, z: originCell.z + dz };
            if (this.isCellBlocked(candidate, obstacles, agentRadius)) continue;
            if (this.isClearSegment(point, this.cellToPoint(candidate), obstacles, agentRadius)) return candidate;
          }
        }
      }
      return null;
    }

    findPath(start, destination, obstacles = [], agentRadius = 0) {
      if (this.isPointNavigable(destination, obstacles, agentRadius) && this.isClearSegment(start, destination, obstacles, agentRadius)) {
        return [{ x: destination.x, z: destination.z }];
      }

      const startCell = this.nearestReachableCell(start, obstacles, agentRadius);
      const goalCell = this.nearestWalkableCell(this.pointToCell(destination), obstacles, agentRadius);
      if (!startCell || !goalCell) return [];

      const keyFor = cell => cell.z * this.columns + cell.x;
      const heuristic = cell => {
        const dx = Math.abs(cell.x - goalCell.x);
        const dz = Math.abs(cell.z - goalCell.z);
        return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
      };
      const startKey = keyFor(startCell);
      const goalKey = keyFor(goalCell);
      const open = [{ ...startCell, key: startKey, g: 0, f: heuristic(startCell) }];
      const costs = new Map([[startKey, 0]]);
      const parents = new Map();
      const closed = new Set();
      const directions = [
        { x: 1, z: 0, cost: 1 }, { x: -1, z: 0, cost: 1 },
        { x: 0, z: 1, cost: 1 }, { x: 0, z: -1, cost: 1 },
        { x: 1, z: 1, cost: Math.SQRT2 }, { x: 1, z: -1, cost: Math.SQRT2 },
        { x: -1, z: 1, cost: Math.SQRT2 }, { x: -1, z: -1, cost: Math.SQRT2 }
      ];

      while (open.length) {
        let bestIndex = 0;
        for (let index = 1; index < open.length; index++) if (open[index].f < open[bestIndex].f) bestIndex = index;
        const current = open.splice(bestIndex, 1)[0];
        if (closed.has(current.key)) continue;
        if (current.key === goalKey) {
          const cells = [];
          let key = goalKey;
          while (key !== startKey) {
            cells.push({ x: key % this.columns, z: Math.floor(key / this.columns) });
            key = parents.get(key);
            if (key === undefined) return [];
          }
          cells.reverse();
          const startPoint = this.cellToPoint(startCell);
          const path = global.distanceSquared(start, startPoint) > 0.000001 ? [startPoint] : [];
          path.push(...cells.map(cell => this.cellToPoint(cell)));
          const lastPoint = path[path.length - 1] || start;
          if (this.isClearSegment(lastPoint, destination, obstacles, agentRadius)) path.push({ x: destination.x, z: destination.z });
          return path;
        }
        closed.add(current.key);

        for (const direction of directions) {
          const next = { x: current.x + direction.x, z: current.z + direction.z };
          if (this.isCellBlocked(next, obstacles, agentRadius)) continue;
          if (direction.x && direction.z && (
            this.isCellBlocked({ x: current.x + direction.x, z: current.z }, obstacles, agentRadius) ||
            this.isCellBlocked({ x: current.x, z: current.z + direction.z }, obstacles, agentRadius)
          )) continue;
          if (!this.isClearSegment(this.cellToPoint(current), this.cellToPoint(next), obstacles, agentRadius)) continue;
          const key = keyFor(next);
          const cost = current.g + direction.cost;
          if (cost >= (costs.get(key) ?? Infinity)) continue;
          costs.set(key, cost);
          parents.set(key, current.key);
          open.push({ ...next, key, g: cost, f: cost + heuristic(next) });
        }
      }
      return [];
    }

    moveTowards(unit, destination, delta, obstacles, revision) {
      const agentRadius = Math.max(0, unit.navigationRadius ?? unit.radius ?? 0);
      const destinationChanged = !unit.pathDestination || global.distanceSquared(unit.pathDestination, destination) > this.cellSize * this.cellSize;
      const radiusChanged = unit.pathRadius !== agentRadius;
      if (destinationChanged || radiusChanged || unit.pathRevision !== revision || unit.pathIndex >= unit.path.length) {
        unit.path = this.findPath(unit.position, destination, obstacles, agentRadius);
        unit.pathIndex = 0;
        unit.pathDestination = { x: destination.x, z: destination.z };
        unit.pathRevision = revision;
        unit.pathRadius = agentRadius;
      }

      while (unit.pathIndex < unit.path.length) {
        const waypoint = unit.path[unit.pathIndex];
        const dx = waypoint.x - unit.position.x;
        const dz = waypoint.z - unit.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 0.001) {
          const speed = Math.min(unit.moveSpeed, distance / Math.max(delta, 0.001));
          unit.heading = Math.atan2(dz, dx);
          unit.velocity.x = (dx / distance) * speed;
          unit.velocity.z = (dz / distance) * speed;
          return false;
        }
        unit.pathIndex++;
      }

      unit.velocity.x = 0;
      unit.velocity.z = 0;
      return unit.path.length > 0;
    }
  }

  global.NavigationSystem = NavigationSystem;
})(window);
