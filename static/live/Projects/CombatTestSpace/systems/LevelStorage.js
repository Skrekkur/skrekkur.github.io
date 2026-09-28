(function (global) {
  const LIBRARY_VERSION = 1;
  const SAVE_VERSION = 1;
  const DEFAULT_STORAGE_KEY = 'fieldwork.combat.levels';

  class LevelStorage {
    constructor(storage = global.localStorage, storageKey = DEFAULT_STORAGE_KEY) {
      this.storage = storage;
      this.storageKey = storageKey;
    }

    createEmptyLibrary() {
      return { version: LIBRARY_VERSION, defaultLevelId: null, levels: [] };
    }

    createId() {
      if (global.crypto?.randomUUID) return global.crypto.randomUUID();
      return `level-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    }

    clone(value) {
      return JSON.parse(JSON.stringify(value));
    }

    finite(value, fallback = 0) {
      const number = Number(value);
      return Number.isFinite(number) ? number : fallback;
    }

    migrateSave(save) {
      const source = save && typeof save === 'object' ? save : {};
      const version = Number.isInteger(source.version) ? source.version : 0;
      if (version > SAVE_VERSION) throw new Error(`Level save version ${version} is newer than supported version ${SAVE_VERSION}`);
      if (version === 0) {
        return {
          version: 1,
          obstacles: source.obstacles ?? [],
          guardPoints: source.guardPoints ?? source.guardpoints ?? []
        };
      }
      return source;
    }

    normalizeSave(save) {
      const migrated = this.migrateSave(save);
      return {
        version: SAVE_VERSION,
        obstacles: Array.isArray(migrated.obstacles) ? migrated.obstacles.map((obstacle, index) => ({
          id: Math.max(1, Math.round(this.finite(obstacle.id, index + 1))),
          position: { x: this.finite(obstacle.position?.x), z: this.finite(obstacle.position?.z) },
          width: Math.max(0.1, this.finite(obstacle.width, 12)),
          depth: Math.max(0.1, this.finite(obstacle.depth, 12))
        })) : [],
        guardPoints: Array.isArray(migrated.guardPoints) ? migrated.guardPoints.map((point, index) => ({
          id: Math.max(1, Math.round(this.finite(point.id, index + 1))),
          team: String(point.team ?? ''),
          position: { x: this.finite(point.position?.x), z: this.finite(point.position?.z) },
          heading: this.finite(point.heading)
        })) : []
      };
    }

    migrateLibrary(library) {
      if (Array.isArray(library)) library = { version: 0, levels: library };
      if (!library || typeof library !== 'object') return this.createEmptyLibrary();
      let migrated = library;
      let version = Number.isInteger(migrated.version) ? migrated.version : 0;
      if (version > LIBRARY_VERSION) throw new Error(`Level library version ${version} is newer than supported version ${LIBRARY_VERSION}`);

      if (version === 0) {
        const levels = Array.isArray(migrated.levels) ? migrated.levels : [];
        migrated = {
          version: 1,
          defaultLevelId: migrated.defaultLevelId ?? null,
          levels: levels.map((entry, index) => ({
            id: String(entry.id ?? `legacy-${index + 1}`),
            name: String(entry.name ?? `Level ${index + 1}`),
            createdAt: entry.createdAt ?? new Date(0).toISOString(),
            updatedAt: entry.updatedAt ?? entry.createdAt ?? new Date(0).toISOString(),
            save: this.normalizeSave(entry.save ?? entry.level ?? entry)
          }))
        };
        version = 1;
      }

      const levels = Array.isArray(migrated.levels) ? migrated.levels.map((entry, index) => ({
        id: String(entry.id ?? `level-${index + 1}`),
        name: String(entry.name ?? `Level ${index + 1}`).slice(0, 40),
        createdAt: String(entry.createdAt ?? new Date(0).toISOString()),
        updatedAt: String(entry.updatedAt ?? entry.createdAt ?? new Date(0).toISOString()),
        save: this.normalizeSave(entry.save)
      })) : [];
      const requestedDefaultId = migrated.defaultLevelId === null || migrated.defaultLevelId === undefined ? null : String(migrated.defaultLevelId);
      const defaultLevelId = levels.some(level => level.id === requestedDefaultId) ? requestedDefaultId : null;
      return { version: LIBRARY_VERSION, defaultLevelId, levels };
    }

    readLibrary() {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return this.createEmptyLibrary();
      const parsed = JSON.parse(raw);
      const migrated = this.migrateLibrary(parsed);
      const serialized = JSON.stringify(migrated);
      if (serialized !== raw) this.storage.setItem(this.storageKey, serialized);
      return migrated;
    }

    writeLibrary(library) {
      const normalized = this.migrateLibrary(library);
      this.storage.setItem(this.storageKey, JSON.stringify(normalized));
      return normalized;
    }

    listLevels() {
      const library = this.readLibrary();
      return library.levels.map(level => ({
        id: level.id,
        name: level.name,
        createdAt: level.createdAt,
        updatedAt: level.updatedAt,
        isDefault: level.id === library.defaultLevelId
      }));
    }

    getLevel(id) {
      const library = this.readLibrary();
      const level = library.levels.find(candidate => candidate.id === id);
      return level ? this.clone(level) : null;
    }

    getDefaultLevel() {
      const library = this.readLibrary();
      const level = library.levels.find(candidate => candidate.id === library.defaultLevelId);
      return level ? this.clone(level) : null;
    }

    saveLevel(name, levelData, id = null) {
      const library = this.readLibrary();
      const cleanName = String(name ?? '').trim().slice(0, 40);
      if (!cleanName) throw new Error('Enter a level name before saving');
      const now = new Date().toISOString();
      const existing = id ? library.levels.find(level => level.id === id) : null;
      const record = {
        id: existing?.id ?? this.createId(),
        name: cleanName,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        save: this.normalizeSave(levelData)
      };
      if (existing) library.levels[library.levels.indexOf(existing)] = record;
      else library.levels.push(record);
      this.writeLibrary(library);
      return this.clone(record);
    }

    deleteLevel(id) {
      const library = this.readLibrary();
      const nextLevels = library.levels.filter(level => level.id !== id);
      if (nextLevels.length === library.levels.length) return false;
      library.levels = nextLevels;
      if (library.defaultLevelId === id) library.defaultLevelId = null;
      this.writeLibrary(library);
      return true;
    }

    setDefaultLevel(id) {
      const library = this.readLibrary();
      if (id !== null && !library.levels.some(level => level.id === id)) throw new Error('Select a saved level first');
      library.defaultLevelId = id;
      this.writeLibrary(library);
      return id;
    }
  }

  LevelStorage.LIBRARY_VERSION = LIBRARY_VERSION;
  LevelStorage.SAVE_VERSION = SAVE_VERSION;
  LevelStorage.DEFAULT_STORAGE_KEY = DEFAULT_STORAGE_KEY;
  global.LevelStorage = LevelStorage;
})(window);
