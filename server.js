const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Define static files to serve
app.use(express.static(path.join(__dirname, 'public')));
app.use('/img', express.static(path.join(__dirname, 'img')));

let waitingPlayer = null;
let rooms = {};
let roomIdCounter = 0;

// Helper para generar códigos de sala (6 caracteres)
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log('Un usuario se conectó:', socket.id);
    io.emit('userCount', io.of("/").sockets.size);

    socket.on('requestUserCount', () => {
        io.emit('userCount', io.of("/").sockets.size);
    });

    // Función auxiliar para iniciar la partida
    const startGame = (roomId) => {
        const room = rooms[roomId];
        const player1 = io.sockets.sockets.get(room.players[0]);
        const player2 = io.sockets.sockets.get(room.players[1]);

        if (!player1 || !player2) return;

        const roles = ['zorro', 'gallina'];
        const p1Role = Math.random() < 0.5 ? 0 : 1;
        const p2Role = p1Role === 0 ? 1 : 0;

        player1.emit('gameStart', { role: roles[p1Role], roomId: roomId, turn: 'gallina' });
        player2.emit('gameStart', { role: roles[p2Role], roomId: roomId, turn: 'gallina' });

        console.log(`Partida iniciada en sala ${roomId}`);
    };

    // --- Matchmaking Events ---

    socket.on('findMatch', () => {
        // Limpiar waitingPlayer si está desconectado
        if (waitingPlayer && !waitingPlayer.connected) waitingPlayer = null;

        if (waitingPlayer) {
            const roomId = 'room_' + roomIdCounter++;
            const player1 = waitingPlayer;
            const player2 = socket;

            player1.join(roomId);
            player2.join(roomId);
            player1.roomId = roomId;
            player2.roomId = roomId;

            rooms[roomId] = { players: [player1.id, player2.id], turn: 'gallina', voiceReady: [] };
            waitingPlayer = null;
            startGame(roomId);
        } else {
            waitingPlayer = socket;
            socket.emit('waiting', 'Buscando oponente aleatorio...');
        }
    });

    socket.on('createPrivateRoom', () => {
        const roomId = generateRoomCode();
        socket.join(roomId);
        socket.roomId = roomId;
        rooms[roomId] = { players: [socket.id], turn: 'gallina', voiceReady: [], isPrivate: true };
        socket.emit('roomCreated', roomId);
    });

    socket.on('joinPrivateRoom', (roomId) => {
        const room = rooms[roomId];
        if (room && room.isPrivate && room.players.length < 2) {
            socket.join(roomId);
            socket.roomId = roomId;
            room.players.push(socket.id);
            startGame(roomId);
        } else {
            socket.emit('joinError', 'Sala no encontrada o llena.');
        }
    });

    // Handle moves
    socket.on('move', (data) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            // Validar que el turno recibido sea consistente (opcional pero recomendado)
            // Actualizar el turno en el servidor
            rooms[roomId].turn = data.turn;

            // Retransmitir el movimiento
            socket.to(roomId).emit('move', data);
        }
    });

    // Handle game win
    socket.on('gameOver', (data) => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            io.to(roomId).emit('gameOver', data);
        }
    });

    // Handle restart game
    socket.on('restartGame', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            rooms[roomId].turn = 'gallina';
            io.to(roomId).emit('restartGame');
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            socket.to(roomId).emit('playerDisconnected', 'El otro jugador se ha desconectado.');
            // Clear room
            delete rooms[roomId];
        } else if (waitingPlayer && waitingPlayer.id === socket.id) {
            waitingPlayer = null;
        }
        io.emit('userCount', io.of("/").sockets.size);
    });

    // --- WebRTC Voice Chat Signaling ---
    socket.on('voice-ready', () => {
        const roomId = socket.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            if (!room.voiceReady.includes(socket.id)) {
                room.voiceReady.push(socket.id);
            }

            // Si ambos jugadores están listos, indicar al primero (o Zorro) que inicie la oferta
            if (room.voiceReady.length === 2) {
                io.to(room.players[0]).emit('create-offer');
            }
        }
    });

    socket.on('voice-offer', (data) => {
        const roomId = socket.roomId;
        if (roomId) socket.to(roomId).emit('voice-offer', data);
    });

    socket.on('voice-answer', (data) => {
        const roomId = socket.roomId;
        if (roomId) socket.to(roomId).emit('voice-answer', data);
    });

    socket.on('voice-candidate', (data) => {
        const roomId = socket.roomId;
        if (roomId) socket.to(roomId).emit('voice-candidate', data);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Servidor escuchando en el puerto ${PORT}`);
});
