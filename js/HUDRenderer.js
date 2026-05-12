// js/HUDRenderer.js
// Sci-Fi HUD — inspired by concentric-ring targeting UI.
// Layout: notched outer frame, large concentric ring system in center (tracks face),
// column of small status circles on the left, info panels on the right,
// progress bar at bottom, scanlines + glitch throughout.

class HUDRenderer {
    constructor(canvas) {
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._box = null;
        this._faceCenter = null;
        this._active = false;
        this._time = 0;
        this._glitchT = 3 + Math.random() * 4;
        this._fps = 60;
        this._lock = 0;
        this._frozen = false;

        // Bar chart data (right panel)
        this._bars = [0.4, 0.7, 0.55, 0.85, 0.6, 0.45];
        this._barTgt = [0.4, 0.7, 0.55, 0.85, 0.6, 0.45];

        // Small circle ring speeds (left column)
        this._circleAngles = [0, 0, 0, 0, 0];
        this._circleSpeeds = [1.2, -0.8, 1.5, -1.1, 0.9];

        // Progress bar value
        this._progress = 0.5;
        this._progressTgt = 0.5;

        // Scan animation state (triggered on freeze)
        this._scanProgress = 0;   // 0→1 over 3 s
        this._scanDone = false; // true when scan complete → show dossier

        // Subject photo (Bao.png as base64)
        this._subjectImg = new Image();
        this._subjectImg.src = 'Bao.png';
        this._subjectImgLoaded = false;
        this._subjectImg.onload = () => { this._subjectImgLoaded = true; };

        // Telemetry strip values for the right-side info hub.
        this._telemetry = [0.72, 0.48, 0.83, 0.36];
        this._telemetryTgt = [0.72, 0.48, 0.83, 0.36];
    }

    setActive(v) { this._active = v; if (!v) this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height); }
    setHandBox(box) { this._box = box; }
    setFaceCenter(fc) { this._faceCenter = fc; }
    setFPS(fps) { this._fps = fps; }
    setFrozen(v) {
        this._frozen = !!v;
        if (v) {
            // Start scan animation: progress 0→1 over 3 seconds
            this._scanProgress = 0;
            this._scanDone = false;
        } else {
            this._scanProgress = 0;
            this._scanDone = false;
        }
    }

    tick(dt) {
        if (!this._active) return;
        dt = Math.min(dt, 0.1);
        this._time += dt;
        this._glitchT -= dt;
        if (this._glitchT < 0) this._glitchT = 2.5 + Math.random() * 5;

        // Animate circles
        for (let i = 0; i < this._circleAngles.length; i++) {
            this._circleAngles[i] += this._circleSpeeds[i] * dt;
        }

        // Drift bars
        for (let i = 0; i < this._bars.length; i++) {
            this._bars[i] += (this._barTgt[i] - this._bars[i]) * dt * 3;
            if (Math.abs(this._bars[i] - this._barTgt[i]) < 0.02) {
                this._barTgt[i] = 0.2 + Math.random() * 0.75;
            }
        }

        // Drift progress
        this._progress += (this._progressTgt - this._progress) * dt * 1.5;
        if (Math.abs(this._progress - this._progressTgt) < 0.01) {
            this._progressTgt = 0.3 + Math.random() * 0.65;
        }

        // Drift telemetry
        for (let i = 0; i < this._telemetry.length; i++) {
            this._telemetry[i] += (this._telemetryTgt[i] - this._telemetry[i]) * dt * 2.4;
            if (Math.abs(this._telemetry[i] - this._telemetryTgt[i]) < 0.025) {
                this._telemetryTgt[i] = 0.18 + Math.random() * 0.78;
            }
        }

        // Lock tracking
        this._lock = this._faceCenter
            ? Math.min(this._lock + dt * 2, 1)
            : Math.max(this._lock - dt * 2, 0);

        // Scan progress animation (only while frozen and not yet done)
        if (this._frozen && !this._scanDone) {
            this._scanProgress = Math.min(1, this._scanProgress + dt / 3.0);
            if (this._scanProgress >= 1) this._scanDone = true;
        }

        this._draw();
    }

    _C(alpha) { return `rgba(0,200,255,${alpha})`; }
    _CL(h, s, l, a) { return `hsla(${h},${s}%,${l}%,${a})`; }

    _draw() {
        const ctx = this._ctx;
        ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        if (!this._box) return;

        const { left, top, right, bottom } = this._box;
        const bw = right - left, bh = bottom - top;
        if (bw < 80 || bh < 50) return;

        ctx.save();
        ctx.beginPath(); ctx.rect(left, top, bw, bh); ctx.clip();

        // Background
        const bg = ctx.createLinearGradient(left, top, right, bottom);
        bg.addColorStop(0, 'rgba(0,12,30,0.92)');
        bg.addColorStop(0.5, 'rgba(0,20,45,0.88)');
        bg.addColorStop(1, 'rgba(0,10,25,0.94)');
        ctx.fillStyle = bg; ctx.fillRect(left, top, bw, bh);

        // Scanlines
        for (let y = top; y < bottom; y += 4) {
            const a = 0.018 + Math.sin(y * 0.2 - this._time * 5) * 0.01;
            ctx.fillStyle = `rgba(0,180,255,${a.toFixed(3)})`;
            ctx.fillRect(left, y, bw, 1);
        }

        this._drawCircuitBackdrop(ctx, left, top, bw, bh);

        // Zones
        const lw = bw * 0.22, cw = bw * 0.52, rw = bw * 0.26;
        const lx = left, cx = left + lw, rx = left + lw + cw;
        const cy = top + bh / 2;

        this._drawOuterFrame(ctx, left, top, right, bottom, bw, bh);
        this._drawLeftColumn(ctx, lx, top, lw, bh);
        this._drawCenterRings(ctx, cx + cw / 2, cy, Math.min(cw, bh) * 0.46, bw, bh, left, top);
        this._drawRightPanel(ctx, rx, top, rw, bh);
        this._drawBottomBar(ctx, left, bottom, bw, bh);
        if (this._frozen && this._scanDone) this._drawParodyDossier(ctx, cx, top, cw, bh);

        if (this._glitchT < 0.08) this._drawGlitch(ctx, left, top, bw, bh);

        ctx.restore();
    }

    // ── Outer notched frame ───────────────────────────────────────────────────
    _drawOuterFrame(ctx, left, top, right, bottom, bw, bh) {
        const notch = Math.min(bw, bh) * 0.07;
        const pulse = 0.55 + Math.sin(this._time * 1.8) * 0.25;
        ctx.save();
        ctx.strokeStyle = this._C(pulse);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = '#00c8ff';
        ctx.shadowBlur = 10;

        // Outer octagon-ish frame
        ctx.beginPath();
        ctx.moveTo(left + notch, top);
        ctx.lineTo(right - notch, top);
        ctx.lineTo(right, top + notch);
        ctx.lineTo(right, bottom - notch);
        ctx.lineTo(right - notch, bottom);
        ctx.lineTo(left + notch, bottom);
        ctx.lineTo(left, bottom - notch);
        ctx.lineTo(left, top + notch);
        ctx.closePath();
        ctx.stroke();

        // Inner inset frame (thinner)
        const ins = Math.min(bw, bh) * 0.025;
        ctx.strokeStyle = this._C(pulse * 0.35);
        ctx.lineWidth = 0.7;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.moveTo(left + notch + ins, top + ins);
        ctx.lineTo(right - notch - ins, top + ins);
        ctx.lineTo(right - ins, top + notch + ins);
        ctx.lineTo(right - ins, bottom - notch - ins);
        ctx.lineTo(right - notch - ins, bottom - ins);
        ctx.lineTo(left + notch + ins, bottom - ins);
        ctx.lineTo(left + ins, bottom - notch - ins);
        ctx.lineTo(left + ins, top + notch + ins);
        ctx.closePath();
        ctx.stroke();

        // Corner accent lines
        ctx.strokeStyle = this._C(0.7);
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 8;
        const arm = Math.min(bw, bh) * 0.09;
        [[left, top + notch, 0, arm], [left + notch, top, arm, 0],
        [right, top + notch, 0, arm], [right - notch, top, -arm, 0],
        [left, bottom - notch, 0, -arm], [left + notch, bottom, arm, 0],
        [right, bottom - notch, 0, -arm], [right - notch, bottom, -arm, 0]
        ].forEach(([x, y, dx, dy]) => {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
        });

        // Vertical dividers between zones
        ctx.strokeStyle = this._C(0.15);
        ctx.lineWidth = 0.8;
        ctx.shadowBlur = 0;
        ctx.setLineDash([3, 6]);
        const d1 = left + bw * 0.22, d2 = left + bw * 0.74;
        ctx.beginPath(); ctx.moveTo(d1, top + 6); ctx.lineTo(d1, bottom - 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(d2, top + 6); ctx.lineTo(d2, bottom - 6); ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    // ── Left column: small status circles ────────────────────────────────────
    _drawLeftColumn(ctx, x, y, w, h) {
        const cx = x + w * 0.5;
        const count = 5;
        const spacing = h / (count + 1);
        const r = Math.min(w * 0.28, spacing * 0.38);

        // Top-left crosshair box
        this._drawNotchedBox(ctx, x + 4, y + 6, w - 8, h * 0.22, 0.4);
        // Crosshair inside
        const bcx = x + w / 2, bcy = y + h * 0.11;
        ctx.save();
        ctx.strokeStyle = this._C(0.6);
        ctx.lineWidth = 1;
        const cr = r * 0.7;
        ctx.beginPath(); ctx.arc(bcx, bcy, cr, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bcx - cr * 1.4, bcy); ctx.lineTo(bcx + cr * 1.4, bcy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bcx, bcy - cr * 1.4); ctx.lineTo(bcx, bcy + cr * 1.4); ctx.stroke();
        ctx.restore();

        // 5 small animated circles
        for (let i = 0; i < count; i++) {
            const cy2 = y + h * 0.28 + i * spacing * 0.72;
            this._drawSmallCircle(ctx, cx, cy2, r, i);
        }
    }

    _drawSmallCircle(ctx, cx, cy, r, idx) {
        const t = this._time;
        const angle = this._circleAngles[idx];
        const pulse = 0.5 + Math.sin(t * 2 + idx * 1.3) * 0.3;

        ctx.save();
        // Outer ring
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = this._C(0.35); ctx.lineWidth = 1; ctx.stroke();

        // Rotating arc segment
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.82, angle, angle + Math.PI * 1.1);
        ctx.strokeStyle = this._C(0.7 + pulse * 0.2); ctx.lineWidth = 1.5; ctx.stroke();

        // Inner dot
        ctx.beginPath(); ctx.arc(cx, cy, r * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = this._C(0.5 + pulse * 0.4); ctx.fill();

        // Tick marks
        for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            const len = k % 2 === 0 ? r * 0.18 : r * 0.1;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2));
            ctx.lineTo(cx + Math.cos(a) * (r + 2 + len), cy + Math.sin(a) * (r + 2 + len));
            ctx.strokeStyle = this._C(0.3); ctx.lineWidth = 0.8; ctx.stroke();
        }
        ctx.restore();
    }

    // ── Center: large concentric rings tracking face ──────────────────────────
    _drawCenterRings(ctx, cx, cy, maxR, bw, bh, bLeft, bTop) {
        const t = this._time;
        const lock = this._lock;

        // Target point
        let tx = cx, ty = cy;
        if (this._faceCenter) {
            const { left, top, right, bottom } = this._box;
            tx = Math.max(left + bw * 0.24, Math.min(left + bw * 0.73, this._faceCenter.x));
            ty = Math.max(top + 20, Math.min(bottom - 20, this._faceCenter.y));
        }

        ctx.save();

        // ── Concentric rings (7 rings, alternating solid/dashed) ──────────────
        const ringDefs = [
            { f: 1.00, alpha: 0.20, dash: [], lw: 1.2, rot: 0 },
            { f: 0.88, alpha: 0.35, dash: [8, 6], lw: 1.0, rot: t * 0.3 },
            { f: 0.76, alpha: 0.45, dash: [], lw: 1.5, rot: 0 },
            { f: 0.63, alpha: 0.55, dash: [5, 4], lw: 1.0, rot: -t * 0.5 },
            { f: 0.50, alpha: 0.65, dash: [], lw: 1.8, rot: 0 },
            { f: 0.36, alpha: 0.75, dash: [3, 3], lw: 1.0, rot: t * 0.8 },
            { f: 0.22, alpha: 0.85, dash: [], lw: 2.0, rot: 0 },
        ];

        ringDefs.forEach(({ f, alpha, dash, lw, rot }) => {
            const r = maxR * f;
            ctx.save();
            ctx.translate(tx, ty);
            ctx.rotate(rot);
            ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.strokeStyle = this._C(alpha + lock * 0.15);
            ctx.lineWidth = lw;
            ctx.setLineDash(dash);
            ctx.shadowColor = '#00c8ff';
            ctx.shadowBlur = lw * 3;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        });

        // ── Tick marks on outermost ring ──────────────────────────────────────
        const outerR = maxR * 1.0;
        for (let k = 0; k < 36; k++) {
            const a = (k / 36) * Math.PI * 2 + t * 0.15;
            const len = k % 3 === 0 ? outerR * 0.08 : outerR * 0.04;
            ctx.beginPath();
            ctx.moveTo(tx + Math.cos(a) * outerR, ty + Math.sin(a) * outerR);
            ctx.lineTo(tx + Math.cos(a) * (outerR + len), ty + Math.sin(a) * (outerR + len));
            ctx.strokeStyle = this._C(0.4); ctx.lineWidth = 0.8; ctx.stroke();
        }

        // ── Triangle markers at N/S/E/W ───────────────────────────────────────
        [[0, -1], [0, 1], [-1, 0], [1, 0]].forEach(([dx, dy], i) => {
            const r2 = maxR * 0.88;
            const px = tx + dx * r2, py = ty + dy * r2;
            const size = maxR * 0.04;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(0, -size); ctx.lineTo(size * 0.6, size * 0.6); ctx.lineTo(-size * 0.6, size * 0.6);
            ctx.closePath();
            ctx.fillStyle = this._C(0.7 + Math.sin(t * 3 + i) * 0.2);
            ctx.fill();
            ctx.restore();
        });

        // ── Crosshair arms ────────────────────────────────────────────────────
        const armLen = maxR * 0.18, gap = maxR * 0.08;
        const chColor = lock > 0.8
            ? `rgba(255,${Math.round(160 - lock * 160)},0,0.9)`
            : this._C(0.8);
        ctx.strokeStyle = chColor; ctx.lineWidth = 1.5;
        ctx.shadowColor = chColor; ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(tx - gap - armLen, ty); ctx.lineTo(tx - gap, ty);
        ctx.moveTo(tx + gap, ty); ctx.lineTo(tx + gap + armLen, ty);
        ctx.moveTo(tx, ty - gap - armLen); ctx.lineTo(tx, ty - gap);
        ctx.moveTo(tx, ty + gap); ctx.lineTo(tx, ty + gap + armLen);
        ctx.stroke();

        // ── Center dot ────────────────────────────────────────────────────────
        ctx.beginPath(); ctx.arc(tx, ty, maxR * 0.04, 0, Math.PI * 2);
        ctx.fillStyle = chColor; ctx.fill();

        // ── Lock label ────────────────────────────────────────────────────────
        if (lock > 0.3) {
            ctx.font = `bold ${Math.round(maxR * 0.1)}px 'Share Tech Mono', monospace`;
            ctx.fillStyle = chColor;
            ctx.textAlign = 'center';
            ctx.shadowBlur = 8;
            ctx.fillText(lock > 0.9 ? 'TARGET LOCKED' : 'ACQUIRING', tx, ty - maxR * 0.55);
        }

        ctx.restore();
    }

    _drawCircuitBackdrop(ctx, left, top, bw, bh) {
        const t = this._time;
        ctx.save();
        ctx.strokeStyle = this._C(0.055);
        ctx.lineWidth = 0.6;
        const step = Math.max(12, Math.min(bw, bh) * 0.055);
        for (let x = left + step; x < left + bw; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, top + bh);
            ctx.stroke();
        }
        for (let y = top + step; y < top + bh; y += step) {
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(left + bw, y);
            ctx.stroke();
        }

        ctx.strokeStyle = this._C(0.18);
        ctx.setLineDash([10, 8]);
        const sweepX = left + ((t * 32) % bw);
        ctx.beginPath();
        ctx.moveTo(sweepX, top + 4);
        ctx.lineTo(sweepX, top + bh - 4);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(0,220,255,0.12)';
        for (let i = 0; i < 18; i++) {
            const px = left + ((i * 61 + t * 18) % bw);
            const py = top + ((i * 37 + Math.sin(t + i) * 12 + bh) % bh);
            ctx.fillRect(px, py, 2, 2);
        }
        ctx.restore();
    }

    // ── Right panel: dense sci-fi telemetry info hub ──────────────────────────
    _drawRightPanel(ctx, x, y, w, h) {
        const t = this._time;
        const pad = Math.max(5, w * 0.035);
        const panelX = x + pad;
        const panelW = w - pad * 2;

        // Header rail
        const headH = h * 0.12;
        this._drawNotchedBox(ctx, panelX, y + pad, panelW, headH, 0.55);
        ctx.save();
        ctx.font = `bold ${Math.max(8, Math.round(h * 0.035))}px 'Share Tech Mono', monospace`;
        ctx.fillStyle = this._C(0.95);
        ctx.textAlign = 'left';
        ctx.shadowColor = '#00c8ff';
        ctx.shadowBlur = 8;
        ctx.fillText('NEXUS HUB', panelX + pad * 1.4, y + pad + headH * 0.42);
        ctx.font = `${Math.max(6, Math.round(h * 0.025))}px 'Share Tech Mono', monospace`;
        ctx.fillStyle = this._C(0.55);
        ctx.shadowBlur = 0;
        ctx.fillText(`SYNC ${Math.round(this._progress * 100).toString().padStart(2, '0')} // FPS ${Math.round(this._fps)}`, panelX + pad * 1.4, y + pad + headH * 0.76);
        ctx.textAlign = 'right';
        ctx.fillStyle = this._CL(176, 95, 62, 0.85);
        ctx.fillText(this._lock > 0.75 ? 'LOCKED' : 'SCAN', panelX + panelW - pad * 1.4, y + pad + headH * 0.58);
        ctx.restore();

        // Mini radar (replaces photo box)
        const gbY = y + pad + headH + h * 0.025;
        const gbH = h * 0.23;
        this._drawNotchedBox(ctx, panelX, gbY, panelW, gbH, 0.42);
        ctx.save();
        const rcx = panelX + panelW / 2, rcy = gbY + gbH / 2;
        const rMax = Math.min(panelW, gbH) * 0.42;
        // Concentric rings
        [1.0, 0.68, 0.38].forEach((f, i) => {
            ctx.beginPath(); ctx.arc(rcx, rcy, rMax * f, 0, Math.PI * 2);
            ctx.strokeStyle = this._C(0.18 + i * 0.1); ctx.lineWidth = 0.8; ctx.stroke();
        });
        // Cross hairs
        ctx.strokeStyle = this._C(0.12); ctx.lineWidth = 0.6;
        ctx.setLineDash([3, 5]);
        ctx.beginPath(); ctx.moveTo(rcx - rMax, rcy); ctx.lineTo(rcx + rMax, rcy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rcx, rcy - rMax); ctx.lineTo(rcx, rcy + rMax); ctx.stroke();
        ctx.setLineDash([]);
        // Sweep sector
        const sweepAngle = this._time * 1.6;
        const sweepSpan = Math.PI * 0.5;
        const sg = ctx.createRadialGradient(rcx, rcy, 0, rcx, rcy, rMax);
        sg.addColorStop(0, 'rgba(0,255,180,0.0)');
        sg.addColorStop(0.6, 'rgba(0,255,180,0.14)');
        sg.addColorStop(1, 'rgba(0,255,180,0.0)');
        ctx.beginPath(); ctx.moveTo(rcx, rcy);
        ctx.arc(rcx, rcy, rMax, sweepAngle - sweepSpan, sweepAngle);
        ctx.closePath(); ctx.fillStyle = sg; ctx.fill();
        // Leading edge
        ctx.beginPath();
        ctx.moveTo(rcx, rcy);
        ctx.lineTo(rcx + Math.cos(sweepAngle) * rMax, rcy + Math.sin(sweepAngle) * rMax);
        ctx.strokeStyle = 'rgba(0,255,200,0.7)'; ctx.lineWidth = 1.2; ctx.stroke();
        // Blip dots
        const bucket = Math.floor(this._time * 0.5);
        const rng = n => { let v = Math.sin(n * 127.1 + bucket * 311.7) * 43758.5; return v - Math.floor(v); };
        for (let i = 0; i < 4; i++) {
            const a = rng(i * 3) * Math.PI * 2;
            const d = rng(i * 3 + 1) * rMax * 0.85;
            const bx = rcx + Math.cos(a) * d, by = rcy + Math.sin(a) * d;
            const pulse = Math.sin(this._time * 4 + i * 2.1) * 0.5 + 0.5;
            ctx.beginPath(); ctx.arc(bx, by, 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(0,255,180,${(0.4 + pulse * 0.5).toFixed(2)})`; ctx.fill();
        }
        // Center dot
        ctx.beginPath(); ctx.arc(rcx, rcy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,255,220,0.9)'; ctx.fill();
        // Label
        ctx.font = `${Math.max(6, Math.round(h * 0.024))}px 'Share Tech Mono', monospace`;
        ctx.fillStyle = this._C(0.45); ctx.textAlign = 'left';
        ctx.fillText('RADAR', panelX + 4, gbY + 11);
        ctx.restore();

        // Circular lock meter
        const mY = gbY + gbH + h * 0.035;
        const mR = Math.min(w * 0.22, h * 0.12);
        const mcx = x + w * 0.5, mcy = mY + mR;
        ctx.save();
        ctx.beginPath(); ctx.arc(mcx, mcy, mR, 0, Math.PI * 2);
        ctx.strokeStyle = this._C(0.2); ctx.lineWidth = 3; ctx.stroke();
        const pct = Math.max(0.08, this._lock * 0.75 + this._progress * 0.25);
        ctx.beginPath(); ctx.arc(mcx, mcy, mR, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
        ctx.strokeStyle = this._C(0.8); ctx.lineWidth = 3;
        ctx.shadowColor = '#00c8ff'; ctx.shadowBlur = 8; ctx.stroke();
        ctx.setLineDash([2, 5]);
        ctx.beginPath(); ctx.arc(mcx, mcy, mR * 1.22, t * 0.8, t * 0.8 + Math.PI * 1.5);
        ctx.strokeStyle = this._C(0.35); ctx.lineWidth = 1; ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = `bold ${Math.round(mR * 0.55)}px 'Share Tech Mono', monospace`;
        ctx.fillStyle = this._C(0.9); ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(pct * 100)}%`, mcx, mcy + mR * 0.22);
        ctx.restore();

        // Waveform and bar chart panel
        const chY = mcy + mR + h * 0.035;
        const chH = h * 0.24;
        this._drawNotchedBox(ctx, panelX, chY, panelW, chH, 0.4);
        this._drawWaveform(ctx, panelX + pad, chY + pad, panelW - pad * 2, chH * 0.38);
        const barW2 = (panelW - pad * 4) / this._bars.length - 2;
        const barBaseY = chY + chH - pad;
        ctx.save();
        this._bars.forEach((v, i) => {
            const bx = panelX + pad * 2 + i * (barW2 + 2);
            const bh2 = (chH * 0.48) * v;
            const by = barBaseY - bh2;
            const hue = 185 + v * 30;
            ctx.fillStyle = `hsla(${hue},90%,60%,0.75)`;
            ctx.fillRect(bx, by, barW2, bh2);
            ctx.fillStyle = this._C(0.9);
            ctx.fillRect(bx, by, barW2, 2);
        });
        ctx.restore();

        // Micro data cells
        const cellY = chY + chH + h * 0.025;
        const cellH = Math.max(10, h * 0.078);
        const gap = 3;
        const cellW = (panelW - gap * 3) / 4;
        ['XEN', 'ION', 'VEC', 'LUX'].forEach((label, i) => {
            const cx = panelX + i * (cellW + gap);
            this._drawNotchedBox(ctx, cx, cellY, cellW, cellH, 0.28 + this._telemetry[i] * 0.28);
            ctx.save();
            ctx.font = `${Math.max(5, Math.round(cellH * 0.28))}px 'Share Tech Mono', monospace`;
            ctx.fillStyle = this._C(0.55);
            ctx.textAlign = 'center';
            ctx.fillText(label, cx + cellW / 2, cellY + cellH * 0.36);
            ctx.fillStyle = this._C(0.9);
            ctx.fillText(Math.round(this._telemetry[i] * 99).toString().padStart(2, '0'), cx + cellW / 2, cellY + cellH * 0.72);
            ctx.restore();
        });
    }

    _drawWaveform(ctx, x, y, w, h) {
        const t = this._time;
        ctx.save();
        ctx.strokeStyle = this._C(0.16);
        ctx.lineWidth = 0.6;
        for (let i = 0; i < 4; i++) {
            const yy = y + h * (i / 3);
            ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
        }

        ctx.strokeStyle = this._C(0.75);
        ctx.lineWidth = 1.2;
        ctx.shadowColor = '#00c8ff';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        for (let i = 0; i <= 34; i++) {
            const px = x + (i / 34) * w;
            const amp = Math.sin(i * 0.82 + t * 5) * 0.35 + Math.sin(i * 0.23 - t * 2) * 0.2;
            const py = y + h * 0.5 + amp * h * (0.25 + this._lock * 0.22);
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
        ctx.restore();
    }

    _drawParodyDossier(ctx, x, y, w, h) {
        const t = this._time;
        const pad = Math.max(10, Math.min(w, h) * 0.045);
        const panelX = x + w * 0.06;
        const panelY = y + h * 0.12;
        const panelW = w * 0.88;
        const panelH = h * 0.72;

        ctx.save();
        ctx.globalAlpha = 0.96;
        this._drawNotchedBox(ctx, panelX, panelY, panelW, panelH, 0.82);

        const warnGrad = ctx.createLinearGradient(panelX, panelY, panelX + panelW, panelY);
        warnGrad.addColorStop(0, 'rgba(255,60,0,0.1)');
        warnGrad.addColorStop(0.5, 'rgba(0,220,255,0.2)');
        warnGrad.addColorStop(1, 'rgba(255,60,0,0.1)');
        ctx.fillStyle = warnGrad;
        ctx.fillRect(panelX + 1, panelY + 1, panelW - 2, panelH - 2);

        ctx.font = `bold ${Math.max(14, Math.round(h * 0.065))}px 'Share Tech Mono', monospace`;
        ctx.fillStyle = 'rgba(255,80,0,0.95)';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#ff5000';
        ctx.shadowBlur = 12;
        ctx.fillText('TARGET SCAN', panelX + panelW / 2, panelY + pad * 1.7);

        ctx.font = `${Math.max(9, Math.round(h * 0.034))}px 'Share Tech Mono', monospace`;
        ctx.fillStyle = this._C(0.72);
        ctx.shadowBlur = 0;
        ctx.fillText('HỆ THỐNG QUÉT NHẬN DẠNG ĐỐI TƯỢNG', panelX + panelW / 2, panelY + pad * 2.65);

        const avatarX = panelX + pad;
        const avatarY = panelY + pad * 3.35;
        const avatarW = panelW * 0.28;
        const avatarH = panelH - pad * 4.3;
        this._drawNotchedBox(ctx, avatarX, avatarY, avatarW, avatarH, 0.56);
        this._drawClassifiedAvatar(ctx, avatarX, avatarY, avatarW, avatarH);

        const dataX = avatarX + avatarW + pad;
        const dataY = avatarY + 2;
        const rowH = Math.max(13, (avatarH - pad) / 8);
        const rows = [
            ['TARGET ID', 'B-04'],
            ['HO TEN', 'HUỲNH PHƯỚC BẢO'],
            ['NGAY SINH', '12/10/2004'],
            ['DIA CHI', 'K92/27 ĐINH TIÊN HOÀNG, ĐÀ NẴNG'],
            ['HOC VAN', 'ĐẠI HỌC NGOẠI NGỮ, ĐẠI HỌC ĐÀ NẴNG'],
            ['CHUYEN NGANH', 'NGÔN NGỮ ANH'],
            ['HON NHAN', 'ĐỘC THÂN'],
            ['MUC DO NGUY HIEM', '0/10 SAFE']
        ];

        ctx.textAlign = 'left';
        rows.forEach(([label, value], i) => {
            const yy = dataY + i * rowH;
            const pulse = 0.35 + Math.sin(t * 4 + i) * 0.08;
            ctx.fillStyle = `rgba(0,180,255,${pulse})`;
            ctx.fillRect(dataX, yy, panelW - avatarW - pad * 3, rowH - 2);
            ctx.strokeStyle = this._C(0.18);
            ctx.strokeRect(dataX, yy, panelW - avatarW - pad * 3, rowH - 2);
            ctx.font = `${Math.max(8, Math.round(rowH * 0.42))}px 'Share Tech Mono', monospace`;
            ctx.fillStyle = this._C(0.58);
            ctx.fillText(label, dataX + 6, yy + rowH * 0.62);
            ctx.font = `bold ${Math.max(9, Math.round(rowH * 0.46))}px 'Share Tech Mono', monospace`;
            ctx.fillStyle = label.includes('NGUY') ? 'rgba(0,255,150,0.92)' : this._C(0.92);
            ctx.fillText(value, dataX + (panelW - avatarW) * 0.34, yy + rowH * 0.62);
        });

        ctx.font = `bold ${Math.max(9, Math.round(h * 0.036))}px 'Share Tech Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,80,0,0.8)';
        ctx.fillText('SOURCE: DỮ LIỆU CÔNG DÂN SỐ', panelX + panelW / 2, panelY + panelH - pad * 0.9);
        ctx.restore();
    }

    _drawClassifiedAvatar(ctx, x, y, w, h) {
        const cx = x + w / 2;
        const headR = Math.min(w, h) * 0.16;
        ctx.save();

        if (this._frozen && this._subjectImgLoaded) {
            // Frozen: show actual photo clipped to avatar area
            const imgPad = 4;
            const imgX = x + imgPad, imgY = y + imgPad;
            const imgW = w - imgPad * 2, imgH = h - imgPad * 2;
            const n = Math.min(imgW, imgH) * 0.1;
            ctx.beginPath();
            ctx.moveTo(imgX + n, imgY);
            ctx.lineTo(imgX + imgW - n, imgY);
            ctx.lineTo(imgX + imgW, imgY + n);
            ctx.lineTo(imgX + imgW, imgY + imgH - n);
            ctx.lineTo(imgX + imgW - n, imgY + imgH);
            ctx.lineTo(imgX + n, imgY + imgH);
            ctx.lineTo(imgX, imgY + imgH - n);
            ctx.lineTo(imgX, imgY + n);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(this._subjectImg, imgX, imgY, imgW, imgH);
            // Cyan sci-fi tint
            ctx.fillStyle = 'rgba(0,180,255,0.15)';
            ctx.fillRect(imgX, imgY, imgW, imgH);
            // Scanlines
            for (let sy = imgY; sy < imgY + imgH; sy += 3) {
                ctx.fillStyle = 'rgba(0,0,0,0.10)';
                ctx.fillRect(imgX, sy, imgW, 1);
            }
        } else {
            // Not frozen: CLASSIFIED silhouette
            ctx.strokeStyle = this._C(0.4);
            ctx.lineWidth = 1;
            for (let yy = y + 8; yy < y + h - 8; yy += 8) {
                ctx.beginPath();
                ctx.moveTo(x + 8, yy);
                ctx.lineTo(x + w - 8, yy);
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(cx, y + h * 0.34, headR, 0, Math.PI * 2);
            ctx.strokeStyle = this._C(0.85);
            ctx.shadowColor = '#00c8ff';
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(cx, y + h * 0.66, w * 0.28, h * 0.18, 0, Math.PI, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.fillStyle = 'rgba(255,80,0,0.86)';
            ctx.fillRect(x + w * 0.18, y + h * 0.46, w * 0.64, h * 0.12);
            ctx.font = `bold ${Math.max(8, Math.round(w * 0.1))}px 'Share Tech Mono', monospace`;
            ctx.textAlign = 'center';
            ctx.fillStyle = 'rgba(0,10,20,0.95)';
            ctx.fillText('CLASSIFIED', cx, y + h * 0.54);
        }
        ctx.restore();
    }

    // ── Bottom progress bar ───────────────────────────────────────────────────
    _drawBottomBar(ctx, left, bottom, bw, bh) {
        const barH = bh * 0.055;
        const barY = bottom - barH - bh * 0.04;
        const barX = left + bw * 0.22;
        const barW = bw * 0.56;

        // Determine which value to show
        const isScanning = this._frozen && !this._scanDone;
        const fillValue = isScanning ? this._scanProgress : this._progress;

        // Circle badge
        const badgeR = barH * 0.9;
        const badgeCx = barX - badgeR * 1.8;
        ctx.save();
        ctx.beginPath(); ctx.arc(badgeCx, barY + barH / 2, badgeR, 0, Math.PI * 2);
        ctx.strokeStyle = isScanning ? 'rgba(255,120,0,0.8)' : this._C(0.5);
        ctx.lineWidth = 1; ctx.stroke();
        ctx.font = `${Math.round(badgeR * 0.9)}px 'Share Tech Mono', monospace`;
        ctx.fillStyle = isScanning ? 'rgba(255,140,0,0.9)' : this._C(0.8);
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(fillValue * 100)}%`, badgeCx, barY + barH / 2 + badgeR * 0.35);

        // Bar background
        ctx.fillStyle = 'rgba(0,80,120,0.3)';
        ctx.strokeStyle = isScanning ? 'rgba(255,120,0,0.4)' : this._C(0.3);
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.rect(barX, barY, barW, barH); ctx.fill(); ctx.stroke();

        // Bar fill
        if (isScanning) {
            // Scanning: orange/red gradient with animated glow
            const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
            grad.addColorStop(0, 'rgba(255,80,0,0.6)');
            grad.addColorStop(0.7, 'rgba(255,160,0,0.9)');
            grad.addColorStop(1, 'rgba(255,220,0,0.7)');
            ctx.fillStyle = grad;
            ctx.fillRect(barX, barY, barW * fillValue, barH);
            // Animated leading edge glow
            const edgeX = barX + barW * fillValue;
            ctx.fillStyle = `rgba(255,200,0,${0.5 + Math.sin(this._time * 20) * 0.3})`;
            ctx.fillRect(edgeX - 3, barY, 3, barH);
            // SCANNING text
            const blink = Math.sin(this._time * 8) > 0;
            if (blink) {
                ctx.font = `bold ${Math.round(barH * 0.75)}px 'Share Tech Mono', monospace`;
                ctx.fillStyle = 'rgba(255,180,0,0.9)';
                ctx.textAlign = 'center';
                ctx.fillText('SCANNING...', barX + barW / 2, barY + barH * 0.78);
            }
        } else {
            const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
            grad.addColorStop(0, this._C(0.5));
            grad.addColorStop(0.7, this._C(0.85));
            grad.addColorStop(1, this._C(0.4));
            ctx.fillStyle = grad;
            ctx.fillRect(barX, barY, barW * fillValue, barH);
        }

        // Tick marks on bar
        ctx.strokeStyle = isScanning ? 'rgba(255,120,0,0.3)' : this._C(0.25);
        ctx.lineWidth = 0.7;
        for (let k = 1; k < 10; k++) {
            const tx2 = barX + barW * (k / 10);
            const len = k % 5 === 0 ? barH : barH * 0.5;
            ctx.beginPath(); ctx.moveTo(tx2, barY); ctx.lineTo(tx2, barY + len); ctx.stroke();
        }
        ctx.restore();
    }

    // ── Notched box helper ────────────────────────────────────────────────────
    _drawNotchedBox(ctx, x, y, w, h, alpha) {
        const n = Math.min(w, h) * 0.12;
        ctx.save();
        ctx.fillStyle = 'rgba(0,30,60,0.45)';
        ctx.strokeStyle = this._C(alpha);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + n, y); ctx.lineTo(x + w - n, y);
        ctx.lineTo(x + w, y + n); ctx.lineTo(x + w, y + h - n);
        ctx.lineTo(x + w - n, y + h); ctx.lineTo(x + n, y + h);
        ctx.lineTo(x, y + h - n); ctx.lineTo(x, y + n);
        ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
    }

    // ── Glitch ────────────────────────────────────────────────────────────────
    _drawGlitch(ctx, left, top, bw, bh) {
        ctx.save();
        for (let i = 0; i < 3; i++) {
            const gy = top + Math.random() * bh;
            const gh = 1 + Math.random() * 4;
            ctx.drawImage(this._canvas, left, gy, bw, gh, left + (Math.random() - 0.5) * 10, gy, bw, gh);
        }
        ctx.fillStyle = `rgba(0,200,255,${(Math.random() * 0.05).toFixed(3)})`;
        ctx.fillRect(left, top, bw, bh);
        ctx.restore();
    }
}
