const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(__dirname));

let rooms = {}; // { roomId: { host: socketId, guest: socketId, state: 'waiting'|'playing', stageData: {}, turn: 'host' } }

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Get rooms
    socket.on('get_rooms', (callback) => {
        const availableRooms = Object.keys(rooms)
            .filter(id => rooms[id].state === 'waiting')
            .map(id => ({ roomId: id, stageData: rooms[id].stageData }));
        callback(availableRooms);
    });

    // Create room (Host finishes editing stage)
    socket.on('create_room', (stageData, callback) => {
        // 既に部屋にいる場合はエラー
        if (socket.currentRoom && rooms[socket.currentRoom]) {
            callback({ error: 'Already in a room' });
            return;
        }
        
        // ユニークなroomIdを生成（衝突防止）
        let roomId;
        do {
            roomId = 'room_' + Math.random().toString(36).substr(2, 9);
        } while (rooms[roomId]);
        
        rooms[roomId] = { host: socket.id, guest: null, state: 'waiting', stageData: stageData, turn: 'host' };
        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.role = 'host';
        callback(roomId);
        
        io.emit('rooms_updated');
    });

    // Join room (Guest)
    socket.on('join_room', (roomId, callback) => {
        const room = rooms[roomId];
        if (room && room.state === 'waiting') {
            room.guest = socket.id;
            room.state = 'playing';
            socket.join(roomId);
            socket.currentRoom = roomId;
            socket.role = 'guest';
            callback({ success: true, stageData: room.stageData });
            
            // Notify host that guest joined and game started
            io.to(room.host).emit('game_started', { guestId: socket.id });
            // Notify guest
            socket.emit('game_started', { hostId: room.host });
            
            io.emit('rooms_updated');
        } else {
            callback({ success: false, message: 'Room not available' });
        }
    });

    // Sync physics state (High frequency)
    socket.on('sync_state', (data) => {
        const roomId = socket.currentRoom;
        if (roomId && rooms[roomId]) {
            // ペイロード検証
            if (!data || !Array.isArray(data.animals)) return;
            // Broadcast to everyone else in the room
            socket.to(roomId).emit('sync_state', data);
        }
    });

    // Pass turn
    socket.on('pass_turn', (data) => {
        const roomId = socket.currentRoom;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            // 現在のターンのプレイヤーのみがターンを渡せる
            if (socket.role !== room.turn) return;
            
            room.turn = (room.turn === 'host') ? 'guest' : 'host';
            // Send complete stable stage data to sync perfectly before new turn
            io.to(roomId).emit('turn_passed', { nextTurn: room.turn, stageData: data ? data.stageData : null });
        }
    });

    // Start Timer Sync
    socket.on('start_timer', () => {
        const roomId = socket.currentRoom;
        if (roomId && rooms[roomId]) {
            socket.to(roomId).emit('start_timer');
        }
    });

    // Game Over
    socket.on('game_over', (data) => {
        const roomId = socket.currentRoom;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            // 送信者が現在のターンのプレイヤーであること（不正防止）
            // どちらのプレイヤーが負けたかdata.loserで判定
            io.to(roomId).emit('game_over', { loser: data && data.loser ? data.loser : socket.id });
            delete rooms[roomId];
            io.emit('rooms_updated');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const roomId = socket.currentRoom;
        if (roomId && rooms[roomId]) {
            io.to(roomId).emit('opponent_disconnected');
            delete rooms[roomId];
            io.emit('rooms_updated');
        }
    });
});

const PORT = process.env.PORT || 3008;
server.listen(PORT, () => {
    console.log(`Socket.IO Server running on port ${PORT}`);
});
