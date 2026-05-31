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