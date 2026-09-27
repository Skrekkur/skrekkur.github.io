(function (global) {
  const { TEAM, BEHAVIOR, STATE } = global.GAME_CONSTANTS;

  const runRoamStep = (world, unit, delta) => {
    if (!unit.moveDestination || unit.moveState === STATE.MOVEMENT.SELECTING) {
      world.selectRoamDestination(unit);
    }

    if (unit.moveState === STATE.MOVEMENT.WAITING) {
      unit.velocity.x = 0;
      unit.velocity.z = 0;
      unit.moveWaitRemaining -= delta;
      if (unit.moveWaitRemaining <= 0) {
        world.selectRoamDestination(unit);
      }
      return;
    }

    const arrived = world.moveTowards(unit, unit.moveDestination, delta);
    if (arrived) {
      unit.moveState = STATE.MOVEMENT.WAITING;
      unit.moveWaitRemaining = unit.movementConfig.waitTime;
    }
  };

  const runGuardStep = (world, unit, delta) => {
    const guardPoint = unit.guardPointId !== null ? world.guardPoints.find(point => point.id === unit.guardPointId) : null;

    if (unit.moveState === STATE.MOVEMENT.GUARDING) {
      if (!guardPoint) {
        unit.moveState = STATE.MOVEMENT.SELECTING;
      } else {
        const distance = Math.hypot(guardPoint.position.x - unit.position.x, guardPoint.position.z - unit.position.z);
        if (distance > 1.5) {
          unit.moveState = STATE.MOVEMENT.MOVING;
          unit.moveDestination = { x: guardPoint.position.x, z: guardPoint.position.z };
        } else {
          unit.velocity.x = 0;
          unit.velocity.z = 0;
          world.rotateTowardsHeading(unit, guardPoint.heading, delta);
          return;
        }
      }
    }

    if (unit.moveState === STATE.MOVEMENT.WAITING) {
      unit.velocity.x = 0;
      unit.velocity.z = 0;
      unit.moveWaitRemaining -= delta;
      if (unit.moveWaitRemaining <= 0) {
        if (!world.claimGuardPoint(unit)) {
          world.selectGuardWanderDestination(unit);
        }
      }
      return;
    }

    if (!unit.moveDestination || unit.moveState === STATE.MOVEMENT.SELECTING) {
      if (!world.claimGuardPoint(unit)) {
        world.selectGuardWanderDestination(unit);
      }
    }

    const arrived = world.moveTowards(unit, unit.moveDestination, delta);
    if (arrived) {
      unit.moveState = unit.guardPointId !== null ? STATE.MOVEMENT.GUARDING : STATE.MOVEMENT.WAITING;
      if (unit.moveState === STATE.MOVEMENT.WAITING) {
        unit.moveWaitRemaining = unit.movementConfig.waitTime;
      }
    }
  };

  const runScoutStep = (world, unit, delta) => {
    if (unit.perceivedEnemies.length > 0) {
      if (!unit.moveDestination || unit.moveState === STATE.MOVEMENT.SELECTING || unit.scoutEscapePoint === undefined || unit.scoutEscapePoint === null) {
        const headquarters = global.HEADQUARTERS[unit.team].position;
        const offset = unit.team === TEAM.EMBER ? 8 : -8;
        unit.scoutEscapePoint = {
          x: global.clamp(headquarters.x + offset, 4, 116),
          z: global.clamp(headquarters.z + (Math.random() - 0.5) * 10, 4, 76)
        };
        unit.moveState = STATE.MOVEMENT.MOVING;
      }

      unit.moveDestination = unit.scoutEscapePoint;
      const arrived = world.moveTowards(unit, unit.moveDestination, delta);
      if (arrived) {
        unit.moveState = STATE.MOVEMENT.WAITING;
        unit.moveWaitRemaining = 2.5;
        unit.velocity.x = 0;
        unit.velocity.z = 0;
      }
      return;
    }

    if (!unit.moveDestination || unit.moveState === STATE.MOVEMENT.SELECTING) {
      world.selectRoamDestination(unit);
    }

    if (unit.moveState === STATE.MOVEMENT.WAITING) {
      unit.velocity.x = 0;
      unit.velocity.z = 0;
      unit.moveWaitRemaining -= delta;
      if (unit.moveWaitRemaining <= 0) {
        world.selectRoamDestination(unit);
      }
      return;
    }

    const arrived = world.moveTowards(unit, unit.moveDestination, delta);
    if (arrived) {
      unit.moveState = STATE.MOVEMENT.WAITING;
      unit.moveWaitRemaining = unit.movementConfig.waitTime;
    }
  };

  global.MovementProcessor = {
    runRoamStep,
    runGuardStep,
    runScoutStep
  };
})(window);
