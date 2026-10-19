const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Round-4 fix #1 (HIGH): same-origin app, do not allow cross-origin socket connections.
const io = new Server(server, { cors: { origin: false } });

app.use(express.static(__dirname));

// ---- Round-4 fixes: config / constants ----
const MAX_TOWERS_PER_PLAYER = 5;          // #7 (MEDIUM)
const RECONNECT_GRACE_MS = 30000;         // #5 (HIGH): 30s to reconnect, then end game
const RATE_LIMIT_MAX = 10;                // #9 (MEDIUM): max game events per second per socket
const RATE_LIMIT_WINDOW_MS = 1000;
const SYNC_MAX_AHEAD = 300;               // #6 (HIGH): tolerate small network skew, beyond that = desync
const REJOIN_TOKEN_TTL_MS = 30000;        // S1 (HIGH): rejoin tokens expire after 30s (reissued on rejoin)
const REJOIN_RATE_MAX = 5;                // S1 (HIGH): max rejoin attempts per socket per window
const REJOIN_RATE_WINDOW_MS = 30000;
const ROOM_OP_RATE_MAX = 10;              // S3 (MEDIUM): max create/join/get_rooms per socket per window
const ROOM_OP_RATE_WINDOW_MS = 30000;
const SYNC_STALE_MS = 15000;              // H2 (HIGH): active player silent for 15s on their turn = game over

// rooms: { roomId: { host, guest, state: 'waiting'|'playing', turn: 'host'|'guest',
//   stageData, unitCounts: {host, guest}, scores, syncSeq: {host, guest}, disconnectedSince, endTimer,
//   rejoinTokens: {host: {hash, used, expiresAt}, guest: {...}}, lastSyncAt: {host, guest}, turnTimer } }
let rooms = {};

/** #S2 (MEDIUM): safe rooms lookup with own-property guard. */
function getRoom(roomId) {
    if (!roomId || typeof roomId !== 'string' || !Object.prototype.hasOwnProperty.call(rooms, roomId)) return null;
    return rooms[roomId];
}

/** #3 (HIGH): verify socket belongs to the room (sender validation). */
function roomOf(socket) {
    const roomId = socket.currentRoom;
    const room = roomId ? rooms[roomId] : null;
    if (!room) return null;
    if (room.host !== socket.id && room.guest !== socket.id) return null;
    return { roomId, room };
}

/** #2/#4 (HIGH): role of the given socket inside the room. */
function roleOf(socket, room) {
    if (room.host === socket.id) return 'host';
    if (room.guest === socket.id) return 'guest';
    return null;
}

/** #2/#4 (HIGH): server-side determination of the loser from server-side unit counts. */
function determineLoser(room) {
    const counts = room.unitCounts;
    const hostUnits = counts.host !== null && counts.host !== undefined ? counts.host : null;
    const guestUnits = counts.guest !== null && counts.guest !== undefined ? counts.guest : null;
    // Both known: the side with <= 0 units lost.
    if (hostUnits !== null && guestUnits !== null) {
        if (hostUnits <= 0 && guestUnits > 0) return 'host';
        if (guestUnits <= 0 && hostUnits > 0) return 'guest';
    }
    return null; // cannot determine from server state
}

/** #2/#4 (HIGH): handle game_over. Client claims "I lost" (self). Server must verify. */
function handleGameOver(socket, data) {
    const { roomId, room } = roomOf(socket);
    if (!room) return; // #3: not in the game

    if (room.state !== 'playing') return; // already ended
    const myRole = roleOf(socket, room);

    // Round-4 fix #2/#4: do NOT trust any client-supplied loserId.
    // The sender claims to be the loser (matches client which emits game_over on its own death).
    // Verify: server-side unit count for the sender must be <= 0.
    const myUnits = room.unitCounts[myRole];
    if (myUnits === null || myUnits === undefined || myUnits > 0) {
        console.warn(`[game_over] rejected: ${socket.id} (${myRole}) claims defeat but server unit count = ${myUnits}`);
        return; // ignore the event; the other client can report later
    }

    const loser = myRole; // verified loser
    const winner = loser === 'host' ? 'guest' : 'host';

    const scores = (data && data.scores && typeof data.scores === 'object') ? data.scores : room.scores;

    const payload = {
        loser,            // role ('host'|'guest'), decided server-side
        winner,           // role
        loserId: loser === 'host' ? room.host : room.guest,   // socket id for client compat
        winnerId: winner === 'host' ? room.host : room.guest,
        scores
    };
    io.to(roomId).emit('game_over', payload);
    cleanupRoom(roomId);
    io.emit('rooms_updated');
}

function cleanupRoom(roomId) {
    const room = getRoom(roomId);
    if (!room) return;
    if (room.endTimer) { clearTimeout(room.endTimer); room.endTimer = null; }
    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; } // M3/H2: clear server turn timer
    delete rooms[roomId];
}

/** #9 (MEDIUM): simple per-socket rate limiter. Returns true if allowed. */
function rateLimitAllowed(socket) {
    const now = Date.now();
    if (!socket._rateWindowStart) socket._rateWindowStart = now;
    if (!socket._rateCount) socket._rateCount = 0;
    if (now - socket._rateWindowStart >= RATE_LIMIT_WINDOW_MS) {
        socket._rateWindowStart = now;
        socket._rateCount = 0;
    }
    socket._rateCount++;
    if (socket._rateCount > RATE_LIMIT_MAX) {
        console.warn(`[rate-limit] dropped ${socket._rateEvent || 'event'} from ${socket.id} (${socket._rateCount - 1} over in window)`);
        return false;
    }
    return true;
}

/** S3 (MEDIUM): separate, stricter per-socket rate limiter for room-management
 *  events (create_room / join_room / rejoin / get_rooms). Returns true if allowed. */
function roomOpAllowed(socket) {
    const now = Date.now();
    if (now - (socket._roomOpStart || 0) >= ROOM_OP_RATE_WINDOW_MS) {
        socket._roomOpStart = now;
        socket._roomOpCount = 0;
    }
    socket._roomOpCount = (socket._roomOpCount || 0) + 1;
    if (socket._roomOpCount > ROOM_OP_RATE_MAX) {
        console.warn(`[rate-limit] room op ${socket._rateEvent || ''} from ${socket.id} exceeded ${ROOM_OP_RATE_MAX}/${ROOM_OP_RATE_WINDOW_MS}ms`);
        return false;
    }
    return true;
}

/** S1 (HIGH): generate a single-use, expiring rejoin token. Only its hash is
 *  stored on the room; the raw token is handed to the client once. */
function issueRejoinToken(room, role) {
    const token = crypto.randomBytes(16).toString('hex');
    const entry = (room.rejoinTokens && room.rejoinTokens[role]) || {};
    entry.hash = crypto.createHash('sha256').update(token).digest('hex');
    entry.used = false;
    entry.expiresAt = Date.now() + REJOIN_TOKEN_TTL_MS;
    if (!room.rejoinTokens) room.rejoinTokens = {};
    room.rejoinTokens[role] = entry;
    return token;
}

/** S1 (HIGH): verify a presented rejoin token against the stored hash.
 *  On success the token is marked used (single-use) and a fresh token is
 *  returned so the reconnected client keeps a valid single-use token. */
function verifyRejoinToken(room, role, token) {
    const entry = room.rejoinTokens && room.rejoinTokens[role];
    if (!entry) return null;
    if (entry.used) return null;                              // single-use: already consumed
    if (entry.expiresAt < Date.now()) return null;             // short expiry elapsed
    const h = crypto.createHash('sha256').update(token).digest('hex');
    if (h !== entry.hash) return null;                         // hash mismatch
    entry.used = true;
    return issueRejoinToken(room, role);                       // reissue a fresh single-use token
}

/** H2 (HIGH): dead-man's switch. If the active player stops sending sync_state
 *  for SYNC_STALE_MS *after having sent at least one sync*, the server ends the
 *  game. Only arms once the current turn's player has a sync baseline; calling it
 *  when there is no baseline (e.g. right after a turn flip) is a safe no-op. */
function scheduleTurnStaleCheck(roomId) {
    const room = getRoom(roomId);
    if (!room) return;
    const turnRole = room.turn;
    const lastSyncAt = room.lastSyncAt && room.lastSyncAt[turnRole] ? room.lastSyncAt[turnRole] : null;
    if (!lastSyncAt) return; // no sync baseline for this turn yet; do not arm
    const elapsed = Date.now() - lastSyncAt;
    if (elapsed >= SYNC_STALE_MS) {
        endGameForStaleSync(roomId, turnRole);
        return;
    }
    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
    room.turnTimer = setTimeout(() => endGameForStaleSync(roomId, turnRole), SYNC_STALE_MS - elapsed);
}

function endGameForStaleSync(roomId, turnRole) {
    const room = getRoom(roomId);
    if (!room || room.state !== 'playing') return;
    if (room.turn !== turnRole) return; // turn already changed; a new timer covers it
    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
    console.log(`[turn-stale] ${turnRole} stopped sending sync_state for ${SYNC_STALE_MS}ms on their turn; ending game in ${roomId}`);
    const winnerRole = turnRole === 'host' ? 'guest' : 'host';
    const winnerId = winnerRole === 'host' ? room.host : room.guest;
    if (winnerId && io.sockets.sockets.get(winnerId)) {
        io.to(roomId).emit('game_over', {
            loser: turnRole,
            winner: winnerRole,
            loserId: turnRole === 'host' ? room.host : room.guest,
            winnerId: winnerId,
            scores: room.scores,
            reason: 'turn_stale'
        });
    }
    cleanupRoom(roomId);
    io.emit('rooms_updated');
}

// Wrap a game event handler with: room check (#3) + rate limit (#9) + role capture.
function onGameEvent(eventName, handler) {
    return (socket, ...args) => {
        socket._rateEvent = eventName;
        if (!rateLimitAllowed(socket)) return; // #9: drop excess
        const { roomId, room } = roomOf(socket); // #3: sender must be in the game
        if (!room) {
            console.warn(`[auth] ${eventName}: ${socket.id} rejected, not in a game`);
            return;
        }
        // In the 'waiting' state the host is already "in the game" (e.g. editing preview),
        // but gameplay events only make sense once playing. sync_state is allowed in waiting
        // so the host can preview; everything else requires playing.
        if (room.state !== 'playing' && eventName !== 'sync_state') return;
        handler(socket, room, roomId, ...args);
    };
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    socket.currentRoom = null;
    socket.role = null;
    socket.playerToken = null;   // #8: stable identity across reconnects
    if (socket.data) socket.data.lastSyncAt = null; // H2: per-socket high-frequency last-sync marker

    // Get rooms (S3: rate-limited)
    socket.on('get_rooms', (callback) => {
        if (typeof callback !== 'function') return;
        socket._rateEvent = 'get_rooms';
        if (!roomOpAllowed(socket)) return; // S3
        const availableRooms = Object.keys(rooms)
            .filter(id => rooms[id] && rooms[id].state === 'waiting')
            .map(id => ({ roomId: id, stageData: rooms[id].stageData }));
        callback(availableRooms);
    });

    // Create room (Host finishes editing stage) (S3: rate-limited)
    socket.on('create_room', (stageData, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        socket._rateEvent = 'create_room';
        if (!roomOpAllowed(socket)) { callback({ error: 'Rate limited' }); return; } // S3
        // 既に部屋にいる場合はエラー
        if (socket.currentRoom && rooms[socket.currentRoom]) {
            callback({ error: 'Already in a room' });
            return;
        }

        // stageData の基本検証（不正payloadでクラッシュさせない）
        if (!stageData || typeof stageData !== 'object' || !Array.isArray(stageData.platforms)) {
            callback({ error: 'Invalid stageData' });
            return;
        }
        // プラットフォーム上限（DoS防止、サーバー側の上限）
        if (stageData.platforms.length > 200) {
            callback({ error: 'Too many platforms' });
            return;
        }

        // ユニークなroomIdを生成（衝突防止）
        // L1: use crypto.randomBytes(8) hex for room IDs (unpredictable).
        let roomId;
        do {
            roomId = 'room_' + crypto.randomBytes(8).toString('hex');
        } while (rooms[roomId]);

        rooms[roomId] = {
            host: socket.id, guest: null, state: 'waiting',
            stageData: stageData, turn: 'host',
            unitCounts: { host: null, guest: null },
            scores: { host: null, guest: null },
            syncSeq: { host: 0, guest: 0 },
            disconnectedSince: null, endTimer: null,
            towers: { host: 0, guest: 0 },               // H2: server-owned tower counts
            lastSyncAt: { host: null, guest: null },     // H2: dead-man's switch
            turnTimer: null,                             // M3: server-owned turn timer
            rejoinTokens: {}                             // S1: single-use rejoin token hashes
        };
        // S1: hand the client a single-use, expiring rejoin token (hash stored on the room).
        const hostToken = issueRejoinToken(rooms[roomId], 'host');
        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.role = 'host';
        callback({ roomId, token: hostToken });

        io.emit('rooms_updated');
    });

    // Join room (Guest) (S3: rate-limited)
    socket.on('join_room', (roomId, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        socket._rateEvent = 'join_room';
        if (!roomOpAllowed(socket)) { callback({ success: false, message: 'Rate limited' }); return; } // S3
        const room = rooms[roomId];
        if (room && room.state === 'waiting') {
            room.guest = socket.id;
            room.state = 'playing';
            // ターン開始時にホストのユニット数は未知（null）。両者は対戦中。
            socket.join(roomId);
            socket.currentRoom = roomId;
            socket.role = 'guest';
            // S1: single-use, expiring rejoin token (hash stored on the room).
            const guestToken = issueRejoinToken(room, 'guest');
            callback({ success: true, stageData: room.stageData, token: guestToken });

            // Notify host that guest joined and game started
            io.to(room.host).emit('game_started', { guestId: socket.id });
            // Notify guest
            socket.emit('game_started', { hostId: room.host });

            io.emit('rooms_updated');
        } else {
            callback({ success: false, message: 'Room not available' });
        }
    });

    // #8 (MEDIUM): Rejoin after socket reconnect.
    // S1: token is single-use and short-expiring; only its SHA-256 hash is stored.
    // S3: rate-limited separately from gameplay events.
    // Client sends { token } where token was issued at create_room/join_room (or a rejoin).
    socket.on('rejoin', (data, callback) => {
        if (typeof callback !== 'function') callback = () => {};
        socket._rateEvent = 'rejoin';
        if (!roomOpAllowed(socket)) { callback({ success: false, message: 'Rate limited' }); return; } // S3
        if (!data || typeof data.token !== 'string' || !data.token) {
            callback({ success: false, message: 'Invalid token' });
            return;
        }
        // The token is a bare opaque string (S1); it no longer encodes roomId:role,
        // so the room is resolved by matching the token hash against stored entries.
        const token = data.token;
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        let roomId = null;
        let tokenRole = null;
        for (const id of Object.keys(rooms)) {
            const r = rooms[id];
            if (!r || !r.rejoinTokens) continue;
            if (r.rejoinTokens.host && r.rejoinTokens.host.hash === tokenHash) { roomId = id; tokenRole = 'host'; break; }
            if (r.rejoinTokens.guest && r.rejoinTokens.guest.hash === tokenHash) { roomId = id; tokenRole = 'guest'; break; }
        }
        if (!roomId || !tokenRole) { callback({ success: false, message: 'Room gone' }); return; }
        const room = getRoom(roomId);
        if (!room) { callback({ success: false, message: 'Room gone' }); return; }
        const otherRole = tokenRole === 'host' ? 'guest' : 'host';
        // S1: verify the token against the stored hash; single-use + short expiry enforced.
        const newToken = verifyRejoinToken(room, tokenRole, token);
        if (!newToken) {
            console.warn(`[rejoin] ${socket.id} presented invalid/used/expired token for ${tokenRole} in ${roomId}`);
            callback({ success: false, message: 'Invalid token' });
            return;
        }
        // Replace the stale (null) slot with the new socket id so subsequent events validate.
        room[tokenRole] = socket.id;
        // Stop any running grace timer (this player is back).
        if (room.endTimer) { clearTimeout(room.endTimer); room.endTimer = null; }
        // M6: simplified re-arming — if the *other* slot is absent, always scheduleGrace.
        const otherIdAfter = otherRole === 'host' ? room.host : room.guest;
        if (!otherIdAfter || !io.sockets.sockets.get(otherIdAfter)) {
            scheduleGrace(room, otherRole);
        } else {
            room.disconnectedSince = null;
        }
        // Leave any old room this socket was in (shouldn't normally be in one, but be safe).
        if (socket.currentRoom && socket.currentRoom !== roomId) {
            try { socket.leave(socket.currentRoom); } catch (e) {}
        }
        socket.join(roomId);
        socket.currentRoom = roomId;
        socket.role = tokenRole;

        // Restore state: stage data, unit counts, tower counts (M7), scores, current turn, sync seq.
        const payload = {
            success: true,
            stageData: room.stageData,
            turn: room.turn,
            unitCounts: room.unitCounts,
            towerCount: room.towers ? room.towers[tokenRole] : 0,  // M7: my tower count
            scores: room.scores,
            lastSyncSeq: room.syncSeq[tokenRole], // last seq the server accepted from this player
            opponentPresent: !!io.sockets.sockets.get(otherIdAfter),
            token: newToken   // S1: fresh single-use token for the next reconnect
        };
        callback(payload);
        // Tell the opponent the player is back.
        if (otherIdAfter && io.sockets.sockets.get(otherIdAfter)) {
            io.to(otherIdAfter).emit('opponent_reconnected', { role: tokenRole });
        }
        // M5: ask the active player to re-broadcast a full sync_state snapshot
        // so the returning player gets a fresh authoritative board.
        const activeId = room.turn === 'host' ? room.host : room.guest;
        if (activeId && io.sockets.sockets.get(activeId)) {
            io.to(activeId).emit('request_sync_snapshot', {});
        }
        // H2: reset the dead-man's-switch window for the returning player's next turn.
        room.lastSyncAt[tokenRole] = null;
        if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
        console.log(`[rejoin] ${socket.id} rejoined ${roomId} as ${tokenRole}`);
    });

    // Sync physics state (High frequency)
    // Round-4 fix #6 (HIGH): sequence number per player; reject out-of-order / duplicate indexes.
    // Round-4 fix #3 (HIGH): sender must be in the room.
    // Round-4 fix #9 (MEDIUM): rate-limited.
    socket.on('sync_state', onGameEvent('sync_state', (socket, room, roomId, data) => {
        // ペイロード検証
        if (!data || !Array.isArray(data.animals)) return;
        const myRole = roleOf(socket, room);
        // M2: only the active player (whose turn it is) may broadcast physics sync.
        if (myRole !== room.turn) return;
        // H2: dead-man's switch — record when the active player last synced.
        if (socket.data) socket.data.lastSyncAt = Date.now();
        if (!room.lastSyncAt) room.lastSyncAt = { host: null, guest: null };
        room.lastSyncAt[myRole] = Date.now();
        const seq = data.seq;
        // seq must be an integer. Tolerate up to SYNC_MAX_AHEAD ahead of the server's view,
        // reject anything older than what the server has already accepted (duplicate / out-of-order).
        if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
            // No seq: refuse to broadcast (anti-desync). The client will send seq from now on.
            return;
        }
        const last = room.syncSeq[myRole] || 0;
        if (seq <= last && seq <= last + SYNC_MAX_AHEAD) {
            // Out-of-order or duplicate: drop.
            return;
        }
        if (seq > last + SYNC_MAX_AHEAD) {
            // Jumped too far ahead (client restarted or desynced). Reset to accept it.
            room.syncSeq[myRole] = seq;
        } else {
            room.syncSeq[myRole] = seq;
        }
        // Broadcast to the other player with the sender's role attached.
        socket.to(roomId).emit('sync_state', Object.assign({}, data, { from: myRole }));
    }));

    // Pass turn
    // Round-4 fix #3: only the player whose turn it is (checked via socket id, not socket.role).
    socket.on('pass_turn', onGameEvent('pass_turn', (socket, room, roomId, data) => {
        const myRole = roleOf(socket, room);
        // 現在のターンのプレイヤーのみがターンを渡せる（socket.idで検証）
        if (myRole !== room.turn) return;

        room.turn = (room.turn === 'host') ? 'guest' : 'host';
        // Send complete stable stage data to sync perfectly before new turn
        io.to(roomId).emit('turn_passed', { nextTurn: room.turn, stageData: data && data.stageData ? data.stageData : null });
        // M3: the server now owns the turn timer — arm it for the new active player
        // so a stalled turn is detected and the game is ended server-side.
        scheduleTurnStaleCheck(roomId);
    }));

    // Start Timer Sync
    // Round-4 fix #3: sender must be in the room and it must be their turn.
    socket.on('start_timer', onGameEvent('start_timer', (socket, room, roomId, data) => {
        // ペイロード検証: 期待されたフィールドが存在しない場合は警告して無視
        if (!data || typeof data !== 'object' || !('duration' in data)) {
            console.warn('[start_timer] Invalid payload, ignoring:', data);
            return;
        }
        const myRole = roleOf(socket, room);
        if (myRole !== room.turn) return; // only the active player can start the timer
        // M3: server owns the turn timer. Flip the turn server-side after `duration`
        // seconds and broadcast turn_passed (with the stage data for the snapshot).
        const durationSec = Number.isFinite(data.duration) ? Math.max(0, data.duration) : 5;
        if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
        room.turnTimer = setTimeout(() => {
            const r = getRoom(roomId);
            if (!r || r.state !== 'playing') return;
            if (r.turnTimer) { clearTimeout(r.turnTimer); r.turnTimer = null; }
            const previousTurn = r.turn;
            r.turn = (r.turn === 'host') ? 'guest' : 'host';
            io.to(roomId).emit('turn_passed', { nextTurn: r.turn, stageData: null, from: previousTurn, timed: true });
            // H2: arm the dead-man's switch for the new active player.
            scheduleTurnStaleCheck(roomId);
        }, durationSec * 1000);
        // Also notify the opponent to show its local countdown (cosmetic).
        socket.to(roomId).emit('start_timer', data);
    }));

    // #7 (MEDIUM): place_tower — enforce max towers per player server-side.
    socket.on('place_tower', onGameEvent('place_tower', (socket, room, roomId, data) => {
        const myRole = roleOf(socket, room);
        if (!data || typeof data !== 'object') return;
        if (typeof data.tx !== 'number' || !Number.isFinite(data.tx)) return;
        if (typeof data.ty !== 'number' || !Number.isFinite(data.ty)) return;
        // H2: server-owned tower count (initialized at room creation, defensive here).
        if (!room.towers) room.towers = { host: 0, guest: 0 };
        if (room.towers[myRole] >= MAX_TOWERS_PER_PLAYER) {
            socket.emit('place_tower_rejected', { reason: 'max_towers' });
            return;
        }
        room.towers[myRole]++;
        room.towerData[myRole].push({ tx: data.tx, ty: data.ty });
        socket.to(roomId).emit('tower_placed', { role: myRole, tx: data.tx, ty: data.ty, count: room.towers[myRole] });
    }));

    // #3 (HIGH): move_unit — sender must be in the game and on their turn.
    socket.on('move_unit', onGameEvent('move_unit', (socket, room, roomId, data) => {
        const myRole = roleOf(socket, room);
        if (myRole !== room.turn) return;
        if (!data || typeof data !== 'object') return;
        if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
        socket.to(roomId).emit('unit_moved', { role: myRole, x: data.x, y: data.y });
    }));

    // #2/#4 (HIGH): game_over — server determines loser from its own unit counts.
    socket.on('game_over', (socket, data) => {
        if (!rateLimitAllowed(socket)) return; // #9
        handleGameOver(socket, data);
    });

    // #2/#4 (HIGH): unit_count — the client that detects its own death reports its (0) count.
    // The server uses this to know when a side has run out of units, so game_over can be verified.
    socket.on('unit_count', onGameEvent('unit_count', (socket, room, roomId, data) => {
        const myRole = roleOf(socket, room);
        if (!data || typeof data.count !== 'number' || !Number.isFinite(data.count) || data.count < 0) return;
        room.unitCounts[myRole] = data.count;
        // Server-side early termination: if both counts are known and one is 0,
        // end the game immediately without waiting for the losing client to report.
        const loser = determineLoser(room);
        if (loser) {
            const winner = loser === 'host' ? 'guest' : 'host';
            const payload = {
                loser, winner,
                loserId: loser === 'host' ? room.host : room.guest,
                winnerId: winner === 'host' ? room.host : room.guest,
                scores: room.scores
            };
            io.to(roomId).emit('game_over', payload);
            cleanupRoom(roomId);
            io.emit('rooms_updated');
        }
    }));

    // #5 (HIGH): disconnect handling — keep the room, mark disconnected, 30s grace, then end.
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const roomId = socket.currentRoom;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        const myRole = roleOf(socket, room);
        if (!myRole) return;

        // Capture the other socket id BEFORE nulling out this slot.
        const otherRole = myRole === 'host' ? 'guest' : 'host';
        const otherId = otherRole === 'host' ? room.host : room.guest;

        // #5: remove the stale socket id from room state so roomOf() rejects it.
        room[myRole] = null;
        // H2: the disconnected player can no longer sync; reset their dead-man's window
        // and cancel any pending turn timer for them.
        if (room.lastSyncAt) room.lastSyncAt[myRole] = null;
        if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }

        const otherPresent = otherId && io.sockets.sockets.get(otherId);

        // Tell the other player this one left.
        if (otherPresent) {
            io.to(otherId).emit('opponent_disconnected', { role: myRole });
        }

        // If the other player is also gone, end the game immediately (no one left to award to).
        if (!otherPresent) {
            cleanupRoom(roomId);
            io.emit('rooms_updated');
            return;
        }

        // Start (or keep) the 30s grace timer for this disconnected slot.
        scheduleGrace(room, myRole);
        console.log(`[disconnect] ${socket.id} (${myRole}) left ${roomId}; grace period started for ${otherRole}`);
    });
});

/** #5 helper: (re)arm the grace timer for a specific disconnected role. */
function scheduleGrace(room, role) {
    const roomId = Object.keys(rooms).find(id => rooms[id] === room);
    if (!roomId) return;
    // If the other slot is already gone, end the game immediately instead of waiting.
    const otherRole = role === 'host' ? 'guest' : 'host';
    const otherId = otherRole === 'host' ? room.host : room.guest;
    if (!otherId || !io.sockets.sockets.get(otherId)) {
        cleanupRoom(roomId);
        io.emit('rooms_updated');
        return;
    }
    if (room.endTimer) clearTimeout(room.endTimer);
    room.disconnectedSince = { role, at: Date.now() };
    room.endTimer = setTimeout(() => {
        const r = rooms[roomId];
        if (!r) return;
        // At the end of the grace period, if the disconnected slot has not reconnected,
        // award the win to the remaining player and end the game.
        const loserRole = r.disconnectedSince ? r.disconnectedSince.role : role;
        const winnerRole = loserRole === 'host' ? 'guest' : 'host';
        const winnerId = winnerRole === 'host' ? r.host : r.guest;
        const stillPresent = winnerId && io.sockets.sockets.get(winnerId);
        if (stillPresent) {
            const payload = {
                loser: loserRole,
                winner: winnerRole,
                loserId: loserRole === 'host' ? r.host : r.guest,
                winnerId: winnerId,
                scores: r.scores,
                reason: 'opponent_timeout'
            };
            io.to(roomId).emit('game_over', payload);
        }
        cleanupRoom(roomId);
        io.emit('rooms_updated');
    }, RECONNECT_GRACE_MS);
}

const PORT = process.env.PORT || 3008;
server.listen(PORT, () => {
    console.log(`Socket.IO Server running on port ${PORT}`);
});
