(function (global) {
  // Portable graph strategy. The navigation adapter only needs:
  //   isPointNavigable(point, obstacles, radius)
  //   findPath(start, destination, obstacles, radius, maxExploredNodes)
  //
  // Guards form the reusable backbone. Other target kinds are leaves, so units
  // can benefit from guard chains without changing which objects form the graph.
  // Every failed nearby connection falls back to the team's HQ. A finite path
  // budget makes an exhausted query conservatively report unreachable.
  const DEFAULT_OPTIONS = Object.freeze({
    maxNeighborDistance: 80,
    maxNeighborChecks: 3,
    maxExploredNodes: 2000
  });

  class ReachabilityGraph {
    constructor(options = {}) {
      this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    calculate({
      targets,
      guardPoints,
      headquarters,
      obstacles,
      navigation,
      defaultRadius = 0
    }) {
      const targetNodes = targets.map(target => this.createNode(target.kind, target.object, defaultRadius));
      const guardNodes = guardPoints.map(point => this.createNode('guard', point, defaultRadius));
      const reachableByObject = new Map(targetNodes.map(node => [node.key, new Set()]));
      const targetKeys = new Set(reachableByObject.keys());
      const connections = [];
      const stats = { neighborChecks: 0, headquartersChecks: 0 };

      for (const [team, headquartersData] of Object.entries(headquarters)) {
        const headquartersNode = {
          key: `hq:${team}`,
          kind: 'hq',
          id: team,
          position: headquartersData.position,
          radius: defaultRadius
        };
        const reachableGuards = [];
        // Processing near-to-far makes already-proven guards available as
        // parents for guards farther away from this HQ.
        const orderedGuards = guardNodes
          .slice()
          .sort((left, right) =>
            this.distanceSquared(left.position, headquartersNode.position) -
            this.distanceSquared(right.position, headquartersNode.position)
          );

        for (const guard of orderedGuards) {
          const connection = this.connectNode({
            node: guard,
            reachableGuards,
            headquartersNode,
            obstacles,
            navigation,
            stats
          });
          if (!connection) continue;
          reachableGuards.push(guard);
          connections.push({ team, ...connection });
          if (targetKeys.has(guard.key)) reachableByObject.get(guard.key).add(team);
        }

        for (const target of targetNodes) {
          if (target.kind === 'guard') continue;
          const connection = this.connectNode({
            node: target,
            reachableGuards,
            headquartersNode,
            obstacles,
            navigation,
            stats
          });
          if (!connection) continue;
          connections.push({ team, ...connection });
          reachableByObject.get(target.key).add(team);
        }
      }

      return { reachableByObject, connections, stats };
    }

    connectNode({
      node,
      reachableGuards,
      headquartersNode,
      obstacles,
      navigation,
      stats
    }) {
      if (!navigation.isPointNavigable(node.position, obstacles, node.radius)) return null;

      // Limit expensive neighbor attempts. If none succeed, the HQ remains the
      // correctness-preserving fallback.
      const maxDistanceSquared = this.options.maxNeighborDistance ** 2;
      const nearbyGuards = reachableGuards
        .filter(guard => this.distanceSquared(guard.position, node.position) <= maxDistanceSquared)
        .sort((left, right) =>
          this.distanceSquared(left.position, node.position) -
          this.distanceSquared(right.position, node.position)
        )
        .slice(0, this.options.maxNeighborChecks);

      for (const guard of nearbyGuards) {
        stats.neighborChecks++;
        if (!this.canPath(guard.position, node.position, obstacles, navigation, node.radius)) continue;
        return this.createConnection(guard, node, 'nearby');
      }

      stats.headquartersChecks++;
      if (!this.canPath(headquartersNode.position, node.position, obstacles, navigation, node.radius)) return null;
      return this.createConnection(headquartersNode, node, 'headquarters');
    }

    canPath(start, destination, obstacles, navigation, radius) {
      const path = navigation.findPath(start, destination, obstacles, radius, this.options.maxExploredNodes);
      const finalPoint = path[path.length - 1];
      return Boolean(finalPoint) && this.distanceSquared(finalPoint, destination) < 0.0001;
    }

    createNode(kind, object, defaultRadius) {
      const radius = kind === 'unit'
        ? Math.max(0, object.navigationRadius ?? object.radius ?? defaultRadius)
        : defaultRadius;
      return {
        key: `${kind}:${object.id}`,
        kind,
        id: object.id,
        position: object.position,
        radius
      };
    }

    createConnection(from, to, source) {
      return {
        source,
        from: this.snapshotNode(from),
        to: this.snapshotNode(to)
      };
    }

    snapshotNode(node) {
      return {
        kind: node.kind,
        id: node.id,
        position: { x: node.position.x, y: node.position.y ?? 0, z: node.position.z }
      };
    }

    distanceSquared(left, right) {
      const dx = left.x - right.x;
      const dz = left.z - right.z;
      return dx * dx + dz * dz;
    }
  }

  global.ReachabilityGraph = ReachabilityGraph;
})(typeof window === 'undefined' ? globalThis : window);
