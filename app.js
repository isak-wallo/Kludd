document.addEventListener('DOMContentLoaded', () => {
    const viewCanvas = document.getElementById('viewCanvas');
    const vCtx = viewCanvas.getContext('2d');

    const paper = document.createElement('canvas');
    paper.width = 900;
    paper.height = 1200;
    const pCtx = paper.getContext('2d', { willReadFrequently: true });
    const canvasContainer = document.getElementById('canvas-container');

    pCtx.fillStyle = '#ffffff';
    pCtx.fillRect(0, 0, paper.width, paper.height);

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentColor = '#000000';
    const lineWidth = 16;
    let clearState = 0;
    let clearTimer = null;
    const MAX_UNDO = 10;   // Hur många steg bakåt man kan ångra
    let undoStack = [];

    function resizeCanvas() {
        if (!canvasContainer) return;
        viewCanvas.width = canvasContainer.clientWidth;
        viewCanvas.height = canvasContainer.clientHeight;
        render();
    }

    // Layoutlås
    let lockedW = 0, lockedH = 0;
    let lockLandscape = null;

    function applyLayout() {
        const isLandscape = window.innerWidth > window.innerHeight;
        const w = window.innerWidth;
        const h = window.innerHeight;

        if (lockLandscape === null || isLandscape !== lockLandscape) {
            lockLandscape = isLandscape;
            lockedW = w;
            lockedH = h;
        } else {
            if (w > lockedW) lockedW = w;
            if (h > lockedH) lockedH = h;
        }

        const app = document.getElementById('app');
        if (app) {
            app.style.width = lockedW + 'px';
            app.style.height = lockedH + 'px';
        }
        resizeCanvas();
    }

    function render() {
        const W = viewCanvas.width;
        const H = viewCanvas.height;
        if (W === 0 || H === 0) return;
        vCtx.clearRect(0, 0, W, H);
        vCtx.imageSmoothingEnabled = false;

        if (W < H) {
            vCtx.drawImage(paper, 0, 0, W, H);
        } else {
            vCtx.setTransform(0, -(H / paper.width), W / paper.height, 0, 0, H);
            vCtx.drawImage(paper, 0, 0);
            vCtx.setTransform(1, 0, 0, 1, 0, 0);
        }
    }

    let renderPending = false;
    let pendingPoints = [];

    function flushPendingStrokes() {
        const len = pendingPoints.length;
        if (len === 0) return;
        pCtx.beginPath();
        pCtx.strokeStyle = currentColor;
        pCtx.lineWidth = lineWidth;
        pCtx.lineCap = 'round';
        pCtx.lineJoin = 'round';
        pCtx.moveTo(lastX, lastY);
        for (let i = 0; i < len; i += 2) {
            pCtx.lineTo(pendingPoints[i], pendingPoints[i + 1]);
        }
        pCtx.stroke();
        lastX = pendingPoints[len - 2];
        lastY = pendingPoints[len - 1];
        pendingPoints.length = 0;
    }

    function scheduleRender() {
        if (!renderPending) {
            renderPending = true;
            requestAnimationFrame(() => {
                flushPendingStrokes();
                render();
                renderPending = false;
            });
        }
    }

    function getPaperCoordsXY(clientX, clientY) {
        const rect = viewCanvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;

        const W = viewCanvas.width;
        const H = viewCanvas.height;

        if (W < H) {
            return { x: (x / W) * paper.width, y: (y / H) * paper.height };
        } else {
            return { x: ((H - y) / H) * paper.width, y: (x / W) * paper.height };
        }
    }

    // --- Strökhantering (uppskjuten prick + vilofinger-skydd) ---
    // Ritar INTE en prick direkt vid touchstart. Ett finger som bara vilar
    // (ner och upp utan att rör sig, t.ex. vilande hand) ska inte lämna något
    // märke. Först när fingret rör sig mer än STROKE_COMMIT_THRESHOLD ritas
    // ett streck – starten täcks av rund lineCap så den ser ut som en prick.
    // En ren dutt (ett ensamt finger: ner + upp utan flytt) ger en prick vid
    // touchend. Om man lägger ett andra finger (t.ex. för att rita med det)
    // raderas det förra fingrets korta spår automatiskt – det var bara vilande.
    let activeTouchId = null;
    let strokeCommitted = false;      // har den aktiva touchen rört sig tillräckligt för att rita?
    let strokeUndoPushed = false;     // har undo sparats för aktuell strök?
    let strokeHadOther = false;       // fanns ett annat finger nere under denna touch?
    let strokeExtent = 0;             // max avstånd^2 från start (skärm-px) för aktuell strök
    let strokeStartX = 0, strokeStartY = 0;          // start på papperet
    let strokeStartClientX = 0, strokeStartClientY = 0; // start på skärmen

    // Hur många skärm-px ett finger måste flyttas för att börja rita (större
    // än ren darrning/jitter från ett vilande finger). Tunbar vid behov.
    const STROKE_COMMIT_THRESHOLD = 20;
    // Om ett finger rört sig mindre än så här många skärm-px när ett nytt finger
    // läggs till, räknas det som vilande och dess korta spår raderas.
    const REST_CANCEL_PX = 80;

    function ensureStrokeUndo() {
        if (!strokeUndoPushed) {
            pushUndo();
            strokeUndoPushed = true;
        }
    }

    // Raderar den aktiva ströken (återställer duken till läget före den) genom
    // att poppa det undo-state som sparades vid commit. Används när ett finger
    // som trampat igång visar sig vara vilande (nytt finger tillkom).
    function cancelActiveStroke() {
        pendingPoints.length = 0;
        if (strokeUndoPushed && undoStack.length > 0) {
            const img = undoStack.pop();
            pCtx.putImageData(img, 0, 0);
            render();
            updateUndoState();
        }
        strokeUndoPushed = false;
    }

    // Påbörjar en ny strök vid coords. Ritar inget ännu. Om ett annat finger
    // redan var aktivt sparas dess streck – alternativt raderas om det bara
    // rörde sig lite (vilade) – så inget streck/prick lämnas under vilofingret.
    function startStrokeAt(coords, hadOther, clientX, clientY) {
        if (hadOther) {
            if (strokeCommitted && strokeExtent < REST_CANCEL_PX * REST_CANCEL_PX) {
                cancelActiveStroke();   // förra fingret vilade -> radera kort spår
            } else {
                flushPendingStrokes();  // förra fingret ritade på riktigt -> spara
            }
        } else {
            flushPendingStrokes();
        }
        lastX = coords.x;
        lastY = coords.y;
        strokeStartX = coords.x;
        strokeStartY = coords.y;
        strokeStartClientX = clientX;
        strokeStartClientY = clientY;
        strokeCommitted = false;
        strokeUndoPushed = false;
        strokeHadOther = hadOther;
        strokeExtent = 0;
        pendingPoints.length = 0;
        isDrawing = true;
        resetClearButton();
    }

    // Buffrar punkten och schemalägger rendering nästa frame. Flyttningar
    // mindre än STROKE_COMMIT_THRESHOLD (jitter/vilo-darr) ignoreras.
    function extendStrokeTo(coords, clientX, clientY) {
        if (!isDrawing) return;
        const dx = clientX - strokeStartClientX;
        const dy = clientY - strokeStartClientY;
        const distSq = dx * dx + dy * dy;
        if (distSq > strokeExtent) strokeExtent = distSq;
        if (!strokeCommitted) {
            if (distSq < STROKE_COMMIT_THRESHOLD * STROKE_COMMIT_THRESHOLD) return;
            strokeCommitted = true;
            ensureStrokeUndo();
        }
        pendingPoints.push(coords.x, coords.y);
        scheduleRender();
    }

    // Avslutar den aktiva ströken. En ren dutt (ingen commit, ensamt finger)
    // ritar en prick vid startpunkten; ett vilande finger i multitouch ritar
    // ingenting (strokeHadOther true).
    function endStroke() {
        flushPendingStrokes();
        if (!strokeCommitted && !strokeHadOther) {
            ensureStrokeUndo();
            pCtx.beginPath();
            pCtx.fillStyle = currentColor;
            pCtx.arc(strokeStartX, strokeStartY, lineWidth / 2, 0, Math.PI * 2);
            pCtx.fill();
            render();
        }
        isDrawing = false;
    }

    // --- Mus (för test i webbläsare på dator) ---
    function onMouseDown(e) {
        startStrokeAt(getPaperCoordsXY(e.clientX, e.clientY), false, e.clientX, e.clientY);
    }
    function onMouseMove(e) {
        if (isDrawing) extendStrokeTo(getPaperCoordsXY(e.clientX, e.clientY), e.clientX, e.clientY);
    }
    function onMouseUp() {
        if (!isDrawing) return;
        endStroke();
    }

    // --- Touch med stöd för flera fingrar samtidigt ---
    function findTouch(touchList, id) {
        for (let i = 0; i < touchList.length; i++) {
            if (touchList[i].identifier === id) return touchList[i];
        }
        return null;
    }

    function onTouchStart(e) {
        if (e.cancelable) e.preventDefault();
        const t = e.changedTouches[e.changedTouches.length - 1];
        // Om ett finger redan är aktivt (vilande eller ritande) har den nya
        // touchen ett annat finger nere samtidigt -> ingen prick vid dutt.
        const hadOther = (activeTouchId !== null);
        activeTouchId = t.identifier;
        startStrokeAt(getPaperCoordsXY(t.clientX, t.clientY), hadOther, t.clientX, t.clientY);
    }

    function onTouchMove(e) {
        if (activeTouchId === null) return;
        const t = findTouch(e.changedTouches, activeTouchId);
        if (!t) return;
        if (e.cancelable) e.preventDefault();
        extendStrokeTo(getPaperCoordsXY(t.clientX, t.clientY), t.clientX, t.clientY);
    }

    function onTouchEnd(e) {
        if (activeTouchId === null) return;
        if (findTouch(e.changedTouches, activeTouchId)) {
            endStroke();
            activeTouchId = null;
        }
    }

    function selectColor(color, element) {
        currentColor = color;
        const boxes = document.querySelectorAll('.color-box');
        boxes.forEach(box => box.classList.remove('selected'));
        element.classList.add('selected');
        resetClearButton();
    }

    function handleClearClick() {
        const btn = document.getElementById('clear-btn');
        if (clearState === 0) {
            clearState = 1;
            btn.textContent = 'SÄKER?';
            btn.classList.add('confirm');
            clearTimer = setTimeout(resetClearButton, 5000);
        } else {
            pushUndo();
            pCtx.fillStyle = '#ffffff';
            pCtx.fillRect(0, 0, paper.width, paper.height);
            render();
            resetClearButton();
        }
    }

    function resetClearButton() {
        clearState = 0;
        if (clearTimer) {
            clearTimeout(clearTimer);
            clearTimer = null;
        }
        const btn = document.getElementById('clear-btn');
        if (btn) {
            btn.textContent = 'RENSA';
            btn.classList.remove('confirm');
        }
    }

    function pushUndo() {
        try {
            undoStack.push(pCtx.getImageData(0, 0, paper.width, paper.height));
            if (undoStack.length > MAX_UNDO) undoStack.shift();
        } catch (e) { /* ignorera om bilden inte kan läsas */ }
        updateUndoState();
    }

    function undo() {
        if (undoStack.length === 0) return;
        const img = undoStack.pop();
        pCtx.putImageData(img, 0, 0);
        render();
        resetClearButton();
        updateUndoState();
    }

    function updateUndoState() {
        const btn = document.getElementById('undo-btn');
        if (btn) btn.disabled = (undoStack.length === 0);
    }

    function isInstalledApp() {
        return window.matchMedia('(display-mode: standalone)').matches
            || window.navigator.standalone === true;
    }

    function startApp() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log(`Helskärm misslyckades: ${err.message}`);
            });
        }
        document.getElementById('start-overlay').style.display = 'none';
        setTimeout(applyLayout, 100);
    }

    // --- Händelsebindningar (tidigare inline i HTML) ---
    document.getElementById('start-btn').addEventListener('click', startApp);
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('clear-btn').addEventListener('click', handleClearClick);

    const colorBoxes = document.querySelectorAll('.color-box');
    colorBoxes.forEach(box => {
        // Click för mus, touchstart för multi-touch under ritning
        box.addEventListener('click', function() {
            const color = this.getAttribute('data-color');
            selectColor(color, this);
        });
        box.addEventListener('touchstart', function(e) {
            e.stopPropagation(); // Hindra canvas touch-hantering
            const color = this.getAttribute('data-color');
            selectColor(color, this);
        }, { passive: true });
    });

    // Systemknappar (undo, clear) - touchstart så de fungerar även när ett
    // finger vilar på duken (click eldas inte vid multitouch på gamla Android).
    // preventDefault hindrar efterföljande click (dubbel avfyrning); click
    // finns kvar för mus/test på dator.
    const sysButtons = document.querySelectorAll('.sys-btn');
    sysButtons.forEach(btn => {
        btn.addEventListener('touchstart', function(e) {
            e.stopPropagation();
            if (this.id === 'undo-btn') undo();
            else if (this.id === 'clear-btn') handleClearClick();
            e.preventDefault();
        }, { passive: false });
    });

    // Back-button hantering: förhindra att man hamnar på "svart startsida"
    // Push state vid start så back-button stannar i appen
    history.pushState(null, '', location.href);
    window.addEventListener('popstate', (e) => {
        history.pushState(null, '', location.href);
        // Valfritt: visa start-overlay istället för att lämna appen
        // document.getElementById('start-overlay').style.display = 'flex';
    });

    // Lås orientering till porträtt (kräver fullscreen/standalone)
    if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock('portrait').catch(() => {});
    }

    document.addEventListener('fullscreenchange', () => {
        if (isInstalledApp()) return; // Installerad app: ingen startskärm
        if (!document.fullscreenElement) {
            document.getElementById('start-overlay').style.display = 'flex';
        } else {
            document.getElementById('start-overlay').style.display = 'none';
        }
        setTimeout(applyLayout, 100);
    });

    viewCanvas.addEventListener('mousedown', onMouseDown);
    viewCanvas.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    viewCanvas.addEventListener('touchstart', onTouchStart, { passive: false });
    viewCanvas.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    // Debounca layout-events så snabba resize/rotation-serier
    // bara triggar en enda omräkning per frame.
    let layoutPending = false;
    function debouncedLayout() {
        if (!layoutPending) {
            layoutPending = true;
            requestAnimationFrame(() => {
                applyLayout();
                layoutPending = false;
            });
        }
    }
    window.addEventListener('resize', debouncedLayout);
    window.addEventListener('orientationchange', debouncedLayout);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) resetClearButton();
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', debouncedLayout);
    }

    applyLayout();
    setTimeout(applyLayout, 50);

    // Registrera service worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').then(reg => {
            reg.addEventListener('updatefound', () => {
                const nw = reg.installing;
                if (!nw) return;
                nw.addEventListener('statechange', () => {
                    if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                        window.location.reload();
                    }
                });
            });
        }).catch(() => {});
    }
});
