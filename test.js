
    // --- Data Configuration ---
    const LOGICAL_HEIGHT = 1200; 
    const DEATH_Y = 800;
    const VIEW_Y_MIN = -700;
    const VIEW_Y_MAX = 900;
    
    // 複雑な形状にした動物データ
    const ANIMAL_DATA = [
        { name: 'Goat', img: 'https://img.icons8.com/color/144/goat.png', w: 80, h: 80, mass: 1, vertices: [{x:-30,y:-20}, {x:-10,y:-40}, {x:20,y:-40}, {x:40,y:-10}, {x:40,y:20}, {x:25,y:40}, {x:-25,y:40}, {x:-40,y:10}] },
        { name: 'Turtle', img: 'https://img.icons8.com/color/144/turtle.png', w: 90, h: 50, mass: 0.8, vertices: [{x:-45,y:10}, {x:-30,y:-10}, {x:-15,y:-25}, {x:15,y:-25}, {x:30,y:-10}, {x:45,y:10}, {x:45,y:25}, {x:-45,y:25}] },
        { name: 'Tiger', img: 'https://img.icons8.com/color/144/tiger.png', w: 110, h: 70, mass: 1.2, vertices: [{x:-50,y:-10}, {x:-30,y:-35}, {x:30,y:-35}, {x:55,y:-10}, {x:55,y:20}, {x:40,y:35}, {x:-40,y:35}, {x:-55,y:10}] },
        { name: 'Zebra', img: 'https://img.icons8.com/color/144/zebra.png', w: 110, h: 90, mass: 1.1, vertices: [{x:-45,y:-20}, {x:-25,y:-45}, {x:25,y:-45}, {x:50,y:-10}, {x:55,y:25}, {x:35,y:45}, {x:-35,y:45}, {x:-55,y:20}] },
        { name: 'Camel', img: 'https://img.icons8.com/color/144/camel.png', w: 120, h: 100, mass: 1.3, vertices: [{x:-50,y:-10}, {x:-30,y:-50}, {x:-10,y:-20}, {x:10,y:-50}, {x:40,y:-20}, {x:60,y:10}, {x:50,y:50}, {x:30,y:50}, {x:10,y:20}, {x:-10,y:50}, {x:-30,y:50}, {x:-60,y:20}] },
        { name: 'Panda', img: 'https://img.icons8.com/color/144/panda.png', w: 90, h: 90, mass: 1.5, vertices: [{x:-30,y:-40}, {x:0,y:-45}, {x:30,y:-40}, {x:45,y:-10}, {x:45,y:20}, {x:30,y:45}, {x:-30,y:45}, {x:-45,y:20}, {x:-45,y:-10}] },
        { name: 'Rhino', img: 'https://img.icons8.com/color/144/rhinoceros.png', w: 120, h: 80, mass: 2.0, vertices: [{x:-60,y:10}, {x:-40,y:-20}, {x:-10,y:-30}, {x:30,y:-40}, {x:60,y:-10}, {x:60,y:30}, {x:40,y:40}, {x:-40,y:40}, {x:-60,y:30}] },
        { name: 'Hippo', img: 'https://img.icons8.com/color/144/hippopotamus.png', w: 110, h: 80, mass: 1.8, vertices: [{x:-50,y:0}, {x:-40,y:-30}, {x:10,y:-40}, {x:40,y:-30}, {x:55,y:0}, {x:55,y:30}, {x:40,y:40}, {x:-40,y:40}, {x:-55,y:20}] },
        { name: 'Elephant', img: 'https://img.icons8.com/color/144/elephant.png', w: 130, h: 100, mass: 2.5, vertices: [{x:-65,y:10}, {x:-40,y:-40}, {x:0,y:-50}, {x:40,y:-30}, {x:65,y:10}, {x:65,y:50}, {x:40,y:50}, {x:20,y:20}, {x:0,y:50}, {x:-20,y:50}, {x:-40,y:20}, {x:-65,y:40}] },
        { name: 'Giraffe', img: 'https://img.icons8.com/color/144/giraffe.png', w: 70, h: 160, mass: 1.2, vertices: [{x:-20,y:-80}, {x:10,y:-80}, {x:20,y:-60}, {x:0,y:-20}, {x:30,y:10}, {x:35,y:50}, {x:20,y:80}, {x:0,y:80}, {x:-10,y:30}, {x:-25,y:80}, {x:-35,y:80}, {x:-30,y:30}, {x:-20,y:0}] },
        { name: 'PolarBear', img: 'https://img.icons8.com/color/144/polar-bear.png', w: 120, h: 90, mass: 2.0, vertices: [{x:-50,y:-10}, {x:-30,y:-40}, {x:20,y:-45}, {x:50,y:-20}, {x:60,y:10}, {x:50,y:45}, {x:-40,y:45}, {x:-60,y:20}] },
        { name: 'Chick', img: 'https://img.icons8.com/color/144/chick.png', w: 30, h: 30, mass: 0.1, vertices: [{x:-10,y:-15}, {x:5,y:-15}, {x:15,y:-5}, {x:15,y:10}, {x:5,y:15}, {x:-10,y:15}, {x:-15,y:5}], rare: true }
    ];

    let preloadedImages = {};
    ANIMAL_DATA.forEach(a => { const img = new Image(); img.crossOrigin = "anonymous"; img.src = a.img; preloadedImages[a.name] = img; });

    // --- Matter.js Setup ---
    const { Engine, Render, Runner, Bodies, Composite, Body, Common, Vertices, Bounds, Mouse } = Matter;
    if (window.decomp) Common.setDecomp(window.decomp);

    const engine = Engine.create({ enableSleeping: true });
    engine.positionIterations = 16; 
    engine.velocityIterations = 16;
    const world = engine.world;
    
    const render = Render.create({
        element: document.getElementById('canvas-container'),
        engine: engine,
        options: { width: 1000, height: 1200, wireframes: false, background: 'transparent', hasBounds: true }
    });

    // Mouse tracker (完璧な座標マッピング)
    const matterMouse = Mouse.create(render.canvas);
    
    // 固定論理座標系 (X: -500〜500, Y: -500〜700) = 1000x1200
    Render.lookAt(render, { min: { x: -500, y: -500 }, max: { x: 500, y: 700 } });
    
    Render.run(render);
    const runner = Runner.create();
    Runner.run(runner, engine);

    const ground = Bodies.rectangle(0, 5000, 20000, 200, { isStatic: true, label: 'ground' });
    Composite.add(world, ground);

    // --- State Variables ---
    let platforms = [];
    let gameState = 'title'; // title, editing, rooms, lobby, playing
    let myRole = null;
    let currentTurnRole = null;
    let currentAnimal = null;
    let isDropping = false;
    let startPoint = null;
    let tempBody = null;
    let syncInterval = null;

    // --- Socket.IO Setup ---
    const socket = io('http://172.23.72.107:3008');

    socket.on('rooms_updated', () => {
        if(gameState === 'rooms') fetchRooms();
    });

    socket.on('game_started', (data) => {
        showScreen('playing');
        if (myRole === 'host') {
            currentTurnRole = 'host';
            updateStatusBar();
            spawnNextAnimal();
            startPhysicsSync();
        } else {
            currentTurnRole = 'host';
            updateStatusBar();
        }
    });

    // 高速・完全同期で相手の物理演算状態を受信
    socket.on('sync_state', (data) => {
        if (gameState !== 'playing' || myRole === currentTurnRole) return;
        
        // 自分のエンジンで計算させないために、送られてきた座標で強制上書き
        const bodies = Composite.allBodies(world);
        const animalBodies = bodies.filter(b => b.label === 'animal');
        
        // 簡単のため、IDを割り当てて同期するアプローチではなく
        // 受信した個数に合わせて盤面を完全に再構築するか、マッチングさせる
        // 今回は配列順序が同じであることを前提に強制同期する
        
        // もし数が違えば再構築
        if (animalBodies.length !== data.animals.length) {
            animalBodies.forEach(b => Composite.remove(world, b));
            data.animals.forEach(a => {
                const b = spawnAnimal(a.type, a.x, a.y, a.angle, true);
                if (b) {
                    Body.setStatic(b, true); // ゲスト側では全てStaticとして扱い、勝手に落ちないようにする
                }
            });
        } else {
            // 数が同じなら位置と角度だけ上書き
            for(let i=0; i<animalBodies.length; i++) {
                Body.setPosition(animalBodies[i], { x: data.animals[i].x, y: data.animals[i].y });
                Body.setAngle(animalBodies[i], data.animals[i].angle);
                Body.setStatic(animalBodies[i], true); // ゲスト側では常にStatic
            }
        }
    });

    socket.on('turn_passed', (data) => {
        if (gameState !== 'playing') return;
        currentTurnRole = data.nextTurn;
        updateStatusBar();
        
        // ターンが渡る前に盤面を確定
        syncStageState(data.stageData);

        if (myRole === currentTurnRole) {
            spawnNextAnimal();
            startPhysicsSync(); // 自分のターンになったので同期送信開始
        } else {
            stopPhysicsSync(); // 相手のターンなので送信停止
        }
    });

    socket.on('game_over', (data) => {
        if (gameState !== 'playing') return;
        stopPhysicsSync();
        const iWin = (data.loser !== socket.id);
        showResult(iWin);
    });

    socket.on('opponent_disconnected', () => {
        if (gameState === 'playing' || gameState === 'lobby') {
            alert('対戦相手が切断しました。タイトルに戻ります。');
            showScreen('title');
        }
    });

    // --- Core Functions ---

    function showScreen(screen) {
        gameState = screen;
        document.getElementById('title-screen').style.display = 'none';
        document.getElementById('editor-ui').style.display = 'none';
        document.getElementById('rooms-ui').style.display = 'none';
        document.getElementById('lobby-ui').style.display = 'none';
        document.getElementById('game-ui').style.display = 'none';
        document.getElementById('result-overlay').style.display = 'none';

        if (screen === 'title') {
            document.getElementById('title-screen').style.display = 'flex';
            clearPhysics();
            if(socket.currentRoom) socket.disconnect(); // 一度切断して再接続(初期化)
            socket.connect();
        } else if (screen === 'editor') {
            document.getElementById('editor-ui').style.display = 'flex';
            clearPhysics();
            createPlatform(0, 500, 300, 40);
        } else if (screen === 'rooms') {
            document.getElementById('rooms-ui').style.display = 'flex';
            fetchRooms();
        } else if (screen === 'lobby') {
            document.getElementById('lobby-ui').style.display = 'flex';
        } else if (screen === 'playing') {
            document.getElementById('game-ui').style.display = 'flex';
        }
    }

    function clearPhysics() {
        Composite.clear(world, false);
        Composite.add(world, ground);
        platforms = [];
        currentAnimal = null;
        isDropping = false;
        stopPhysicsSync();
    }

    function fetchRooms() {
        socket.emit('get_rooms', (availableRooms) => {
            const container = document.getElementById('room-list-container');
            container.innerHTML = '';
            if (availableRooms.length === 0) {
                container.innerHTML = '<div style="grid-column:1/3;padding:20px;color:#666;">募集中の部屋はありません</div>';
                return;
            }
            availableRooms.forEach(room => {
                const card = document.createElement('div');
                card.className = 'room-card';
                let thumbHtml = '<div class="room-thumbnail">';
                room.stageData.platforms.forEach(p => {
                    const tx = ((p.x + 500) / 1000) * 100;
                    const ty = ((p.y + 500) / 1500) * 60;
                    const tw = (p.w / 1000) * 100;
                    const th = Math.max((p.h / 1500) * 60, 2);
                    thumbHtml += `<div class="thumb-platform" style="left:${tx-tw/2}%; top:${ty-th/2}%; width:${tw}%; height:${th}px;"></div>`;
                });
                thumbHtml += '</div>';
                card.innerHTML = `${thumbHtml}<div>部屋に参加</div>`;
                card.onclick = () => {
                    socket.emit('join_room', room.roomId, (res) => {
                        if(res.success) {
                            myRole = 'guest';
                            clearPhysics();
                            syncStageState(res.stageData);
                            showScreen('lobby'); // すぐにgame_startedイベントが来るはず
                        } else {
                            alert(res.message);
                        }
                    });
                };
                container.appendChild(card);
            });
        });
    }

    function createPlatform(x, y, w, h) {
        const p = Bodies.rectangle(x, y, w, h, { isStatic: true, render: { fillStyle: '#556B2F' }, label: 'platform' });
        platforms.push({ x, y, w, h });
        Composite.add(world, p);
    }

    function spawnAnimal(type, x, y, angle, isStatic) {
        const data = ANIMAL_DATA[type];
        if (!data) return null;
        const img = preloadedImages[data.name];
        const hasImg = img && img.complete && img.naturalWidth !== 0;

        const animal = Bodies.fromVertices(x, y, [data.vertices], {
            isStatic: isStatic, friction: 0.5, restitution: 0.1, angle: angle,
            render: {
                sprite: hasImg ? { texture: data.img, xScale: data.w/144, yScale: data.h/144 } : null,
                fillStyle: hasImg ? null : '#ff00ff'
            },
            label: 'animal', animalType: type,
            isSensor: isStatic 
        });
        if (animal) Body.setMass(animal, data.mass);
        Composite.add(world, animal);
        return animal;
    }

    function syncStageState(stageData) {
        const bodies = Composite.allBodies(world);
        bodies.forEach(b => {
            if (b.label === 'animal' || b.label === 'platform') Composite.remove(world, b);
        });
        platforms = [];

        if (stageData) {
            if (stageData.platforms) {
                stageData.platforms.forEach(p => {
                    createPlatform(p.x, p.y, p.w, p.h);
                });
            }
            if (stageData.animals) {
                stageData.animals.forEach(a => {
                    const newAnimal = spawnAnimal(a.type, a.x, a.y, a.angle, false);
                    if (newAnimal) {
                        Body.setPosition(newAnimal, { x: a.x, y: a.y });
                        Body.setAngle(newAnimal, a.angle);
                        Body.setVelocity(newAnimal, {x:0, y:0});
                        Body.setAngularVelocity(newAnimal, 0);
                    }
                });
            }
        }
    }

    function spawnNextAnimal() {
        let type = Math.floor(Math.random() * (ANIMAL_DATA.length - 1));
        if (Math.random() < 0.05) type = ANIMAL_DATA.length - 1; // Chick
        currentAnimal = spawnAnimal(type, 0, -200, 0, true);
        isDropping = false;
    }

    function updateStatusBar() {
        const bar = document.getElementById('status-bar');
        if (myRole === currentTurnRole) {
            bar.textContent = 'あなたの番です';
            bar.className = 'my-turn';
        } else {
            bar.textContent = '相手の番です';
            bar.className = 'opponent-turn';
        }
    }

    // --- Physics Sync (Socket.io Emit) ---
    function startPhysicsSync() {
        if(syncInterval) clearInterval(syncInterval);
        syncInterval = setInterval(() => {
            if (gameState !== 'playing' || myRole !== currentTurnRole) {
                clearInterval(syncInterval); return;
            }
            const bodies = Composite.allBodies(world).filter(b => b.label === 'animal');
            const animalsData = bodies.map(b => ({
                type: b.animalType, x: b.position.x, y: b.position.y, angle: b.angle
            }));
            socket.emit('sync_state', { animals: animalsData });
        }, 1000 / 30); // 30fps で同期
    }

    function stopPhysicsSync() {
        if(syncInterval) clearInterval(syncInterval);
    }

    // --- Input Handling ---
    function getMousePos(e) {
        if (e && e.clientX !== undefined) {
            const rect = render.canvas.getBoundingClientRect();
            const scaleX = render.canvas.width / rect.width;
            const scaleY = render.canvas.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX - 500,
                y: (e.clientY - rect.top) * scaleY - 500
            };
        }
        return {
            x: matterMouse.position.x - 500,
            y: matterMouse.position.y - 500
        };
    }

    function handleInputStart(e) {
        if (e.target.tagName !== 'CANVAS') return;
        if (e.touches) {
            e.preventDefault();
            e.button = 0; 
            e.clientX = e.touches[0].clientX;
            e.clientY = e.touches[0].clientY;
        }
        if (gameState === 'editor') {
            if (e.button === 0) startPoint = getMousePos(e);
            else if (e.button === 2) {
                const pos = getMousePos(e);
                const p = Composite.allBodies(world).find(b => b.label === 'platform' && Bounds.contains(b.bounds, pos));
                if (p) { Composite.remove(world, p); platforms = platforms.filter(pl => pl.x !== p.position.x || pl.y !== p.position.y); }
            }
        } else if (gameState === 'playing' && currentAnimal && !isDropping && myRole === currentTurnRole) {
            if (e.button === 0) dropAnimal();
            else if (e.button === 2) Body.rotate(currentAnimal, Math.PI / 4);
        }
    }

    function handleInputMove(e) {
        if (e.target.tagName !== 'CANVAS') return;
        if (e.touches) {
            e.preventDefault();
            e.clientX = e.touches[0].clientX;
            e.clientY = e.touches[0].clientY;
        }
        if (gameState === 'editor' && startPoint) {
            if (tempBody) Composite.remove(world, tempBody);
            const pos = getMousePos(e);
            const w = Math.abs(pos.x - startPoint.x), h = Math.abs(pos.y - startPoint.y);
            tempBody = Bodies.rectangle((pos.x + startPoint.x)/2, (pos.y + startPoint.y)/2, Math.max(w,5), Math.max(h,5), { isStatic: true, render: { fillStyle: 'rgba(85,107,47,0.5)' } });
            Composite.add(world, tempBody);
        } else if (gameState === 'playing' && currentAnimal && !isDropping && myRole === currentTurnRole) {
            const pos = getMousePos();
            Body.setPosition(currentAnimal, { x: pos.x, y: pos.y });
        }
    }

    function handleInputEnd(e) {
        if (e.target && e.target.tagName !== 'CANVAS' && e.type !== 'touchend') return;
        if (gameState === 'editor' && e.button === 0 && startPoint) {
            const pos = getMousePos(e);
            if (tempBody) Composite.remove(world, tempBody);
            const w = Math.abs(pos.x - startPoint.x), h = Math.abs(pos.y - startPoint.y);
            if (w > 10 && h > 10) createPlatform((pos.x + startPoint.x)/2, (pos.y + startPoint.y)/2, w, h);
            startPoint = null; tempBody = null;
        }
    }

    window.addEventListener('mousedown', handleInputStart);
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('mouseup', handleInputEnd);
    window.addEventListener('touchstart', handleInputStart, { passive: false });
    window.addEventListener('touchmove', handleInputMove, { passive: false });
    window.addEventListener('touchend', handleInputEnd);
    
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    function dropAnimal() {
        if (!currentAnimal || isDropping) return;
        isDropping = true;
        currentAnimal.isSensor = false; 
        Body.setStatic(currentAnimal, false);
        const data = ANIMAL_DATA[currentAnimal.animalType];
        if (data) Body.setMass(currentAnimal, data.mass);
        
        let dropStartTime = Date.now();
        let ticksBelowThreshold = 0;
        
        const check = setInterval(() => {
            let anyFell = false;
            const bodies = Composite.allBodies(world).filter(b => b.label === 'animal');
            for(let i=0; i<bodies.length; i++) {
                if (bodies[i].position.y > DEATH_Y) {
                    anyFell = true; break;
                }
            }
            
            let isTimeout = (Date.now() - dropStartTime > 5000); 

            if (currentAnimal.speed < 0.5) {
                ticksBelowThreshold++;
            } else {
                ticksBelowThreshold = 0;
            }

            if (anyFell) { 
                clearInterval(check); socket.emit('game_over'); 
            } else if (isTimeout || (currentAnimal.isSleeping) || ticksBelowThreshold >= 5) {
                clearInterval(check); // ここで即座に解除しないと、500msの間に何度もキューに入ってしまう
                setTimeout(() => { 
                    let fellAfterWait = false;
                    const bds = Composite.allBodies(world).filter(b => b.label === 'animal');
                    for(let i=0; i<bds.length; i++) {
                        if (bds[i].position.y > DEATH_Y) {
                            fellAfterWait = true; break;
                        }
                    }

                    if (fellAfterWait) {
                        socket.emit('game_over');
                    } else { 
                        // 次のターンへ
                        const animalsData = Composite.allBodies(world).filter(b => b.label === 'animal').map(b => ({
                            type: b.animalType, x: b.position.x, y: b.position.y, angle: b.angle
                        }));
                        socket.emit('pass_turn', { stageData: { platforms: platforms, animals: animalsData } });
                        currentAnimal = null;
                    } 
                }, 500); 
            }
        }, 200);
    }

    function showResult(win) {
        const overlay = document.getElementById('result-overlay');
        const msg = document.getElementById('result-message');
        overlay.style.display = 'flex';
        msg.textContent = win ? 'YOU WIN!' : 'YOU LOSE...';
        msg.className = 'result-text ' + (win ? 'result-win' : 'result-lose');
    }

    // --- Buttons ---
    document.getElementById('btn-goto-host').onclick = () => showScreen('editor');
    document.getElementById('btn-goto-guest').onclick = () => showScreen('rooms');
    document.getElementById('btn-start-recruit').onclick = () => {
        myRole = 'host';
        socket.emit('create_room', { platforms: platforms }, () => {
            showScreen('lobby');
        });
    };
    document.getElementById('btn-clear-stage').onclick = () => { clearPhysics(); };
    document.getElementById('btn-cancel-editor').onclick = () => showScreen('title');
    document.getElementById('btn-refresh-rooms').onclick = fetchRooms;
    document.getElementById('btn-cancel-rooms').onclick = () => showScreen('title');
    document.getElementById('btn-cancel-lobby').onclick = () => {
        socket.disconnect(); // 部屋を消すために切断
        showScreen('title');
    };
    document.getElementById('btn-back-to-title').onclick = () => showScreen('title');

    // 初期化
    showScreen('title');
