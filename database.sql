CREATE TABLE IF NOT EXISTS tower_battle_rooms (
    room_id INT AUTO_INCREMENT PRIMARY KEY,
    status ENUM('waiting', 'playing', 'finished') DEFAULT 'waiting',
    host_id VARCHAR(255) NOT NULL,
    player_2_id VARCHAR(255),
    stage_data TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tower_battle_moves (
    move_id INT AUTO_INCREMENT PRIMARY KEY,
    room_id INT NOT NULL,
    player_id VARCHAR(255) NOT NULL,
    animal_type INT NOT NULL,
    spawn_x FLOAT NOT NULL,
    spawn_rotation FLOAT NOT NULL,
    final_x FLOAT,
    final_y FLOAT,
    final_rotation FLOAT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (room_id)
);
