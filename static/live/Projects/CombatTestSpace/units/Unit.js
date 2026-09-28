(function (global) {
  const { BEHAVIOR, STATE } = global.GAME_CONSTANTS;

  class Unit extends global.GameObject {
    constructor(id, team, position, label) {
      super({ id, team, position, label });
      this.teamId = global.TEAM[team].id;
      this.position = { x: position.x, y: 0, z: position.z };
      this.velocity = { x: 0, z: 0 };
      this.health = 100;
      this.maxHealth = 100;
      this.perceptionRange = 35;
      this.moveSpeed = 4.2;
      this.radius = 1.7;
      this.navigationRadius = this.radius + 0.3;
      this.attackRange = this.perceptionRange * 2;
      this.perceivedEnemies = [];
      this.targetId = null;
      this.targetBehavior = BEHAVIOR.TARGET.CLOSEST;
      this.combatBehavior = BEHAVIOR.COMBAT.STOP_AND_SHOOT;
      this.shootingConfig = { stopDelay: 0.3, timeUntilShoot: 0.45, bulletsPerBurst: 3 };
      this.combatState = STATE.COMBAT.APPROACH;
      this.stateTimer = 0;
      this.shotsRemaining = 0;
      this.shotTimer = 0;
      this.hitsThisBurst = 0;
      this.heading = Math.random() * Math.PI * 2;
      this.movementBehavior = BEHAVIOR.MOVEMENT.ROAM;
      this.guardPointId = null;
      this.scoutEscapePoint = null;
      this.moveDestination = null;
      this.path = [];
      this.pathIndex = 0;
      this.pathDestination = null;
      this.pathRevision = -1;
      this.pathRadius = null;
      this.moveState = STATE.MOVEMENT.SELECTING;
      this.moveWaitRemaining = 0;
      this.movementConfig = { waitTime: 2 };
    }
  }

  global.Unit = Unit;
})(window);
