const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, "public")));

// Estado del mundo
const rooms = {
  lobby:    { name: "Lobby",      icon: "🏠", players: {} },
  arcade:   { name: "Arcade",     icon: "🕹️", players: {}, game: { pong: null } },
  study:    { name: "Estudio",    icon: "📚", players: {}, pomodoro: { running: false, seconds: 1500, interval: null } },
  relax:    { name: "Relajación", icon: "😌", players: {} },
};

const AVATARS = ["🐱","🐶","🦊","🐸","🐼","🦁","🐧","🐺"];
let avatarIdx = 0;

io.on("connection", (socket) => {
  let player = {
    id: socket.id,
    name: `Jugador${Math.floor(Math.random()*9000)+1000}`,
    avatar: AVATARS[avatarIdx++ % AVATARS.length],
    room: "lobby",
    x: 200 + Math.random() * 200,
    y: 200 + Math.random() * 100,
    color: `hsl(${Math.random()*360},70%,55%)`
  };

  // Unirse al lobby
  rooms.lobby.players[socket.id] = player;
  socket.join("lobby");
  socket.emit("init", { player, rooms: serializeRooms() });
  io.to("lobby").emit("room_update", { room: "lobby", players: Object.values(rooms.lobby.players) });

  // Avatar
  socket.on("update_avatar", (avatarData) => {
    player.avatarData = avatarData;
    io.to(player.room).emit("avatar_updated", { id: socket.id, avatarData });
  });

  // Cambiar nombre
  socket.on("set_name", (name) => {
    if (!name || name.length > 20) return;
    player.name = name.replace(/[<>]/g, "");
    updatePlayerInRoom();
  });

  // Moverse
  socket.on("move", ({ x, y }) => {
    player.x = Math.max(20, Math.min(760, x));
    player.y = Math.max(20, Math.min(380, y));
    updatePlayerInRoom();
  });

  // Cambiar de sala
  socket.on("join_room", (roomId) => {
    if (!rooms[roomId] || roomId === player.room) return;
    const oldRoom = player.room;

    // Sacar de sala vieja
    delete rooms[oldRoom].players[socket.id];
    socket.leave(oldRoom);
    // Notificar a TODOS (incluyendo el jugador) el conteo actualizado de la sala vieja
    io.emit("room_count", { room: oldRoom, count: Object.keys(rooms[oldRoom].players).length });
    io.to(oldRoom).emit("room_update", { room: oldRoom, players: Object.values(rooms[oldRoom].players) });

    // Entrar a sala nueva — mantener posición
    player.room = roomId;
    // Solo resetear posición si estaba fuera de los límites
    if(player.x < 20 || player.x > 780 || player.y < 20 || player.y > 430){
      player.x = 300 + Math.random() * 200;
      player.y = 150 + Math.random() * 150;
    }
    rooms[roomId].players[socket.id] = player;
    socket.join(roomId);
    socket.emit("room_joined", { room: roomId, players: Object.values(rooms[roomId].players) });
    io.to(roomId).emit("room_update", { room: roomId, players: Object.values(rooms[roomId].players) });
    io.emit("room_count", { room: roomId, count: Object.keys(rooms[roomId].players).length });

    // Al entrar al estudio: estado del pomodoro
    if (roomId === "study") {
      const p = rooms.study.pomodoro;
      socket.emit("pomodoro_state", { running: p.running, seconds: p.seconds });
    }
  });

  // Chat
  socket.on("chat", (msg) => {
    if (!msg || msg.length > 200) return;
    io.to(player.room).emit("chat", {
      from: player.name,
      avatar: player.avatar,
      text: msg.replace(/[<>]/g, ""),
      room: player.room,
      ts: Date.now()
    });
  });

  // Pong — input de paleta
  socket.on("pong_input", (data) => {
    socket.to("arcade").emit("pong_input", { ...data, id: socket.id });
  });

  // Pomodoro — toggle
  socket.on("pomodoro_toggle", () => {
    if (player.room !== "study") return;
    const p = rooms.study.pomodoro;
    if (p.running) {
      clearInterval(p.interval);
      p.running = false;
    } else {
      p.running = true;
      p.interval = setInterval(() => {
        p.seconds--;
        if (p.seconds <= 0) {
          p.seconds = 1500;
          p.running = false;
          clearInterval(p.interval);
          io.to("study").emit("pomodoro_done");
        }
        io.to("study").emit("pomodoro_state", { running: p.running, seconds: p.seconds });
      }, 1000);
    }
    io.to("study").emit("pomodoro_state", { running: p.running, seconds: p.seconds });
  });

  // Pomodoro — reset
  socket.on("pomodoro_reset", () => {
    if (player.room !== "study") return;
    const p = rooms.study.pomodoro;
    clearInterval(p.interval);
    p.running = false;
    p.seconds = 1500;
    io.to("study").emit("pomodoro_state", { running: false, seconds: 1500 });
  });

  socket.on("disconnect", () => {
    delete rooms[player.room].players[socket.id];
    io.to(player.room).emit("room_update", { room: player.room, players: Object.values(rooms[player.room].players) });
    io.emit("room_count", { room: player.room, count: Object.keys(rooms[player.room].players).length });
  });

  function updatePlayerInRoom() {
    rooms[player.room].players[socket.id] = player;
    io.to(player.room).emit("room_update", {
      room: player.room,
      players: Object.values(rooms[player.room].players)
    });
  }
});

function serializeRooms() {
  return Object.fromEntries(
    Object.entries(rooms).map(([id, r]) => [id, {
      id, name: r.name, icon: r.icon,
      count: Object.keys(r.players).length
    }])
  );
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));