(function (global) {
  const { STATE, EVENT } = global.GAME_CONSTANTS;

  function applyAccuracySpread(dirX, dirZ) {
    const maxDeviationRadians = global.GLOBAL_ACCURACY.maxDeviationDegrees * Math.PI / 180;
    const deviation = (Math.random() * 2 - 1) * maxDeviationRadians;
    const cos = Math.cos(deviation);
    const sin = Math.sin(deviation);
    return { x: dirX * cos - dirZ * sin, z: dirX * sin + dirZ * cos };
  }

  function runStopAndShoot(world, unit, target, delta, engagementRange) {
    const dx = target.position.x - unit.position.x;
    const dz = target.position.z - unit.position.z;
    const distance = Math.hypot(dx, dz);
    unit.heading = Math.atan2(dz, dx);

    if (distance > engagementRange) {
      unit.combatState = STATE.COMBAT.APPROACH;
      unit.stateTimer = 0;
      unit.shotsRemaining = 0;
      world.moveTowards(unit, target.position, delta);
      return;
    }

    unit.velocity.x = 0;
    unit.velocity.z = 0;
    world.clearPath(unit);

    if (unit.combatState === STATE.COMBAT.APPROACH) {
      unit.combatState = STATE.COMBAT.STOP_DELAY;
      unit.stateTimer = unit.shootingConfig.stopDelay;
      if (unit.stateTimer === 0) {
        unit.combatState = STATE.COMBAT.WINDUP;
        unit.stateTimer = unit.shootingConfig.timeUntilShoot;
      }
      return;
    }

    if (unit.combatState === STATE.COMBAT.STOP_DELAY || unit.combatState === STATE.COMBAT.WINDUP || unit.combatState === STATE.COMBAT.RECOVERY) {
      unit.stateTimer -= delta;
      if (unit.stateTimer > 0) return;
      if (unit.combatState === STATE.COMBAT.STOP_DELAY) {
        unit.combatState = STATE.COMBAT.WINDUP;
        unit.stateTimer = unit.shootingConfig.timeUntilShoot;
        return;
      }
      if (unit.combatState === STATE.COMBAT.WINDUP) {
        unit.combatState = STATE.COMBAT.FIRING;
        unit.shotsRemaining = unit.shootingConfig.bulletsPerBurst;
        unit.shotTimer = 0;
        unit.hitsThisBurst = 0;
        world.onEvent(`<strong>${unit.label}</strong> firing ${unit.shotsRemaining}-round burst at ${target.label}`, EVENT.COMBAT);
      } else {
        unit.combatState = STATE.COMBAT.STOP_DELAY;
        unit.stateTimer = unit.shootingConfig.stopDelay;
        return;
      }
    }

    if (unit.combatState !== STATE.COMBAT.FIRING) return;
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
      if (unit.hitsThisBurst > 0) world.onEvent(`${unit.label} landed ${unit.hitsThisBurst} hit${unit.hitsThisBurst === 1 ? '' : 's'} on ${target.label}`, EVENT.COMBAT);
      unit.combatState = STATE.COMBAT.RECOVERY;
      unit.stateTimer = 0.75;
    }
  }

  function runMachineGun(world, unit, point, delta) {
    const config = global.MACHINE_GUN_CONFIG;
    const state = unit.machineGunState ??= { firing: false, shotsFired: 0, timer: 0 };
    unit.velocity.x = 0;
    unit.velocity.z = 0;
    unit.moveState = STATE.MOVEMENT.GUARDING;
    world.clearPath(unit);

    const enemies = world.units.filter(other => other.alive && other.team !== unit.team &&
      unit.perceivedEnemies.includes(other.id) &&
      Math.hypot(other.position.x - unit.position.x, other.position.z - unit.position.z) <= unit.attackRange &&
      world.isClearTrace(unit, other));
    const target = enemies.find(other => other.id === unit.targetId) ?? enemies[0];
    const desiredHeading = target
      ? Math.atan2(target.position.z - unit.position.z, target.position.x - unit.position.x)
      : state.firing && state.shotsFired < 3 ? unit.heading : point.heading;
    const difference = Math.atan2(Math.sin(desiredHeading - unit.heading), Math.cos(desiredHeading - unit.heading));
    const maxTurn = Math.max(0, config.turnRateDegrees) * Math.PI / 180 * delta;
    unit.heading += global.clamp(difference, -maxTurn, maxTurn);
    const aimError = Math.atan2(Math.sin(desiredHeading - unit.heading), Math.cos(desiredHeading - unit.heading));
    const canFire = target && Math.abs(aimError) <= config.coneOfFireDegrees * Math.PI / 360;

    if (!state.firing && canFire) {
      state.firing = true;
      state.shotsFired = 0;
      state.timer = 0;
    }
    if (!state.firing) {
      unit.combatState = STATE.COMBAT.APPROACH;
      return;
    }
    state.timer -= delta;
    while (state.timer <= 0) {
      // Finish the minimum burst even if the target dies or leaves the cone.
      const targetAvailable = canFire && target.alive;
      if (!targetAvailable && state.shotsFired >= 3) {
        state.firing = false;
        break;
      }
      world.fireBullet(unit, target ?? { position: {
        x: unit.position.x + Math.cos(unit.heading),
        z: unit.position.z + Math.sin(unit.heading)
      } }, config);
      state.shotsFired++;
      state.timer += 1 / Math.max(0.01, config.rateOfFire);
    }
    unit.combatState = state.firing ? STATE.COMBAT.FIRING : STATE.COMBAT.APPROACH;
  }

  for (const [key, behavior] of Object.entries(global.COMBAT_BEHAVIORS)) {
    behavior.update = (world, unit, target, delta) => runStopAndShoot(world, unit, target, delta, behavior.engagementRange(unit));
    behavior.key = key;
  }

  global.CombatProcessor = {
    applyAccuracySpread,
    runStopAndShoot,
    runMachineGun
  };
})(window);
