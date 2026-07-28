const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. Serve static files (index.html, puzzles folder, CSS, JS, etc.)
app.use(express.static(__dirname));
app.use('/puzzles', express.static(path.join(__dirname, 'puzzles')));

// 2. Explicitly send index.html when opening http://localhost:3000/
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 3. Socket.io Game Logic
const activeRooms = {};

// Generate a room code that isn't already in use
function generateRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 6).toUpperCase();
  } while (activeRooms[code]);
  return code;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Host creates room with custom theme and dataset
  socket.on('createRoom', ({ theme, puzzles }) => {
    if (!Array.isArray(puzzles) || puzzles.length === 0) {
      socket.emit('errorMsg', 'Invalid puzzle data.');
      return;
    }

    const roomCode = generateRoomCode();
    socket.join(roomCode);

    activeRooms[roomCode] = {
      theme: theme,
      puzzles: puzzles,
      players: {
        [socket.id]: { score: 0, finished: false }
      }
    };

    socket.emit('roomCreated', { roomCode });
  });

  // Second player joins using code
  socket.on('joinRoom', ({ roomCode }) => {
    const room = activeRooms[roomCode];
    if (room && Object.keys(room.players).length < 2) {
      socket.join(roomCode);
      room.players[socket.id] = { score: 0, finished: false };

      // Notify both players to start match with the host's loaded puzzles
      io.to(roomCode).emit('gameStarted', {
        theme: room.theme,
        puzzles: room.puzzles
      });
    } else {
      socket.emit('errorMsg', 'Room not found or full!');
    }
  });

  // Track live score updates
  socket.on('updateScore', ({ roomCode, score }) => {
    const room = activeRooms[roomCode];
    if (room && room.players[socket.id]) {
      room.players[socket.id].score = score;
      socket.to(roomCode).emit('opponentScoreUpdated', { score });
    }
  });

  // Handle player match completion
  socket.on('playerFinished', ({ roomCode }) => {
    const room = activeRooms[roomCode];
    if (room && room.players[socket.id]) {
      room.players[socket.id].finished = true;

      // Check if all players in the room finished
      const allFinished = Object.values(room.players).every(p => p.finished);
      if (allFinished) {
        io.to(roomCode).emit('matchOver', { players: room.players });
        delete activeRooms[roomCode]; // Clean up finished room
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Find the room this socket belonged to, notify the opponent, and clean up
    for (const roomCode in activeRooms) {
      const room = activeRooms[roomCode];
      if (room.players[socket.id]) {
        delete room.players[socket.id];
        socket.to(roomCode).emit('opponentDisconnected');

        // Remove the room entirely if it's now empty
        if (Object.keys(room.players).length === 0) {
          delete activeRooms[roomCode];
        }
        break;
      }
    }
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Game running at http://localhost:${PORT}`);
});