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

  global.CombatProcessor = {
    applyAccuracySpread,
    runStopAndShoot
  };
})(window);
