(function (global) {
  global.GAME_CONSTANTS = Object.freeze({
    TEAM: Object.freeze({ EMBER: 'Ember', TIDE: 'Tide' }),
    BEHAVIOR: Object.freeze({
      MOVEMENT: Object.freeze({ ROAM: 'roam', GUARD: 'guard', SCOUT: 'scout' }),
      TARGET: Object.freeze({ CLOSEST: 'closest', RANDOM: 'random' }),
      COMBAT: Object.freeze({ STOP_AND_SHOOT: 'stopAndShoot', CLOSE_AND_SHOOT: 'closeAndShoot' })
    }),
    STATE: Object.freeze({
      MOVEMENT: Object.freeze({ SELECTING: 'selecting', MOVING: 'moving', WAITING: 'waiting', GUARDING: 'guarding' }),
      COMBAT: Object.freeze({ APPROACH: 'approach', STOP_DELAY: 'stopDelay', WINDUP: 'windup', FIRING: 'firing', RECOVERY: 'recovery' })
    }),
    TRACE: Object.freeze({ MANUAL: 'manual', COMBAT: 'combat' }),
    EVENT: Object.freeze({ COMBAT: 'combat', TRACE: 'trace' }),
    TOOL: Object.freeze({ TRACE: 'trace', GUARD: 'guard', OBSTACLE: 'obstacle' }),
    FOG: Object.freeze({ OFF: null })
  });

  const { TEAM: TEAMS, BEHAVIOR } = global.GAME_CONSTANTS;

  global.TEAM = {
    [TEAMS.EMBER]: { id: 1, color: '#ec785e', pale: 'rgba(236,120,94,0.14)' },
    [TEAMS.TIDE]: { id: 2, color: '#439eb1', pale: 'rgba(67,158,177,0.14)' }
  };

  global.TEAM_BY_ID = Object.fromEntries(Object.entries(global.TEAM).map(([name, def]) => [def.id, name]));

  global.HEADQUARTERS = {
    Ember: { label: 'Team 1 HQ', position: { x: 10, z: 40 }, team: 'Ember', alwaysVisible: true, radius: 18 },
    Tide: { label: 'Team 2 HQ', position: { x: 110, z: 40 }, team: 'Tide', alwaysVisible: true, radius: 18 }
  };

  global.TARGET_BEHAVIORS = {
    [BEHAVIOR.TARGET.CLOSEST]: {
      label: 'Closest in range',
      select: (unit, enemies) => enemies.slice().sort((a, b) => global.distanceSquared(unit.position, a.position) - global.distanceSquared(unit.position, b.position))[0] ?? null
    },
    [BEHAVIOR.TARGET.RANDOM]: {
      label: 'Random in range',
      select: (_unit, enemies) => enemies[Math.floor(Math.random() * enemies.length)] ?? null
    }
  };

  global.COMBAT_BEHAVIORS = {
    [BEHAVIOR.COMBAT.STOP_AND_SHOOT]: { label: 'Stop & shoot', engagementRange: unit => unit.attackRange },
    [BEHAVIOR.COMBAT.CLOSE_AND_SHOOT]: { label: 'Close & shoot', engagementRange: unit => unit.attackRange * 0.45 }
  };

  global.MOVEMENT_BEHAVIORS = {
    [BEHAVIOR.MOVEMENT.ROAM]: { label: 'Roam', letter: 'R', update: (world, unit, delta) => global.MovementProcessor.runRoamStep(world, unit, delta) },
    [BEHAVIOR.MOVEMENT.GUARD]: { label: 'Guard', letter: 'G', update: (world, unit, delta) => global.MovementProcessor.runGuardStep(world, unit, delta) },
    [BEHAVIOR.MOVEMENT.SCOUT]: { label: 'Scout', letter: 'S', update: (world, unit, delta) => global.MovementProcessor.runScoutStep(world, unit, delta) }
  };

  global.GLOBAL_ACCURACY = { maxDeviationDegrees: 8 };

  global.clamp = function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  };

  global.distanceSquared = function distanceSquared(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
  };

  global.formatTime = function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainder = (seconds % 60).toFixed(1).padStart(4, '0');
    return `T+ ${String(minutes).padStart(2, '0')}:${remainder}`;
  };
})(window);
