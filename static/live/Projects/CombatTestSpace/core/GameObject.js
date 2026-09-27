(function (global) {
  class GameObject {
    constructor({ id = null, team = null, position = { x: 0, y: 0, z: 0 }, label = 'Object', alwaysVisible = false } = {}) {
      this.id = id;
      this.team = team;
      this.label = label;
      this.position = { x: position.x ?? 0, y: position.y ?? 0, z: position.z ?? 0 };
      this.velocity = { x: 0, z: 0 };
      this.heading = 0;
      this.alive = true;
      this.alwaysVisible = alwaysVisible;
    }

    setAlwaysVisible(value = true) {
      this.alwaysVisible = Boolean(value);
      return this.alwaysVisible;
    }

    distanceTo(other) {
      return global.distanceSquared(this.position, other.position);
    }
  }

  global.GameObject = GameObject;
})(window);
