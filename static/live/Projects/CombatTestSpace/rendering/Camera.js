(function (global) {



  class Camera {
    constructor(world) {
      this.world = world;
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
      this.zoom = this.getFitZoom();
    }

    rotate(direction) {
      this.yaw += direction * Math.PI / 4;
    }

    getBaseScale() {
      const standard = global.WORLD_SIZES.standard;
      const paddedWidth = standard.width * (137 / 120);
      const paddedDepth = standard.depth * (96 / 80);
      return Math.min(this.width / paddedWidth, this.height / paddedDepth);
    }

    getFitZoom() {
      const paddedWidth = this.world.width * (137 / 120);
      const paddedDepth = this.world.depth * (96 / 80);
      const fittedScale = Math.min(this.width / paddedWidth, this.height / paddedDepth);
      return fittedScale / this.getBaseScale();
    }

    getScale() {
      this.scale = this.getBaseScale() * this.zoom;
      return this.scale;
    }

    worldToScreen(position) {
      const scale = this.getScale();
      if (this.view === 'iso') {
        const dx = position.x - this.world.width / 2;
        const dz = position.z - this.world.depth / 2;
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
        x: this.width / 2 + (position.x - this.world.width / 2) * scale + this.offsetX,
        y: this.height / 2 + (position.z - this.world.depth / 2) * scale + this.offsetY
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
          x: horizontal * cos + depth * sin + this.world.width / 2,
          z: -horizontal * sin + depth * cos + this.world.depth / 2
        };
      }
      return {
        x: (point.x - this.width / 2 - this.offsetX) / scale + this.world.width / 2,
        z: (point.y - this.height / 2 - this.offsetY) / scale + this.world.depth / 2
      };
    }
  }

  global.Camera = Camera;
})(window);
