(function (global) {
  class UiController {
    constructor(ui) {
      this.ui = ui;
    }

    renderRoster(world, selectedId) {
      this.ui.count.textContent = String(world.units.length).padStart(2, '0');
      this.ui.roster.replaceChildren();

      for (const unit of world.units) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `roster-item${unit.id === selectedId ? ' selected' : ''}`;
        button.setAttribute('aria-pressed', String(unit.id === selectedId));
        button.innerHTML = `<span class="unit-swatch" style="background:${unit.alive ? global.TEAM[unit.team].color : '#9aa39d'}"></span><span class="roster-copy"><span class="roster-name">${unit.label}</span><span class="roster-team">${unit.team.toUpperCase()}</span></span><span class="roster-health${unit.alive ? '' : ' dead'}">${unit.alive ? `${Math.ceil(unit.health)}%` : 'DOWN'}</span>`;
        button.addEventListener('click', () => {
          global.selectedId = unit.id;
          global.renderer.selectedId = global.selectedId;
          global.renderUI();
        });
        this.ui.roster.append(button);
      }
    }

    renderInspector(world, selectedId) {
      if (this.ui.inspector.contains(document.activeElement)) return;
      const unit = world.units.find(candidate => candidate.id === selectedId) || world.units[0];
      if (!unit) {
        this.ui.inspector.innerHTML = '<p class="empty-copy">No units in arena.</p>';
        return;
      }

      const team = global.TEAM[unit.team];
      const target = world.units.find(candidate => candidate.id === unit.targetId && candidate.alive);
      const perceived = unit.perceivedEnemies.map(id => world.units.find(candidate => candidate.id === id)).filter(Boolean);
      const combatOptions = Object.entries(global.COMBAT_BEHAVIORS).map(([key, behavior]) => `<option value="${key}"${unit.combatBehavior === key ? ' selected' : ''}>${behavior.label}</option>`).join('');
      const targetOptions = Object.entries(global.TARGET_BEHAVIORS).map(([key, behavior]) => `<option value="${key}"${unit.targetBehavior === key ? ' selected' : ''}>${behavior.label}</option>`).join('');
      const movementOptions = Object.entries(global.MOVEMENT_BEHAVIORS).map(([key, behavior]) => `<option value="${key}"${unit.movementBehavior === key ? ' selected' : ''}>${behavior.label}</option>`).join('');
      const guardStatus = unit.movementBehavior === 'guard'
        ? `<div class="target-row"><span>Guard point</span><span class="target-value">${unit.guardPointId !== null ? `#${unit.guardPointId} · ${unit.moveState === 'guarding' ? 'HOLDING' : 'EN ROUTE'}` : 'SEEKING'}</span></div>`
        : '';

      this.ui.inspector.innerHTML = `
        <div class="selected-unit-head"><span class="selected-unit-mark" style="background:${unit.alive ? team.color : '#8a9690'}">${unit.team[0]}</span><span><span class="selected-unit-name">${unit.label}</span><span class="selected-unit-team">${unit.team.toUpperCase()} · ${unit.alive ? 'ACTIVE' : 'DOWN'}</span></span></div>
        <div class="health-row"><span>Health</span><span class="health-value">${Math.ceil(unit.health)} <span style="color:#9aa69f">/ ${unit.maxHealth} HP</span></span></div>
        <div class="health-track"><div class="health-fill${unit.health < 36 ? ' low' : ''}" style="width:${unit.health}%"></div></div>
        <div class="stat-grid"><div><div class="stat-label">POSITION X</div><div class="stat-value">${unit.position.x.toFixed(1)} m</div></div><div><div class="stat-label">POSITION Z</div><div class="stat-value">${unit.position.z.toFixed(1)} m</div></div><div><div class="stat-label">HEIGHT Y</div><div class="stat-value">${unit.position.y.toFixed(1)} m</div></div><div><div class="stat-label">PERCEPTION</div><div class="stat-value">${unit.perceptionRange} m</div></div></div>
        <div class="target-row"><span>Current target</span><span class="target-value">${target ? target.label : 'NONE'}</span></div>
        <div class="perceived-block"><div class="subheading"><span>PERCEIVED ENEMIES</span><span>${perceived.length.toString().padStart(2, '0')}</span></div><div class="perceived-list">${perceived.length ? perceived.map(enemy => `<span class="perceived-chip" style="--chip-color:${global.TEAM[enemy.team].color}">${enemy.label}</span>`).join('') : '<span class="empty-copy">No contacts</span>'}</div></div>
        <div class="behavior-block"><div class="subheading"><span>COMBAT BEHAVIOUR</span><span class="section-index">03</span></div><label class="config-field">Combat style<select class="config-select" data-setting="combatBehavior">${combatOptions}</select></label><label class="config-field target-setting">Target selection<select class="config-select" data-setting="targetBehavior">${targetOptions}</select></label><label class="config-field target-setting">Movement style<select class="config-select" data-setting="movementBehavior">${movementOptions}</select></label>${guardStatus}
        <div class="subheading shooting-heading"><span>BURST CONFIG</span></div><div class="shooting-grid">
          <label class="config-field">Stop delay<span class="number-control"><input data-setting="stopDelay" type="number" min="0" max="5" step="0.1" value="${unit.shootingConfig.stopDelay.toFixed(1)}"><span>s</span></span></label>
          <label class="config-field">Time until shoot<span class="number-control"><input data-setting="timeUntilShoot" type="number" min="0" max="5" step="0.1" value="${unit.shootingConfig.timeUntilShoot.toFixed(1)}"><span>s</span></span></label>
          <label class="config-field bullet-count-field">Bullets per burst<span class="number-control"><input data-setting="bulletsPerBurst" type="number" min="1" max="20" step="1" value="${unit.shootingConfig.bulletsPerBurst}"><span>rnd</span></span></label>
        </div></div>`;

      const movementField = document.createElement('div');
      movementField.className = 'movement-config';
      movementField.innerHTML = `<div class="subheading movement-heading"><span>WAYPOINT CONFIG</span></div><label class="config-field">Wait at destination<span class="number-control"><input data-setting="moveWaitTime" type="number" min="0" max="20" step="0.5" value="${unit.movementConfig.waitTime.toFixed(1)}"><span>s</span></span></label>`;
      this.ui.inspector.append(movementField);

      this.ui.inspector.querySelector('[data-setting="combatBehavior"]').addEventListener('change', event => {
        unit.combatBehavior = event.target.value;
        world.resetCombatCycle(unit);
        global.renderUI();
      });
      this.ui.inspector.querySelector('[data-setting="targetBehavior"]').addEventListener('change', event => {
        unit.targetBehavior = event.target.value;
        unit.targetId = null;
        world.updatePerception();
        global.renderUI();
      });
      this.ui.inspector.querySelector('[data-setting="movementBehavior"]').addEventListener('change', event => {
        world.setMovementBehavior(unit, event.target.value);
        global.renderUI();
      });

      for (const [key, min, max, integer] of [
        ['stopDelay', 0, 5, false],
        ['timeUntilShoot', 0, 5, false],
        ['bulletsPerBurst', 1, 20, true]
      ]) {
        this.ui.inspector.querySelector(`[data-setting="${key}"]`).addEventListener('input', event => {
          const value = Number(event.target.value);
          if (!Number.isFinite(value)) return;
          unit.shootingConfig[key] = integer ? Math.round(global.clamp(value, min, max)) : global.clamp(value, min, max);
        });
      }

      this.ui.inspector.querySelector('[data-setting="moveWaitTime"]').addEventListener('input', event => {
        const value = Number(event.target.value);
        if (Number.isFinite(value)) unit.movementConfig.waitTime = global.clamp(value, 0, 20);
      });
    }

    renderEvents(events) {
      this.ui.eventCount.textContent = String(events.length).padStart(2, '0');
      this.ui.events.innerHTML = events.length ? events.map(event => `<div class="event-item"><span class="event-time">${global.formatTime(event.time).slice(3)}</span><span class="event-message">${event.message}</span></div>`).join('') : '<p class="empty-copy">Waiting for activity</p>';
    }

    renderUI(world, selectedId, events) {
      this.renderRoster(world, selectedId);
      this.renderInspector(world, selectedId);
      this.renderEvents(events);
      this.ui.clock.textContent = global.formatTime(world.elapsed);
      this.ui.status.textContent = world.units.some(unit => unit.alive && unit.perceivedEnemies.length) ? 'Contact confirmed · engagements active' : 'Agents are acquiring targets';
      this.ui.playLabel.textContent = world.paused ? 'Resume' : 'Pause';
      this.ui.playIcon.textContent = world.paused ? '▶' : 'Ⅱ';
    }
  }

  global.UiController = UiController;
})(window);
