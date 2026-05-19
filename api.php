<?php
// TowerBattle/api.php
error_reporting(E_ALL);
ini_set('display_errors', 0);
header('Content-Type: application/json');

include 'db_connect.php';

$action = $_GET['action'] ?? '';

function sendError($message) {
    echo json_encode(['error' => $message]);
    exit;
}

try {
    if ($action === 'create_room') {
        $input = json_decode(file_get_contents('php://input'), true);
        $host_id = $input['host_id'] ?? null;
        $stage_data = json_encode(['platforms' => $input['stage_data'] ?? [], 'animals' => []]);

        if (!$host_id) sendError("Host ID is required");

        $stmt = $pdo->prepare("INSERT INTO tower_battle_rooms (host_id, stage_data, status) VALUES (?, ?, 'waiting')");
        $stmt->execute([$host_id, $stage_data]);

        echo json_encode(['success' => true, 'room_id' => $pdo->lastInsertId()]);
    }
    elseif ($action === 'get_rooms') {
        $stmt = $pdo->query("SELECT * FROM tower_battle_rooms WHERE status = 'waiting' ORDER BY room_id DESC LIMIT 20");
        echo json_encode(['rooms' => $stmt->fetchAll()]);
    }
    elseif ($action === 'join_room') {
        $input = json_decode(file_get_contents('php://input'), true);
        $room_id = $input['room_id'] ?? null;
        $player_id = $input['player_id'] ?? null;

        if (!$room_id || !$player_id) sendError("Invalid input");

        $stmt = $pdo->prepare("SELECT status FROM tower_battle_rooms WHERE room_id = ?");
        $stmt->execute([$room_id]);
        $room = $stmt->fetch();
        if (!$room || $room['status'] !== 'waiting') sendError("Room is not available");

        $stmt = $pdo->prepare("UPDATE tower_battle_rooms SET player_2_id = ?, status = 'playing' WHERE room_id = ? AND status = 'waiting'");
        $stmt->execute([$player_id, $room_id]);

        echo json_encode(['success' => true]);
    }
    elseif ($action === 'get_state') {
        $room_id = $_GET['room_id'] ?? null;
        if (!$room_id) sendError("Room ID is required");

        $stmt = $pdo->prepare("SELECT * FROM tower_battle_rooms WHERE room_id = ?");
        $stmt->execute([$room_id]);
        $room = $stmt->fetch();

        if (!$room) sendError("Room not found");

        $stmt = $pdo->prepare("SELECT * FROM tower_battle_moves WHERE room_id = ? ORDER BY move_id ASC");
        $stmt->execute([$room_id]);
        $moves = $stmt->fetchAll();

        echo json_encode([
            'status' => $room['status'],
            'player_1_id' => $room['host_id'],
            'player_2_id' => $room['player_2_id'],
            'stage_data' => json_decode($room['stage_data'] ?: '{"platforms":[],"animals":[]}', true),
            'moves' => $moves
        ]);
    }
    elseif ($action === 'place_move') {
        $input = json_decode(file_get_contents('php://input'), true);
        $room_id = $input['room_id'] ?? null;
        $player_id = $input['player_id'] ?? null;
        $animal_type = $input['animal_type'] ?? 0;
        $spawn_x = $input['spawn_x'] ?? 0;
        $spawn_rotation = $input['spawn_rotation'] ?? 0;
        $final_x = $input['final_x'] ?? 0;
        $final_y = $input['final_y'] ?? 0;
        $final_rotation = $input['final_rotation'] ?? 0;
        $is_loser = $input['is_loser'] ?? false;
        
        // 全動物の完全な状態を保存
        $full_stage_data = isset($input['stage_data']) ? json_encode($input['stage_data']) : null;

        if (!$room_id || !$player_id) sendError("Missing parameters");

        $stmt = $pdo->prepare("INSERT INTO tower_battle_moves (room_id, player_id, animal_type, spawn_x, spawn_rotation, final_x, final_y, final_rotation) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$room_id, $player_id, $animal_type, $spawn_x, $spawn_rotation, $final_x, $final_y, $final_rotation]);

        if ($full_stage_data) {
            $stmt = $pdo->prepare("UPDATE tower_battle_rooms SET stage_data = ? WHERE room_id = ?");
            $stmt->execute([$full_stage_data, $room_id]);
        }

        if ($is_loser) {
            $stmt = $pdo->prepare("UPDATE tower_battle_rooms SET status = 'finished' WHERE room_id = ?");
            $stmt->execute([$room_id]);
        }

        echo json_encode(['success' => true]);
    }
    else {
        sendError("Unknown action");
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
