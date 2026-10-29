(function (global) {
  class PerformanceMonitor {
    constructor(sampleCapacity = 120, now = () => global.performance.now()) {
      this.sampleCapacity = Math.max(1, Math.floor(sampleCapacity));
      this.now = now;
      this.metrics = new Map();
    }

    measure(key, label, callback) {
      const startedAt = this.now();
      try {
        return callback();
      } finally {
        this.record(key, label, this.now() - startedAt);
      }
    }

    record(key, label, duration) {
      if (!Number.isFinite(duration) || duration < 0) return;
      let metric = this.metrics.get(key);
      if (!metric) {
        metric = {
          key,
          label,
          samples: new Float64Array(this.sampleCapacity),
          cursor: 0,
          sampleCount: 0,
          callCount: 0
        };
        this.metrics.set(key, metric);
      }

      metric.label = label;
      metric.samples[metric.cursor] = duration;
      metric.cursor = (metric.cursor + 1) % this.sampleCapacity;
      metric.sampleCount = Math.min(metric.sampleCount + 1, this.sampleCapacity);
      metric.callCount++;
    }

    getSnapshot() {
      return Array.from(this.metrics.values()).map(metric => {
        let total = 0;
        let maximum = 0;
        for (let index = 0; index < metric.sampleCount; index++) {
          const value = metric.samples[index];
          total += value;
          maximum = Math.max(maximum, value);
        }
        const latestIndex = (metric.cursor - 1 + this.sampleCapacity) % this.sampleCapacity;
        return {
          key: metric.key,
          label: metric.label,
          latest: metric.samples[latestIndex] || 0,
          average: metric.sampleCount ? total / metric.sampleCount : 0,
          maximum,
          callCount: metric.callCount,
          sampleCount: metric.sampleCount
        };
      });
    }

    clear(key = null) {
      if (key === null) this.metrics.clear();
      else this.metrics.delete(key);
    }
  }

  global.PerformanceMonitor = PerformanceMonitor;
})(window);
