const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

const rooms = {
  lobby:  { name: "Lobby",      icon: "🏠", players: {} },
  arcade: { name: "Arcade",     icon: "🕹️", players: {}, game: { pong: null } },
  study:  { name: "Estudio",    icon: "📚", players: {}, pomodoro: { running: false, seconds: 1500, interval: null } },
  relax:  { name: "Relajación", icon: "😌", players: {} },
};

const AVATARS = ["🐱","🐶","🦊","🐸","🐼","🦁","🐧","🐺"];
let avatarIdx = 0;

// 4 bancos en los cuadrantes verdes del lobby
const benches = {
  b1: { seats: [{x:130,y:115},{x:165,y:115},{x:200,y:115}], occupied: [null,null,null] },
  b2: { seats: [{x:600,y:115},{x:635,y:115},{x:670,y:115}], occupied: [null,null,null] },
  b3: { seats: [{x:130,y:335},{x:165,y:335},{x:200,y:335}], occupied: [null,null,null] },
  b4: { seats: [{x:600,y:335},{x:635,y:335},{x:670,y:335}], occupied: [null,null,null] },
};

function freeBenchSeats(playerId) {
  Object.values(benches).forEach(b => {
    b.occupied = b.occupied.map(o => o === playerId ? null : o);
  });
}

io.on("connection", (socket) => {
  let player = {
    id: socket.id,
    name: `Jugador${Math.floor(Math.random()*9000)+1000}`,
    avatar: AVATARS[avatarIdx++ % AVATARS.length],
    room: "lobby",
    x: 300 + Math.random() * 200,
    y: 150 + Math.random() * 150,
    color: `hsl(${Math.random()*360},70%,55%)`,
    sitting: false,
    avatarData: null,
  };

  rooms.lobby.players[socket.id] = player;
  socket.join("lobby");
  socket.emit("init", { player, rooms: serializeRooms() });
  socket.emit("bench_update", { benches: serializeBenches() });
  io.to("lobby").emit("room_update", { room: "lobby", players: Object.values(rooms.lobby.players) });

  // Nombre
  socket.on("set_name", (name) => {
    if (!name || name.length > 20) return;
    player.name = name.replace(/[<>]/g, "");
    updatePlayerInRoom();
  });

  // Avatar
  socket.on("update_avatar", (avatarData) => {
    player.avatarData = avatarData;
    io.to(player.room).emit("avatar_updated", { id: socket.id, avatarData });
  });

  // Moverse
  socket.on("move", ({ x, y }) => {
    player.x = Math.max(20, Math.min(780, x));
    player.y = Math.max(20, Math.min(430, y));
    updatePlayerInRoom();
  });

  // Cambiar sala
  socket.on("join_room", (roomId) => {
    if (!rooms[roomId] || roomId === player.room) return;
    const oldRoom = player.room;
    freeBenchSeats(socket.id);
    player.sitting = false;
    delete rooms[oldRoom].players[socket.id];
    socket.leave(oldRoom);
    io.emit("room_count", { room: oldRoom, count: Object.keys(rooms[oldRoom].players).length });
    io.to(oldRoom).emit("room_update", { room: oldRoom, players: Object.values(rooms[oldRoom].players) });
    if (oldRoom === "lobby") io.to("lobby").emit("bench_update", { benches: serializeBenches() });

    player.room = roomId;
    if (player.x < 20 || player.x > 780 || player.y < 20 || player.y > 430) {
      player.x = 300 + Math.random() * 200;
      player.y = 150 + Math.random() * 150;
    }
    rooms[roomId].players[socket.id] = player;
    socket.join(roomId);
    socket.emit("room_joined", { room: roomId, players: Object.values(rooms[roomId].players) });
    io.to(roomId).emit("room_update", { room: roomId, players: Object.values(rooms[roomId].players) });
    io.emit("room_count", { room: roomId, count: Object.keys(rooms[roomId].players).length });

    if (roomId === "study") {
      const p = rooms.study.pomodoro;
      socket.emit("pomodoro_state", { running: p.running, seconds: p.seconds });
    }
    if (roomId === "lobby") {
      socket.emit("bench_update", { benches: serializeBenches() });
    }
  });

  // Chat
  socket.on("chat", (msg) => {
    if (!msg || msg.length > 200) return;
    io.to(player.room).emit("chat", {
      from: player.name,
      text: msg.replace(/[<>]/g, ""),
      room: player.room,
      ts: Date.now()
    });
  });

  // Sentarse en banco — recibe coordenadas dinámicas del cliente
  socket.on("sit", ({ benchId, seatIdx, x, y }) => {
    const bench = benches[benchId];
    if (!bench || seatIdx < 0 || seatIdx > 2) return;
    if (bench.occupied[seatIdx] && bench.occupied[seatIdx] !== socket.id) return;
    freeBenchSeats(socket.id);
    bench.occupied[seatIdx] = socket.id;
    // Usar coords dinámicas si vienen, sino las del servidor
    player.x = x || bench.seats[seatIdx].x;
    player.y = y || bench.seats[seatIdx].y;
    player.sitting = true;
    updatePlayerInRoom();
    io.to("lobby").emit("bench_update", { benches: serializeBenches() });
    socket.emit("move_to", { x: player.x, y: player.y });
  });

  // Levantarse
  socket.on("stand", () => {
    freeBenchSeats(socket.id);
    player.sitting = false;
    updatePlayerInRoom();
    io.to("lobby").emit("bench_update", { benches: serializeBenches() });
  });

  // Emote
  socket.on("emote", (emote) => {
    const allowed = ["😊","😐","😢"];
    if(!allowed.includes(emote)) return;
    io.to(player.room).emit("emote", {id: socket.id, emote});
  });

  // Pong
  socket.on("pong_input", (data) => {
    socket.to("arcade").emit("pong_input", { ...data, id: socket.id });
  });

  // Ajedrez
  socket.on("chess_move", (data) => {
    socket.to("arcade").emit("chess_move", data);
  });

  // Pomodoro toggle
  socket.on("pomodoro_toggle", () => {
    if (player.room !== "study") return;
    const p = rooms.study.pomodoro;
    if (p.running) {
      clearInterval(p.interval); p.running = false;
    } else {
      p.running = true;
      p.interval = setInterval(() => {
        p.seconds--;
        if (p.seconds <= 0) {
          p.seconds = 1500; p.running = false;
          clearInterval(p.interval);
          io.to("study").emit("pomodoro_done");
        }
        io.to("study").emit("pomodoro_state", { running: p.running, seconds: p.seconds });
      }, 1000);
    }
    io.to("study").emit("pomodoro_state", { running: p.running, seconds: p.seconds });
  });

  // Pomodoro reset
  socket.on("pomodoro_reset", () => {
    if (player.room !== "study") return;
    const p = rooms.study.pomodoro;
    clearInterval(p.interval); p.running = false; p.seconds = 1500;
    io.to("study").emit("pomodoro_state", { running: false, seconds: 1500 });
  });

  // Disconnect
  socket.on("disconnect", () => {
    freeBenchSeats(socket.id);
    delete rooms[player.room].players[socket.id];
    io.to(player.room).emit("room_update", { room: player.room, players: Object.values(rooms[player.room].players) });
    io.emit("room_count", { room: player.room, count: Object.keys(rooms[player.room].players).length });
    if (player.room === "lobby") io.to("lobby").emit("bench_update", { benches: serializeBenches() });
  });

  function updatePlayerInRoom() {
    rooms[player.room].players[socket.id] = player;
    io.to(player.room).emit("room_update", {
      room: player.room,
      players: Object.values(rooms[player.room].players)
    });
  }
});

function serializeBenches() {
  return Object.fromEntries(
    Object.entries(benches).map(([id, b]) => [id, { seats: b.seats, occupied: b.occupied }])
  );
}

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