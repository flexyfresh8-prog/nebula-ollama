/* ============================================================
   StarBorder — vanilla JS port of the React <StarBorder/>.
   Draws a comet + glowing trail running around the rounded
   outline of any element (composer card, buttons).
   Hover = extra "lap", click = pulse rings, sparkle dust.
   setEffort(0..1) thickens the particles live.
   ============================================================ */
(() => {
  const TAU = Math.PI * 2;
  const LAP = 0.9;
  const WHITE = [255, 255, 255];

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const wrap = (v, total) => ((v % total) + total) % total;
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (2 - 2 * t) ** 3 / 2);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgba = (rgb, alpha) =>
    `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${clamp(alpha, 0, 1).toFixed(3)})`;

  let colorContext = null;
  const toRgb = color => {
    colorContext = colorContext ?? document.createElement('canvas').getContext('2d');
    if (!colorContext) return WHITE;
    colorContext.fillStyle = '#000000';
    colorContext.fillStyle = color;
    const value = String(colorContext.fillStyle);
    if (value.startsWith('#')) {
      const hex = parseInt(value.slice(1, 7), 16);
      return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
    }
    const parts = String(value).match(/[\d.]+/g)?.map(Number) ?? WHITE;
    return [parts[0], parts[1], parts[2]];
  };

  const outline = (width, height, radius) => {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    const arc = (Math.PI * r) / 2;
    const across = Math.max(0, width - 2 * r);
    const down = Math.max(0, height - 2 * r);
    const segments = [
      { length: across, x: r, y: 0, dx: 1, dy: 0, angle: null },
      { length: arc, x: width - r, y: r, dx: 0, dy: 0, angle: -Math.PI / 2 },
      { length: down, x: width, y: r, dx: 0, dy: 1, angle: null },
      { length: arc, x: width - r, y: height - r, dx: 0, dy: 0, angle: 0 },
      { length: across, x: width - r, y: height, dx: -1, dy: 0, angle: null },
      { length: arc, x: r, y: height - r, dx: 0, dy: 0, angle: Math.PI / 2 },
      { length: down, x: 0, y: height - r, dx: 0, dy: -1, angle: null },
      { length: arc, x: r, y: r, dx: 0, dy: 0, angle: Math.PI }
    ];
    return {
      r,
      segments,
      total: Math.max(1, segments.reduce((sum, s) => sum + s.length, 0))
    };
  };

  const pointAt = (shape, distance, point) => {
    let s = wrap(distance, shape.total);
    for (const segment of shape.segments) {
      if (segment.length > 0 && s <= segment.length) {
        if (segment.angle === null) {
          point.x = segment.x + segment.dx * s;
          point.y = segment.y + segment.dy * s;
          point.nx = segment.dy;
          point.ny = -segment.dx;
        } else {
          const angle = segment.angle + s / shape.r;
          point.nx = Math.cos(angle);
          point.ny = Math.sin(angle);
          point.x = segment.x + point.nx * shape.r;
          point.y = segment.y + point.ny * shape.r;
        }
        return point;
      }
      s -= segment.length;
    }
    return point;
  };

  const project = (shape, px, py) => {
    let best = Infinity;
    let found = 0;
    let offset = 0;
    shape.segments.forEach(segment => {
      if (segment.length > 0) {
        let s = 0;
        let x = 0;
        let y = 0;
        if (segment.angle === null) {
          s = clamp((px - segment.x) * segment.dx + (py - segment.y) * segment.dy, 0, segment.length);
          x = segment.x + segment.dx * s;
          y = segment.y + segment.dy * s;
        } else {
          let angle = wrap(Math.atan2(py - segment.y, px - segment.x) - segment.angle, TAU);
          if (angle > Math.PI / 2) angle = angle > Math.PI * 1.25 ? 0 : Math.PI / 2;
          s = angle * shape.r;
          x = segment.x + Math.cos(segment.angle + angle) * shape.r;
          y = segment.y + Math.sin(segment.angle + angle) * shape.r;
        }
        const distance = (px - x) ** 2 + (py - y) ** 2;
        if (distance < best) {
          best = distance;
          found = offset + s;
        }
      }
      offset += segment.length;
    });
    return found;
  };

  /* Shared ticker — one rAF for every star instance */
  const Engine = {
    list: [],
    raf: 0,
    last: 0,
    add(inst) {
      if (!Engine.list.includes(inst)) Engine.list.push(inst);
      if (!Engine.raf) {
        Engine.last = performance.now();
        Engine.raf = requestAnimationFrame(Engine.loop);
      }
    },
    remove(inst) {
      Engine.list = Engine.list.filter(i => i !== inst);
      if (!Engine.list.length && Engine.raf) {
        cancelAnimationFrame(Engine.raf);
        Engine.raf = 0;
      }
    },
    loop(now) {
      const dt = clamp((now - Engine.last) / 1000, 0.001, 0.05);
      Engine.last = now;
      for (const inst of Engine.list) inst.frame(now, dt);
      Engine.raf = Engine.list.length ? requestAnimationFrame(Engine.loop) : 0;
    }
  };

  class StarBorder {
    constructor(root, opts = {}) {
      this.root = root;
      const cs = getComputedStyle(root);
      const cssRadius = parseFloat(cs.borderTopLeftRadius) || 12;
      this.s = {
        color: opts.color ?? '#ffffff',
        trailColor: opts.trailColor ?? opts.color ?? '#ffffff',
        duration: Math.max(0.3, opts.duration ?? 5),
        thickness: Math.max(0.5, opts.thickness ?? 1.5),
        radius: Math.max(0, opts.radius ?? cssRadius),
        trailLength: clamp(opts.trailLength ?? 0.3, 0, 1),
        stars: clamp(Math.round(opts.stars ?? 1), 1, 6),
        glow: clamp(opts.glow ?? 0.65, 0, 1.5),
        sparkle: opts.sparkle ?? true,
        direction: opts.direction === 'counterclockwise' ? -1 : 1,
        bleed: Math.max(18, opts.bleed ?? 46),
        idle: opts.idle ?? false
      };
      if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
      root.classList.add('sb-root');

      this.canvas = document.createElement('canvas');
      this.canvas.className = 'sb-canvas';
      this.canvas.setAttribute('aria-hidden', 'true');
      root.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');

      this.state = {
        width: 0, height: 0, dpr: 1,
        phase: Math.random() * 500, velocity: 0, motion: 0, lap: -1,
        time: Math.random() * 10, reveal: 0, boost: 0, flash: 0, emit: 0,
        hovered: false
      };
      this.pulses = [];
      this.dust = [];
      this.colors = { key: '', head: WHITE, tail: WHITE };
      this.point = { x: 0, y: 0, nx: 0, ny: -1 };
      this._shape = null;

      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      this.reduce = reduce;

      root.addEventListener('pointerenter', event => this.onEnter(event));
      root.addEventListener('pointerleave', () => { this.state.hovered = false; });
      root.addEventListener('pointerdown', event => this.onDown(event));

      this.ro = new ResizeObserver(() => this.measure());
      this.ro.observe(root);
      this.measure();
      Engine.add(this);
    }

    setColor(color) {
      this.s.color = color;
      this.s.trailColor = color;
    }

    /* Live effort response: thicker particles, longer trail,
       more stars, bigger glow, faster laps as effort rises. */
    setEffort(e) {
      e = clamp(e ?? 0.5, 0, 1);
      const s = this.s;
      s.thickness = 1.5 + 4.6 * e;
      s.glow = 0.45 + 0.75 * e;
      s.trailLength = 0.22 + 0.42 * e;
      s.stars = clamp(1 + (e > 0.55 ? 1 : 0) + (e > 0.85 ? 1 : 0), 1, 3);
      s.duration = 5.2 - 3.1 * e;
      this._shape = null; /* outline depends on thickness */
    }

    flash() {
      this.state.flash = 1;
      this.pulse(this.state.phase);
    }

    pulse(origin) {
      this.pulses.push({ origin, age: 0 });
      if (this.pulses.length > 4) this.pulses.shift();
      this.state.flash = 1;
    }

    onEnter(event) {
      if (this.state.hovered) return;
      const [x, y] = this.local(event);
      this.state.hovered = true;
      if (this.state.reveal < 0.15) {
        this.state.phase = project(this.shape(), x - this.s.thickness / 2, y - this.s.thickness / 2);
        this.state.velocity = 0;
      }
      if (this.state.lap < 0 && !this.reduce) this.state.lap = 0;
    }

    onDown(event) {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const [x, y] = this.local(event);
      this.pulse(project(this.shape(), x - this.s.thickness / 2, y - this.s.thickness / 2));
    }

    local(event) {
      const rect = this.root.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    }

    measure() {
      const s = this.s;
      this.state.width = this.root.offsetWidth;
      this.state.height = this.root.offsetHeight;
      if (!this.state.width || !this.state.height) return;
      this.state.dpr = Math.min(window.devicePixelRatio || 1, 2);
      const bleed = s.bleed;
      const w = this.state.width + bleed * 2;
      const h = this.state.height + bleed * 2;
      this.canvas.style.left = -bleed + 'px';
      this.canvas.style.top = -bleed + 'px';
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.canvas.width = Math.max(1, Math.round(w * this.state.dpr));
      this.canvas.height = Math.max(1, Math.round(h * this.state.dpr));
      this._shape = null;
    }

    shape() {
      if (!this._shape) {
        const s = this.s;
        this._shape = outline(
          Math.max(1, this.state.width - s.thickness),
          Math.max(1, this.state.height - s.thickness),
          Math.max(0, s.radius - s.thickness / 2)
        );
      }
      return this._shape;
    }

    stroke(x1, y1, x2, y2, width, style) {
      const ctx = this.ctx;
      ctx.lineWidth = width;
      ctx.strokeStyle = style;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    drawTrail(s, shape, head, length, sign, intensity, tip = true) {
      if (length < 0.5 || intensity <= 0) return;
      const ctx = this.ctx;
      const steps = clamp(Math.ceil(length / 2), 2, 90);
      pointAt(shape, head, this.point);
      let px = this.point.x;
      let py = this.point.y;
      for (let i = 1; i <= steps; i++) {
        pointAt(shape, head - sign * length * (i / steps), this.point);
        const u = 1 - (i - 0.5) / steps;
        const fade = u * u * intensity;
        let tone = mix(this.colors.tail, this.colors.head, u);
        tone = mix(tone, WHITE, u ** 6 * 0.65);
        ctx.lineCap = tip && i === 1 ? 'round' : 'butt';
        this.stroke(px, py, this.point.x, this.point.y, 2 + 6 * s.glow, rgba(tone, fade * 0.2 * s.glow));
        this.stroke(px, py, this.point.x, this.point.y, s.thickness, rgba(tone, fade));
        px = this.point.x;
        py = this.point.y;
      }
    }

    drawHead(s, x, y, intensity, twinkle) {
      if (intensity <= 0) return;
      const ctx = this.ctx;
      const tone = this.colors.head;
      const reach = (12 + 40 * s.glow);
      const bloom = ctx.createRadialGradient(x, y, 0, x, y, reach);
      const strength = 0.4 * s.glow * intensity;
      bloom.addColorStop(0, rgba(tone, strength));
      bloom.addColorStop(0.2, rgba(tone, strength * 0.4));
      bloom.addColorStop(0.5, rgba(tone, strength * 0.1));
      bloom.addColorStop(1, rgba(tone, 0));
      ctx.fillStyle = bloom;
      ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
      if (!s.sparkle) return;

      const size = (1 + s.thickness * 0.6);
      const core = ctx.createRadialGradient(x, y, 0, x, y, size * 2.2);
      core.addColorStop(0, rgba(WHITE, intensity));
      core.addColorStop(0.4, rgba(mix(tone, WHITE, 0.5), intensity * 0.9));
      core.addColorStop(1, rgba(tone, 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, size * 2.2, 0, TAU);
      ctx.fill();

      const spike = (3 + 4 * s.glow + s.thickness * 1.5) * twinkle;
      const horizontal = ctx.createLinearGradient(x - spike, y, x + spike, y);
      horizontal.addColorStop(0, rgba(tone, 0));
      horizontal.addColorStop(0.5, rgba(WHITE, intensity * 0.95));
      horizontal.addColorStop(1, rgba(tone, 0));
      this.stroke(x - spike, y, x + spike, y, 1, horizontal);
      const vertical = ctx.createLinearGradient(x, y - spike, x, y + spike);
      vertical.addColorStop(0, rgba(tone, 0));
      vertical.addColorStop(0.5, rgba(WHITE, intensity * 0.95));
      vertical.addColorStop(1, rgba(tone, 0));
      this.stroke(x, y - spike, x, y + spike, 1, vertical);
    }

    spawnDust(x, y, nx, ny, speed) {
      if (this.dust.length > 48) return;
      const push = 3 + Math.random() * 10;
      const drift = (Math.random() - 0.5) * 8;
      this.dust.push({
        x: x + nx * (Math.random() * 3 - 1),
        y: y + ny * (Math.random() * 3 - 1),
        vx: nx * push - ny * drift - speed * -this.point.ny * 0.04,
        vy: ny * push + nx * drift - speed * this.point.nx * 0.04,
        age: 0,
        life: 0.35 + Math.random() * 0.5,
        size: 0.45 + Math.random() * 0.7,
        seed: Math.random() * TAU
      });
    }

    draw(s, shape) {
      const ctx = this.ctx;
      const st = this.state;
      const boosted = st.boost > 0.001 || st.flash > 0.001;
      const eff = boosted
        ? { ...s, glow: Math.min(1.5, s.glow + 0.4 * Math.max(st.boost, st.flash)) }
        : s;
      const bleed = s.bleed;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (st.width < 2 || st.height < 2) return;
      const offset = (bleed + s.thickness / 2) * st.dpr;
      ctx.setTransform(st.dpr, 0, 0, st.dpr, offset, offset);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'butt';

      const total = shape.total;
      const spacing = total / s.stars;
      const speed = Math.abs(st.motion);
      const sign = st.motion >= 0 ? 1 : -1;
      const span = s.trailLength * s.duration;
      const length = Math.min(speed * span, spacing * 0.92, total * 0.6);
      const intensity = st.reveal * (1 + 0.4 * st.boost + 0.6 * st.flash);

      const ring = st.flash * 0.32 + st.boost * st.reveal * 0.12;
      if (ring > 0.005) {
        ctx.lineWidth = s.thickness + 2 * s.glow;
        ctx.strokeStyle = rgba(this.colors.head, ring);
        ctx.beginPath();
        ctx.roundRect(0, 0, Math.max(1, st.width - s.thickness), Math.max(1, st.height - s.thickness), Math.max(0, shape.r));
        ctx.stroke();
      }

      const still = clamp(1 - speed / Math.max(1, (total / s.duration) * 0.6), 0, 1) * Math.min(1, st.reveal);
      const rest = (10 + 14 * s.glow + s.thickness * 2) * still;
      for (let i = 0; i < s.stars; i++) {
        const head = st.phase + i * spacing;
        this.drawTrail(eff, shape, head, length, sign, Math.min(1, intensity));
        if (still > 0.01) {
          this.drawTrail(eff, shape, head, rest, 1, still, false);
          this.drawTrail(eff, shape, head, rest, -1, still, false);
        }
      }

      this.pulses.forEach(pulse => {
        const progress = pulse.age / 0.65;
        const fade = (1 - progress) ** 2;
        const travel = (total / 2) * (1 - (1 - Math.min(1, pulse.age / 0.5)) ** 2);
        const tail = Math.min(travel, total * 0.16);
        [1, -1].forEach(way => {
          const front = pulse.origin + way * travel;
          this.drawTrail(eff, shape, front, tail, way, fade);
          pointAt(shape, front, this.point);
          this.drawHead(eff, this.point.x, this.point.y, fade * 0.8, 0.8);
        });
      });

      for (let i = 0; i < s.stars; i++) {
        pointAt(shape, st.phase + i * spacing, this.point);
        const twinkle = 0.82 + 0.18 * Math.sin(st.time * 6.1 + i * 2.3) * Math.sin(st.time * 2.7 + i);
        this.drawHead(eff, this.point.x, this.point.y, Math.min(1.3, intensity), twinkle);
      }

      this.dust.forEach(mote => {
        const left = 1 - mote.age / mote.life;
        const shimmer = 0.45 + 0.55 * Math.sin(st.time * 20 + mote.seed);
        const alpha = left * shimmer * st.reveal * 0.9;
        if (alpha <= 0.01) return;
        ctx.fillStyle = rgba(mix(this.colors.tail, WHITE, 0.6), alpha);
        ctx.beginPath();
        ctx.arc(mote.x, mote.y, mote.size * (0.6 + 0.4 * left), 0, TAU);
        ctx.fill();
      });
    }

    frame(now, dt) {
      const s = this.s;
      const st = this.state;
      st.time += dt;

      const key = `${s.color}|${s.trailColor}`;
      if (key !== this.colors.key) {
        this.colors.key = key;
        this.colors.head = toRgb(s.color);
        this.colors.tail = toRgb(s.trailColor);
      }

      if (st.width !== this.root.offsetWidth || st.height !== this.root.offsetHeight) this.measure();
      if (!st.width || !st.height) return;

      const shape = this.shape();
      const total = shape.total;
      const spacing = total / s.stars;
      const engaged = st.hovered;
      const cruise = this.reduce ? 0 : (s.direction * total) / s.duration;
      const idleCruise = this.reduce ? 0 : (s.idle ? 0 : 1);

      st.reveal += (1 - st.reveal) * (1 - Math.exp(-dt / 0.35));
      const boostTarget = engaged ? 1 : 0;
      st.boost += (boostTarget - st.boost) * (1 - Math.exp(-dt / (boostTarget > st.boost ? 0.18 : 0.5)));
      st.flash *= Math.exp(-dt / 0.22);

      st.velocity += (cruise * idleCruise - st.velocity) * (1 - Math.exp(-dt / 0.45));
      let extra = 0;
      if (st.lap >= 0) {
        const before = ease(Math.min(1, st.lap / LAP));
        st.lap += dt;
        extra = (ease(Math.min(1, st.lap / LAP)) - before) * total * s.direction;
        if (st.lap >= LAP) st.lap = -1;
      }
      st.motion = st.velocity + extra / dt;
      st.phase = wrap(st.phase + st.velocity * dt + extra, total);

      const pace = Math.abs(st.motion) / Math.max(1, Math.abs(total / s.duration));
      if (s.sparkle && !this.reduce && st.reveal > 0.05) {
        st.emit += dt * (2 + 6 * Math.min(2, pace)) * s.stars;
        while (st.emit > 1) {
          st.emit -= 1;
          pointAt(shape, st.phase + Math.floor(Math.random() * s.stars) * spacing, this.point);
          this.spawnDust(this.point.x, this.point.y, this.point.nx, this.point.ny, st.motion);
        }
      }
      for (let i = this.dust.length - 1; i >= 0; i--) {
        const mote = this.dust[i];
        mote.age += dt;
        mote.x += mote.vx * dt;
        mote.y += mote.vy * dt;
        mote.vx *= Math.exp(-dt * 2.2);
        mote.vy *= Math.exp(-dt * 2.2);
        if (mote.age >= mote.life) this.dust.splice(i, 1);
      }
      for (let i = this.pulses.length - 1; i >= 0; i--) {
        this.pulses[i].age += dt;
        if (this.pulses[i].age >= 0.65) this.pulses.splice(i, 1);
      }

      this.draw(s, shape);
    }

    destroy() {
      Engine.remove(this);
      this.ro.disconnect();
      this.canvas.remove();
    }
  }

  window.NebStar = { StarBorder };
  window.RS6Star = window.NebStar; /* legacy alias */
})();
