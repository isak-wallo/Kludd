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
            vCtx.save();
            vCtx.translate(0, H);
            vCtx.rotate(-Math.PI / 2);
            vCtx.scale(H / paper.width, W / paper.height);
            vCtx.drawImage(paper, 0, 0);
            vCtx.restore();
        }
    }

    let renderPending = false;
    function scheduleRender() {
        if (!renderPending) {
            renderPending = true;
            requestAnimationFrame(() => {
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

    // Ritar startpunkten (en prick) och påbörjar ett nytt streck.
    function beginStrokeAt(coords) {
        isDrawing = true;
        pushUndo();
        lastX = coords.x;
        lastY = coords.y;

        pCtx.beginPath();
        pCtx.fillStyle = currentColor;
        pCtx.arc(lastX, lastY, lineWidth / 2, 0, Math.PI * 2);
        pCtx.fill();

        scheduleRender();
        resetClearButton();
    }

    // Drar strecket vidare till nästa punkt.
    function extendStrokeTo(coords) {
        if (!isDrawing) return;

        pCtx.beginPath();
        pCtx.strokeStyle = currentColor;
        pCtx.lineWidth = lineWidth;
        pCtx.lineCap = 'round';
        pCtx.lineJoin = 'round';
        pCtx.moveTo(lastX, lastY);
        pCtx.lineTo(coords.x, coords.y);
        pCtx.stroke();

        lastX = coords.x;
        lastY = coords.y;

        scheduleRender();
    }

    // --- Mus (för test i webbläsare på dator) ---
    function onMouseDown(e) {
        beginStrokeAt(getPaperCoordsXY(e.clientX, e.clientY));
    }
    function onMouseMove(e) {
        if (isDrawing) extendStrokeTo(getPaperCoordsXY(e.clientX, e.clientY));
    }
    function onMouseUp() {
        isDrawing = false;
    }

    // --- Touch med stöd för flera fingrar samtidigt ---
    let activeTouchId = null;

    function findTouch(touchList, id) {
        for (let i = 0; i < touchList.length; i++) {
            if (touchList[i].identifier === id) return touchList[i];
        }
        return null;
    }

    function onTouchStart(e) {
        if (e.cancelable) e.preventDefault();
        const t = e.changedTouches[e.changedTouches.length - 1];
        activeTouchId = t.identifier;
        beginStrokeAt(getPaperCoordsXY(t.clientX, t.clientY));
    }

    function onTouchMove(e) {
        if (activeTouchId === null) return;
        const t = findTouch(e.changedTouches, activeTouchId);
        if (!t) return;
        if (e.cancelable) e.preventDefault();
        extendStrokeTo(getPaperCoordsXY(t.clientX, t.clientY));
    }

    function onTouchEnd(e) {
        if (activeTouchId === null) return;
        if (findTouch(e.changedTouches, activeTouchId)) {
            activeTouchId = null;
            isDrawing = false;
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
        return window.matchMedia('(display-mode: fullscreen)').matches
            || window.matchMedia('(display-mode: standalone)').matches
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
        box.addEventListener('click', function() {
            const color = this.getAttribute('data-color');
            selectColor(color, this);
        });
    });

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
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    window.addEventListener('resize', applyLayout);
    window.addEventListener('orientationchange', applyLayout);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) resetClearButton();
    });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', applyLayout);
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
