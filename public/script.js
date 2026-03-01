const socket = io();

// UI Elements
const roleSpan = document.getElementById('player-role');
const turnSpan = document.getElementById('current-turn');
const scoreGallinasSpan = document.getElementById('score-gallinas');
const scoreZorrosSpan = document.getElementById('score-zorros');
const msgP = document.getElementById('game-message');
const boardLines = document.getElementById('board-lines');
const nodesContainer = document.getElementById('nodes-container');
const boardContainer = document.getElementById('board-container');
const piecesContainer = document.getElementById('pieces-container');
const btnRules = document.getElementById('btn-rules');
const btnCloseRules = document.getElementById('btn-close-rules');
const rulesModal = document.getElementById('rules-modal');
const btnShareQr = document.getElementById('btn-share-qr');
const qrContainer = document.getElementById('qr-code-container');
const btnRestart = document.getElementById('btn-restart');
const btnVoice = document.getElementById('btn-voice');
const remoteAudio = document.getElementById('remote-audio');
const voiceVisualizer = document.getElementById('voice-visualizer');
const connectionStatusSpan = document.getElementById('connection-status');
const userCountSpan = document.getElementById('user-count');
const splashScreen = document.getElementById('splash-screen');

// Menu Elements
const mainMenu = document.getElementById('main-menu');
const btnFindMatch = document.getElementById('btn-find-match');
const btnVsPC = document.getElementById('btn-vs-pc');
const difficultySelect = document.getElementById('difficulty-select');
const btnCreatePrivate = document.getElementById('btn-create-private');
const btnJoinPrivate = document.getElementById('btn-join-private');
const roomCodeInput = document.getElementById('room-code-input');
const waitingPrivateDiv = document.getElementById('waiting-private');
const displayCodeSpan = document.getElementById('display-code');
const btnShareWhatsapp = document.getElementById('btn-share-whatsapp');
const reactionBtns = document.querySelectorAll('.reaction-btn');

// PWA Elements
const installBanner = document.getElementById('install-banner');
const btnInstall = document.getElementById('btn-install');
const btnDismiss = document.getElementById('btn-dismiss');

btnRules.addEventListener('click', () => rulesModal.classList.remove('hidden'));
btnCloseRules.addEventListener('click', () => rulesModal.classList.add('hidden'));

if (btnShareQr) {
    btnShareQr.addEventListener('click', () => {
        // Si está vacío, generamos el QR
        if (qrContainer.innerHTML === '') {
            new QRCode(qrContainer, {
                text: "https://zorro-gallina.onrender.com/",
                width: 150,
                height: 150
            });
        }
        // Alternar visibilidad
        qrContainer.style.display = qrContainer.style.display === 'block' ? 'none' : 'block';
    });
}

// Game Config
const BOARD_SIZE = 7;
const NODE_SPACING = 100; // SVG viewBox coordinates
const INITIAL_GALLINAS = 20;
const INITIAL_ZORROS = 2;
let validNodes = new Set();
let gameState = {
    pieces: [], // { id, type: 'gallina'|'zorro', x, y }
    turn: 'gallina',
    forcedId: null // ID de la pieza que está obligada a seguir capturando
};
let myRole = null;
let selectedPiece = null;
let roomId = null;
let isSinglePlayer = false;
let aiDifficulty = 'hard';

// Voice Chat Variables
let localStream;
let peerConnection;
let isVoiceActive = false;
const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] // Servidor STUN público de Google
};
let audioContext;
let analyser;
let visualizerInterval;
let sfxAudioContext = null; // Contexto de audio separado para efectos de sonido

// PWA Install Prompt
let deferredPrompt;
let roomCreationTimeout; // Variable para el temporizador

// Initialize Board
function initBoard() {
    boardLines.innerHTML = '';
    nodesContainer.innerHTML = '';
    piecesContainer.innerHTML = '';
    validNodes.clear();

    const svgNs = "http://www.w3.org/2000/svg";

    // Define valid nodes (33 points)
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            // Remove corners
            if ((x < 2 || x > 4) && (y < 2 || y > 4)) continue;
            validNodes.add(`${x},${y}`);
        }
    }

    // Draw lines
    const linesToDraw = [];
    validNodes.forEach(pos => {
        const [x, y] = pos.split(',').map(Number);
        const hasDiagonals = (x + y) % 2 === 0;

        const neighbors = [
            [x + 1, y], [x, y + 1] // only look right and down to avoid duplicates
        ];

        if (hasDiagonals) {
            neighbors.push([x + 1, y + 1], [x - 1, y + 1]);
        }

        neighbors.forEach(([nx, ny]) => {
            if (validNodes.has(`${nx},${ny}`)) {
                const line = document.createElementNS(svgNs, 'line');
                line.setAttribute('x1', x * NODE_SPACING);
                line.setAttribute('y1', y * NODE_SPACING);
                line.setAttribute('x2', nx * NODE_SPACING);
                line.setAttribute('y2', ny * NODE_SPACING);
                boardLines.appendChild(line);
            }
        });

        // Draw node elements
        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'node';
        nodeDiv.style.left = `${(x / (BOARD_SIZE - 1)) * 100}%`;
        nodeDiv.style.top = `${(y / (BOARD_SIZE - 1)) * 100}%`;
        nodeDiv.dataset.x = x;
        nodeDiv.dataset.y = y;

        nodeDiv.addEventListener('click', () => onNodeClick(x, y));

        nodesContainer.appendChild(nodeDiv);
    });

    setupInitialPieces();
    renderPieces();
}

function setupInitialPieces() {
    gameState.pieces = [];
    let pieceId = 0;

    // 20 Gallinas
    validNodes.forEach(pos => {
        const [x, y] = pos.split(',').map(Number);
        if (y >= 3) {
            gameState.pieces.push({ id: `g${pieceId++}`, type: 'gallina', x, y });
        }
    });

    // 2 Zorros
    gameState.pieces.push({ id: 'z1', type: 'zorro', x: 2, y: 2 });
    gameState.pieces.push({ id: 'z2', type: 'zorro', x: 4, y: 2 });
}

function renderPieces(movedPieceId = null) {
    piecesContainer.innerHTML = '';
    gameState.pieces.forEach(p => {
        const pieceDiv = document.createElement('div');
        pieceDiv.className = `piece ${p.type}-piece`;
        pieceDiv.style.left = `${(p.x / (BOARD_SIZE - 1)) * 100}%`;
        pieceDiv.style.top = `${(p.y / (BOARD_SIZE - 1)) * 100}%`;
        pieceDiv.dataset.id = p.id;
        pieceDiv.textContent = p.type === 'gallina' ? '🐔' : '🦊';

        // Resaltar las piezas del bando que tiene el turno
        if (p.type === gameState.turn) {
            pieceDiv.classList.add('turn-active');
        }

        if (selectedPiece && selectedPiece.id === p.id) {
            pieceDiv.classList.add('selected');
        }

        if (p.id === movedPieceId) {
            pieceDiv.classList.add('bounce');
        }

        pieceDiv.addEventListener('click', (e) => onPieceClick(p, e));
        piecesContainer.appendChild(pieceDiv);
    });
}

// Logic Rules
function isValidMoveBasic(startX, startY, endX, endY) {
    if (!validNodes.has(`${endX},${endY}`)) return false;

    const dx = Math.abs(endX - startX);
    const dy = Math.abs(endY - startY);

    if (dx === 0 && dy === 0) return false;

    const hasDiagonals = (startX + startY) % 2 === 0;

    if (dx <= 1 && dy <= 1) {
        if (!hasDiagonals && dx === 1 && dy === 1) return false; // Not allowed to move diagonally if no lines
        return true;
    }
    return false;
}

function onPieceClick(piece, e) {
    e.stopPropagation();
    if (myRole !== gameState.turn && !isSinglePlayer) { // Permitir click si es single player y es mi turno (o turno de la IA si estamos debugeando, pero mejor restringir)
        showMessage('No es tu turno!', 'red');
        return;
    }
    if (piece.type !== myRole) {
        showMessage('Esa no es tu pieza!', 'red');
        return;
    }
    // En Single Player, bloquear si es turno de la PC
    if (isSinglePlayer && gameState.turn !== myRole) {
        return;
    }

    if (gameState.forcedId && gameState.forcedId !== piece.id) {
        showMessage('¡Debes continuar capturando con esta pieza!', 'red');
        return;
    }

    selectedPiece = piece;
    playSound('select');
    renderPieces();
}

function getPieceAt(x, y) {
    return gameState.pieces.find(p => p.x === x && p.y === y);
}

function onNodeClick(x, y) {
    if (!selectedPiece) return;
    // Validar turno (Multiplayer o SinglePlayer)
    if (!isSinglePlayer && myRole !== gameState.turn) return;
    if (isSinglePlayer && gameState.turn !== myRole) return;

    const startX = selectedPiece.x;
    const startY = selectedPiece.y;

    let isCapture = false;
    let capturedPieceId = null;
    let isValid = false;

    // Check if space is occupied
    if (getPieceAt(x, y)) return;

    if (myRole === 'gallina') {
        // Gallinas move 1 step. NO backward movement (y cannot increase if going towards y=0)
        // Wait, typical rules say they move forward, sideways, but not backward.
        if (y > startY) return; // Cannot move backward

        if (isValidMoveBasic(startX, startY, x, y)) {
            isValid = true;
        }
    } else if (myRole === 'zorro') {
        // Move 1 step
        if (isValidMoveBasic(startX, startY, x, y)) {
            isValid = true;
        } else {
            // Check capture (jump over)
            const dx = x - startX;
            const dy = y - startY;

            // Needs to be exactly 2 steps horizontally, vertically or diagonally
            if ((Math.abs(dx) === 2 && dy === 0) || (Math.abs(dy) === 2 && dx === 0) || (Math.abs(dx) === 2 && Math.abs(dy) === 2)) {
                const midX = startX + dx / 2;
                const midY = startY + dy / 2;

                // Needs grid line logic for the jump
                // FIX: Check both segments of the jump (Start->Mid AND Mid->End)
                if (isValidMoveBasic(startX, startY, midX, midY) && isValidMoveBasic(midX, midY, x, y)) {
                    const midPiece = getPieceAt(midX, midY);
                    if (midPiece && midPiece.type === 'gallina') {
                        isValid = true;
                        isCapture = true;
                        capturedPieceId = midPiece.id;
                    }
                }
            }
        }
    }

    if (isValid) {
        playSound('move');
        // Calculate new state
        const newPieces = gameState.pieces.filter(p => p.id !== capturedPieceId);
        const movedPieceIndex = newPieces.findIndex(p => p.id === selectedPiece.id);
        newPieces[movedPieceIndex].x = x;
        newPieces[movedPieceIndex].y = y;

        let nextTurn = gameState.turn === 'gallina' ? 'zorro' : 'gallina';
        let nextForcedId = null;

        // Lógica de Captura Múltiple para el Zorro
        if (myRole === 'zorro' && isCapture) {
            if (canZorroCaptureFrom(x, y)) {
                nextTurn = 'zorro'; // El turno sigue siendo del zorro
                nextForcedId = selectedPiece.id; // Obligar a usar la misma pieza
                showMessage('¡Sigue capturando!', '#39ff14');
            }
        }

        // Emit move
        if (isSinglePlayer) {
            // Movimiento local
        } else {
            socket.emit('move', { pieces: newPieces, turn: nextTurn, forcedId: nextForcedId });
        }

        const movedId = selectedPiece.id;
        // Apply locally
        gameState.pieces = newPieces;
        gameState.turn = nextTurn;
        gameState.forcedId = nextForcedId;

        // Si hay captura múltiple, mantenemos la selección actualizada
        if (nextForcedId) {
            selectedPiece.x = x;
            selectedPiece.y = y;
        } else {
            selectedPiece = null;
        }

        updateStatus();
        renderPieces(movedId);
        checkWinCondition();

        // Turno de la IA
        if (isSinglePlayer && gameState.turn !== 'finalizado' && gameState.turn !== myRole) {
            setTimeout(makeAIMove, 1000);
        }
    }
}

function canGallinasMove() {
    const gallinas = gameState.pieces.filter(p => p.type === 'gallina');
    for (const g of gallinas) {
        // Revisar vecinos (dx, dy entre -1 y 1)
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const tx = g.x + dx;
                const ty = g.y + dy;

                // Las gallinas no pueden moverse hacia atrás (y no puede aumentar)
                if (ty > g.y) continue;

                if (isValidMoveBasic(g.x, g.y, tx, ty)) {
                    if (!getPieceAt(tx, ty)) return true; // Hay al menos un movimiento válido
                }
            }
        }
    }
    return false;
}

function canZorroCaptureFrom(x, y) {
    const dirs = [
        [0, -1], [0, 1], [-1, 0], [1, 0], // Ortogonales
        [-1, -1], [1, -1], [-1, 1], [1, 1] // Diagonales
    ];

    for (const [dx, dy] of dirs) {
        const midX = x + dx;
        const midY = y + dy;
        const endX = x + dx * 2;
        const endY = y + dy * 2;

        // Verificar que el salto sea geométricamente válido (ambos pasos)
        if (isValidMoveBasic(x, y, midX, midY) && isValidMoveBasic(midX, midY, endX, endY)) {
            const midPiece = getPieceAt(midX, midY);
            const endPiece = getPieceAt(endX, endY);
            // Debe haber gallina en medio y destino vacío
            if (midPiece && midPiece.type === 'gallina' && !endPiece) {
                return true;
            }
        }
    }
    return false;
}

function canZorroMove() {
    const zorros = gameState.pieces.filter(p => p.type === 'zorro');
    // Direcciones posibles (ortogonales y diagonales)
    const dirs = [
        [0, -1], [0, 1], [-1, 0], [1, 0], // Ortogonales
        [-1, -1], [1, -1], [-1, 1], [1, 1] // Diagonales
    ];

    for (const zorro of zorros) {
        for (const [dx, dy] of dirs) {
            const tx = zorro.x + dx;
            const ty = zorro.y + dy;

            // 1. Verificar movimiento simple
            if (isValidMoveBasic(zorro.x, zorro.y, tx, ty)) {
                if (!getPieceAt(tx, ty)) return true; // Puede moverse a espacio vacío
            }

            // 2. Verificar salto (captura)
            const jx = zorro.x + dx * 2;
            const jy = zorro.y + dy * 2;

            if (isValidMoveBasic(zorro.x, zorro.y, tx, ty) && isValidMoveBasic(tx, ty, jx, jy)) {
                const midPiece = getPieceAt(tx, ty);
                const endPiece = getPieceAt(jx, jy);
                if (midPiece && midPiece.type === 'gallina' && !endPiece) return true; // Puede saltar
            }
        }
    }
    return false; // Ningún zorro puede moverse
}

function checkWinCondition() {
    const gallinas = gameState.pieces.filter(p => p.type === 'gallina');
    const zorros = gameState.pieces.filter(p => p.type === 'zorro');

    // Zorros win if logic (e.g., deleted >= 12, so only 8 left)
    if (gallinas.length <= 8) {
        // Alert removed to prevent blocking UI and double alerts
        handleGameOver('zorros');
        return;
    }

    // Gallinas ganan si llenan el gallinero (9 piezas en total), incluso con zorros dentro
    const piecesInGallinero = gameState.pieces.filter(p => p.x >= 2 && p.x <= 4 && p.y <= 2);
    if (piecesInGallinero.length === 9) {
        handleGameOver('gallinas');
        return;
    }

    // Zorros ganan si las Gallinas no tienen movimientos (Bloqueo)
    if (gameState.turn === 'gallina' && !canGallinasMove()) {
        handleGameOver('zorros');
        return;
    }

    // Gallinas ganan si los Zorros no pueden moverse (Ahogo)
    if (gameState.turn === 'zorro' && !canZorroMove()) {
        handleGameOver('gallinas', '¡Zorro Atrapado!');
        return;
    }
}

function handleGameOver(winner, customMsg = null) {
    if (isSinglePlayer) {
        msgP.textContent = customMsg ? `${customMsg} Ganaron: ${winner.toUpperCase()}` : `¡Partida finalizada! Ganaron: ${winner.toUpperCase()}`;
        gameState.turn = 'finalizado';
        updateStatus();
        triggerConfetti();
    } else {
        socket.emit('gameOver', { winner, customMsg });
    }
}

function showMessage(msg, color = 'white') {
    msgP.textContent = msg;
    msgP.style.color = color;
    setTimeout(() => { if (msgP.textContent === msg) msgP.textContent = ''; }, 3000);
}

function updateStatus() {
    roleSpan.textContent = myRole ? myRole.toUpperCase() : 'Esperando...';
    roleSpan.className = `badge ${myRole ? myRole + '-badge' : 'bg-secondary'}`;

    turnSpan.textContent = gameState.turn.toUpperCase();
    turnSpan.className = `badge ${gameState.turn + '-badge'}`;

    // Calcular capturas/bajas
    const currentGallinas = gameState.pieces.filter(p => p.type === 'gallina').length;
    const currentZorros = gameState.pieces.filter(p => p.type === 'zorro').length;

    // Mostrar cuántas han sido eliminadas (Iniciales - Actuales)
    scoreGallinasSpan.textContent = `🐔 -${INITIAL_GALLINAS - currentGallinas}`;
    scoreZorrosSpan.textContent = `🦊 -${INITIAL_ZORROS - currentZorros}`;

    // Actualizar estilo del tablero según el turno
    boardContainer.classList.remove('board-turn-zorro', 'board-turn-gallina');
    if (gameState.turn === 'zorro') {
        boardContainer.classList.add('board-turn-zorro');
    } else if (gameState.turn === 'gallina') {
        boardContainer.classList.add('board-turn-gallina');
    }
}

// --- Voice Chat Logic ---
btnVoice.addEventListener('click', toggleVoice);

btnRestart.addEventListener('click', () => {
    if (isSinglePlayer) {
        startSinglePlayerGame(); // Reiniciar localmente
    } else {
        showCustomConfirm('¿Seguro que quieres reiniciar la partida?', () => {
            socket.emit('restartGame');
        });
    }
});

async function toggleVoice() {
    if (isVoiceActive) {
        // Desconectar (Cortar llamada) y volver al estado original
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        if (visualizerInterval) {
            cancelAnimationFrame(visualizerInterval);
        }
        if (audioContext) {
            audioContext.suspend();
        }
        voiceVisualizer.classList.add('hidden');

        isVoiceActive = false;
        btnVoice.textContent = '🎤';
        btnVoice.classList.remove('active', 'muted');
    } else {
        // Connect logic
        // Verificar si el navegador soporta getUserMedia (suele fallar si no hay HTTPS)
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showCustomAlert('Error: El navegador ha bloqueado el micrófono. Esto suele pasar si no usas HTTPS. Si estás probando en red local, necesitas configurar el navegador o usar un túnel seguro.');
            return;
        }

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            isVoiceActive = true;
            btnVoice.textContent = '🎤';
            btnVoice.classList.add('active');

            // Notify server we are ready
            socket.emit('voice-ready');

            // Initialize AudioContext on user gesture
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
        } catch (err) {
            console.error('Error accessing microphone:', err);
            showCustomAlert('No se pudo acceder al micrófono. Asegúrate de dar permisos.');
        }
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    // Send ICE candidates to the other peer
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('voice-candidate', event.candidate);
        }
    };

    // Play remote audio stream
    peerConnection.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0];
        startVisualizer(event.streams[0]);
    };

    // Add local stream tracks to connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });
}

function startVisualizer(stream) {
    voiceVisualizer.classList.remove('hidden');

    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 32; // Pequeño tamaño para pocas barras
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const bars = voiceVisualizer.querySelectorAll('.bar');

    function draw() {
        visualizerInterval = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        // Actualizar altura de las barras (tenemos 4 barras)
        for (let i = 0; i < bars.length; i++) {
            // Tomamos muestras espaciadas
            const value = dataArray[i * 2];
            const height = Math.max(3, (value / 255) * 24); // Altura máxima 24px
            bars[i].style.height = `${height}px`;
        }
    }
    draw();
}

socket.on('create-offer', async () => {
    createPeerConnection();
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('voice-offer', offer);
    } catch (err) {
        console.error('Error creating offer:', err);
    }
});

socket.on('voice-offer', async (offer) => {
    if (!isVoiceActive) return;
    createPeerConnection();
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('voice-answer', answer);
});

socket.on('voice-answer', async (answer) => {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
});

socket.on('voice-candidate', async (candidate) => {
    if (peerConnection) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

socket.on('connect', () => {
    connectionStatusSpan.textContent = 'ONLINE';
    connectionStatusSpan.className = 'status-online';
    connectionStatusSpan.style.opacity = '1';
    socket.emit('requestUserCount');

    const p = splashScreen.querySelector('p');
    if (p) {
        p.textContent = 'Conectado al servidor';
        // Reiniciar animación de escritura
        p.classList.remove('typing-effect');
        void p.offsetWidth; // Forzar reflow
        p.classList.add('typing-effect');
    }

    // Ocultar splash screen cuando se conecta
    setTimeout(() => {
        splashScreen.classList.add('fade-out');
    }, 1000); // Pequeño delay para que se vea el logo

    // Si estábamos en partida, resetear porque el servidor limpia la sala al desconectar
    if (myRole) {
        myRole = null;
        roomId = null;
        gameState.pieces = [];
        updateStatus();
        initBoard(); // Limpiar tablero visualmente
        mainMenu.classList.remove('hidden');
        showCustomAlert('Se perdió la conexión. Volviendo al menú.');
    } else {
        mainMenu.classList.remove('hidden');
    }
});

socket.on('disconnect', () => {
    connectionStatusSpan.textContent = 'OFFLINE';
    connectionStatusSpan.className = 'status-offline';

    splashScreen.classList.remove('fade-out');
    const p = splashScreen.querySelector('p');
    if (p) {
        p.textContent = 'Conexión perdida. Reconectando...';
        p.classList.remove('typing-effect');
        void p.offsetWidth;
        p.classList.add('typing-effect');
    }
});

socket.on('connect_error', () => {
    const p = splashScreen.querySelector('p');
    if (p) p.textContent = 'Buscando servidor...';
    connectionStatusSpan.textContent = 'OFFLINE';
    connectionStatusSpan.className = 'status-offline';
});

socket.on('userCount', (count) => {
    console.log('Usuarios conectados:', count);
    if (userCountSpan) {
        userCountSpan.textContent = `Usuarios: ${count}`;
    }
});

// --- Menu Logic ---
btnFindMatch.addEventListener('click', () => {
    socket.emit('findMatch');
    isSinglePlayer = false;
    mainMenu.classList.add('hidden');
    msgP.textContent = 'Buscando oponente...';
});

btnCreatePrivate.addEventListener('click', () => {
    if (!socket.connected) {
        showCustomAlert('No hay conexión con el servidor.');
        return;
    }
    isSinglePlayer = false;
    socket.emit('createPrivateRoom');
    waitingPrivateDiv.classList.remove('hidden');
    // Ocultar botones para evitar múltiples clics
    btnCreatePrivate.style.display = 'none';

    // Deshabilitar botón de compartir hasta tener código
    btnShareWhatsapp.disabled = true;
    btnShareWhatsapp.textContent = 'Generando...';

    // Temporizador de seguridad: Si en 5 segundos no hay código, cancelar
    roomCreationTimeout = setTimeout(() => {
        if (btnShareWhatsapp.disabled) { // Si sigue deshabilitado (sin código)
            showCustomAlert('El servidor tardó en responder. Verifica tu conexión e inténtalo de nuevo.');
            waitingPrivateDiv.classList.add('hidden');
            btnCreatePrivate.style.display = ''; // Mostrar botón de nuevo
            btnShareWhatsapp.textContent = 'Compartir en WhatsApp'; // Resetear texto
        }
    }, 5000);
});

btnJoinPrivate.addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (code.length === 6) {
        isSinglePlayer = false;
        socket.emit('joinPrivateRoom', code);
    } else {
        showCustomAlert('El código debe tener 6 caracteres.');
    }
});

btnShareWhatsapp.addEventListener('click', () => {
    const code = displayCodeSpan.textContent;
    if (code && code !== '---') {
        const text = `¡Juega conmigo al Zorro y las Gallinas! Entra y usa este código para unirte: *${code}*`;
        const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
    }
});

// --- Single Player Logic (AI) ---
btnVsPC.addEventListener('click', startSinglePlayerGame);

function startSinglePlayerGame() {
    isSinglePlayer = true;
    mainMenu.classList.add('hidden');
    aiDifficulty = difficultySelect.value;

    // Asignar roles aleatorios o fijos. Vamos a poner al usuario como Gallina por defecto para empezar fácil.
    // O aleatorio:
    myRole = Math.random() < 0.5 ? 'gallina' : 'zorro';

    gameState.turn = 'gallina';
    gameState.forcedId = null;

    msgP.textContent = `Modo VS PC. Eres: ${myRole.toUpperCase()}`;
    msgP.style.color = '#4cc9f0';

    setupInitialPieces();
    updateStatus();
    renderPieces();

    // Si la PC es Gallina y empieza (Gallina siempre empieza), mover IA
    if (myRole === 'zorro') {
        setTimeout(makeAIMove, 1000);
    }
}

function makeAIMove() {
    if (gameState.turn === 'finalizado') return;

    const aiRole = myRole === 'gallina' ? 'zorro' : 'gallina';

    // Si hay captura múltiple obligatoria, solo usamos esa pieza
    let aiPieces = gameState.pieces.filter(p => p.type === aiRole);
    if (gameState.forcedId) {
        aiPieces = aiPieces.filter(p => p.id === gameState.forcedId);
    }

    let possibleMoves = [];

    // Calcular todos los movimientos posibles
    aiPieces.forEach(piece => {
        // Direcciones a probar
        const dirs = [
            [0, -1], [0, 1], [-1, 0], [1, 0],
            [-1, -1], [1, -1], [-1, 1], [1, 1]
        ];

        dirs.forEach(([dx, dy]) => {
            // Movimiento simple
            const tx = piece.x + dx;
            const ty = piece.y + dy;

            // Reglas específicas de movimiento
            let canMove = false;
            if (aiRole === 'gallina') {
                if (ty <= piece.y && isValidMoveBasic(piece.x, piece.y, tx, ty) && !getPieceAt(tx, ty)) {
                    canMove = true;
                }
            } else { // Zorro
                if (isValidMoveBasic(piece.x, piece.y, tx, ty) && !getPieceAt(tx, ty)) {
                    canMove = true;
                }
            }

            if (canMove) {
                // Si estamos en racha de capturas, no permitimos movimientos simples
                if (!gameState.forcedId) {
                    possibleMoves.push({ piece, x: tx, y: ty, isCapture: false });
                }
            }

            // Capturas (Solo Zorro)
            if (aiRole === 'zorro') {
                const jx = piece.x + dx * 2;
                const jy = piece.y + dy * 2;

                if (isValidMoveBasic(piece.x, piece.y, tx, ty) && isValidMoveBasic(tx, ty, jx, jy)) {
                    const midPiece = getPieceAt(tx, ty);
                    const endPiece = getPieceAt(jx, jy);
                    if (midPiece && midPiece.type === 'gallina' && !endPiece) {
                        possibleMoves.push({ piece, x: jx, y: jy, isCapture: true, capturedId: midPiece.id });
                    }
                }
            }
        });
    });

    if (possibleMoves.length === 0) {
        // No hay movimientos, probablemente fin del juego detectado en checkWinCondition
        return;
    }

    // IA Simple: Priorizar capturas, luego aleatorio
    let selectedMove = null;
    const captures = possibleMoves.filter(m => m.isCapture);

    if (captures.length > 0) {
        selectedMove = captures[Math.floor(Math.random() * captures.length)];
    } else {
        // Si es Fácil, movimiento aleatorio. Si es Difícil, usar heurística.
        if (aiDifficulty === 'easy') {
            selectedMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
        } else if (aiRole === 'gallina') {
            // Heurística Avanzada para Gallinas: Llenar el gallinero
            possibleMoves.forEach(m => {
                m.score = 0;
                // 1. Distancia al objetivo (Top Center: 3,0). Menor distancia = Mejor puntaje.
                const dist = Math.abs(m.x - 3) + m.y;
                m.score -= dist * 5;

                // 2. Bonificación por estar dentro del área ganadora (x:2-4, y:0-2)
                const inZone = (m.x >= 2 && m.x <= 4 && m.y <= 2);
                if (inZone) m.score += 30;

                // 3. Penalización fuerte por SALIR del área ganadora (¡No te salgas!)
                const wasInZone = (m.piece.x >= 2 && m.piece.x <= 4 && m.piece.y <= 2);
                if (wasInZone && !inZone) m.score -= 100;

                // 4. Factor aleatorio pequeño para variedad
                m.score += Math.random() * 3;
            });
            // Ordenar por mejor puntaje
            possibleMoves.sort((a, b) => b.score - a.score);
            selectedMove = possibleMoves[0];
        } else {
            // Zorro sin captura: Heurística defensiva (Movilidad + Centralidad)
            possibleMoves.forEach(m => {
                m.score = 0;

                // 1. Movilidad: Calcular a cuántas casillas podría moverse desde la nueva posición
                let mobility = 0;
                const dirs = [
                    [0, -1], [0, 1], [-1, 0], [1, 0],
                    [-1, -1], [1, -1], [-1, 1], [1, 1]
                ];

                dirs.forEach(([dx, dy]) => {
                    const nx = m.x + dx;
                    const ny = m.y + dy;
                    // Verificar si la línea existe en el tablero
                    if (isValidMoveBasic(m.x, m.y, nx, ny)) {
                        const p = getPieceAt(nx, ny);
                        // Es válido si está vacío O si es la posición de donde venimos (que quedará vacía)
                        if (!p || p.id === m.piece.id) {
                            mobility++;
                        }
                    }
                });
                m.score += mobility * 10; // Prioridad alta a no quedarse encerrado

                // 2. Centralidad: Preferir el centro del tablero (x=3, y=3 aprox)
                const distCenter = Math.abs(m.x - 3) + Math.abs(m.y - 3);
                m.score -= distCenter * 2;

                // 3. Penalización crítica por estar a punto de ser bloqueado
                if (mobility <= 1) m.score -= 50;

                // 4. Factor aleatorio para variedad
                m.score += Math.random() * 5;
            });

            // Ordenar por mejor puntaje
            possibleMoves.sort((a, b) => b.score - a.score);
            selectedMove = possibleMoves[0];
        }
    }

    // Ejecutar movimiento
    playSound('move');

    let newPieces = gameState.pieces.filter(p => p.id !== (selectedMove.capturedId || null));
    const movedPieceIndex = newPieces.findIndex(p => p.id === selectedMove.piece.id);
    newPieces[movedPieceIndex].x = selectedMove.x;
    newPieces[movedPieceIndex].y = selectedMove.y;

    gameState.pieces = newPieces;

    // Lógica de turno y captura múltiple para IA
    let nextTurn = myRole; // Por defecto devuelve el turno al humano
    let nextForcedId = null;

    if (aiRole === 'zorro' && selectedMove.isCapture) {
        // Verificar si puede seguir capturando desde la nueva posición
        if (canZorroCaptureFrom(selectedMove.x, selectedMove.y)) {
            nextTurn = aiRole; // La IA sigue jugando
            nextForcedId = selectedMove.piece.id;
            showMessage('¡La PC ataca de nuevo!', '#ff0054');
        }
    }

    gameState.turn = nextTurn;
    gameState.forcedId = nextForcedId;

    updateStatus();
    renderPieces(selectedMove.piece.id);
    checkWinCondition();

    // Si la IA sigue teniendo el turno, programar el siguiente movimiento
    if (nextTurn === aiRole && gameState.turn !== 'finalizado') {
        setTimeout(makeAIMove, 1000);
    }
}

socket.on('gameStart', (data) => {
    isSinglePlayer = false;
    mainMenu.classList.add('hidden'); // Asegurar que el menú se oculte
});

// Socket Events
socket.on('waiting', (msg) => {
    msgP.textContent = msg;
});

socket.on('roomCreated', (code) => {
    clearTimeout(roomCreationTimeout); // Cancelar el temporizador porque ya llegó el código
    displayCodeSpan.textContent = code;

    // Habilitar botón de compartir
    btnShareWhatsapp.disabled = false;
    btnShareWhatsapp.textContent = 'Compartir en WhatsApp';
});

socket.on('joinError', (msg) => {
    showCustomAlert(msg);
});

socket.on('gameStart', (data) => {
    mainMenu.classList.add('hidden'); // Asegurar que el menú se oculte
    myRole = data.role;
    roomId = data.roomId;
    gameState.turn = data.turn;
    gameState.forcedId = null;
    msgP.textContent = '¡Partida encontrada! Eres ' + myRole.toUpperCase();
    msgP.style.color = '#4cc9f0';
    setupInitialPieces();
    updateStatus();
    renderPieces();
});

socket.on('move', (data) => {
    // Detectar qué pieza se movió comparando con el estado anterior
    let movedId = null;
    data.pieces.forEach(newP => {
        const oldP = gameState.pieces.find(p => p.id === newP.id);
        if (oldP && (oldP.x !== newP.x || oldP.y !== newP.y)) {
            movedId = newP.id;
        }
    });

    gameState.pieces = data.pieces;
    gameState.turn = data.turn;
    gameState.forcedId = data.forcedId;

    if (myRole === gameState.turn && gameState.forcedId) {
        selectedPiece = gameState.pieces.find(p => p.id === gameState.forcedId);
        showMessage('¡Tienes capturas múltiples!', '#39ff14');
    } else {
        selectedPiece = null;
    }

    updateStatus();
    renderPieces(movedId);
});

socket.on('restartGame', () => {
    gameState.turn = 'gallina';
    gameState.forcedId = null;
    msgP.textContent = '¡Partida reiniciada! Turno de GALLINA';
    msgP.style.color = '#4cc9f0';
    setupInitialPieces();
    updateStatus();
    renderPieces();
});

socket.on('gameOver', (data) => {
    const winner = data.winner || data;
    const customMsg = data.customMsg;
    msgP.textContent = customMsg ? `${customMsg} Ganaron: ${winner.toUpperCase()}` : `¡Partida finalizada! Ganaron: ${winner.toUpperCase()}`;
    gameState.turn = 'finalizado'; // Stop further moves
    updateStatus();
    triggerConfetti();
});

socket.on('playerDisconnected', (msg) => {
    msgP.textContent = msg;
    msgP.style.color = 'red';
    myRole = null;
    updateStatus();
});

// --- Reactions Logic ---
reactionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const emoji = btn.textContent;
        showFloatingEmoji(emoji, false); // false = local (mi reacción)

        if (!isSinglePlayer) {
            socket.emit('reaction', { emoji });
        }
    });
});

socket.on('reaction', (data) => {
    showFloatingEmoji(data.emoji, true); // true = remote (reacción del oponente)
});

function showFloatingEmoji(emoji, isRemote) {
    const div = document.createElement('div');
    div.className = 'floating-emoji';
    div.textContent = emoji;

    const boardRect = boardContainer.getBoundingClientRect();

    // Posición horizontal centrada en el tablero
    div.style.left = (boardRect.left + boardRect.width / 2) + 'px';

    // Si es remoto (oponente), sale de arriba. Si es local (yo), sale de abajo.
    div.style.top = isRemote ? (boardRect.top + 50) + 'px' : (boardRect.bottom - 50) + 'px';

    document.body.appendChild(div);

    // Se elimina automáticamente al terminar la animación CSS, pero por seguridad:
    setTimeout(() => div.remove(), 2000);
}

// --- PWA Logic ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/service-worker.js')
            .then(reg => console.log('Service Worker registrado', reg))
            .catch(err => console.log('Error SW:', err));
    });
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Mostrar banner solo si no fue descartado previamente
    if (!localStorage.getItem('pwa-dismissed')) {
        installBanner.classList.remove('hidden');
    }
});

btnInstall.addEventListener('click', async () => {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            deferredPrompt = null;
        }
        installBanner.classList.add('hidden');
    }
});

btnDismiss.addEventListener('click', () => {
    installBanner.classList.add('hidden');
    localStorage.setItem('pwa-dismissed', 'true');
});

// --- Custom Modal Logic ---
function showCustomAlert(message) {
    const overlay = document.getElementById('custom-modal-overlay');
    overlay.innerHTML = '';
    overlay.classList.remove('hidden');

    const modal = document.createElement('div');
    modal.className = 'modal-content';
    modal.innerHTML = `
        <h2>Aviso</h2>
        <p>${message}</p>
        <div class="msg-box-buttons">
            <button id="msg-ok">Aceptar</button>
        </div>
    `;
    overlay.appendChild(modal);

    document.getElementById('msg-ok').addEventListener('click', () => {
        overlay.classList.add('hidden');
    });
}

function showCustomConfirm(message, onConfirm) {
    const overlay = document.getElementById('custom-modal-overlay');
    overlay.innerHTML = '';
    overlay.classList.remove('hidden');

    const modal = document.createElement('div');
    modal.className = 'modal-content';
    modal.innerHTML = `
        <h2>Confirmación</h2>
        <p>${message}</p>
        <div class="msg-box-buttons">
            <button id="msg-yes">Sí</button>
            <button id="msg-no" class="btn-secondary">No</button>
        </div>
    `;
    overlay.appendChild(modal);

    document.getElementById('msg-yes').addEventListener('click', () => {
        overlay.classList.add('hidden');
        if (onConfirm) onConfirm();
    });

    document.getElementById('msg-no').addEventListener('click', () => {
        overlay.classList.add('hidden');
    });
}

function triggerConfetti() {
    const duration = 3000;
    const end = Date.now() + duration;

    (function frame() {
        // Lanzar confeti desde la izquierda
        confetti({
            particleCount: 3,
            angle: 60,
            spread: 55,
            origin: { x: 0 },
            colors: ['#39ff14', '#4cc9f0', '#fca311', '#ff0054'] // Colores del tema neón
        });
        // Lanzar confeti desde la derecha
        confetti({
            particleCount: 3,
            angle: 120,
            spread: 55,
            origin: { x: 1 },
            colors: ['#39ff14', '#4cc9f0', '#fca311', '#ff0054']
        });

        if (Date.now() < end) {
            requestAnimationFrame(frame);
        }
    }());
}

// --- Sound Effects (Web Audio API) ---
function playSound(type) {
    if (!window.AudioContext && !window.webkitAudioContext) return;
    if (!sfxAudioContext) {
        sfxAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (sfxAudioContext.state === 'suspended') {
        sfxAudioContext.resume().catch(() => { });
    }

    const osc = sfxAudioContext.createOscillator();
    const gainNode = sfxAudioContext.createGain();

    osc.connect(gainNode);
    gainNode.connect(sfxAudioContext.destination);

    const now = sfxAudioContext.currentTime;

    if (type === 'select') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.exponentialRampToValueAtTime(1760, now + 0.05);
        gainNode.gain.setValueAtTime(0.05, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.05);
    } else if (type === 'move') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.15);
        gainNode.gain.setValueAtTime(0.05, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.start(now);
        osc.stop(now + 0.15);
    }
}

// Start
initBoard();
