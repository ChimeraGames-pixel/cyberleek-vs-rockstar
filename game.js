// Canvas Setup
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// Set virtual resolution
const V_WIDTH = 960;
const V_HEIGHT = 540;
canvas.width = V_WIDTH;
canvas.height = V_HEIGHT;

// Scaling to fit container
function resizeCanvas() {
    const container = document.getElementById("gameContainer");
    const rect = container.getBoundingClientRect();
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
}
window.addEventListener("resize", resizeCanvas);
window.addEventListener("load", resizeCanvas);
window.addEventListener("orientationchange", () => {
    setTimeout(resizeCanvas, 200);
});

// Image Loader Helper
const images = {};
function loadImage(key, src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            images[key] = img;
            resolve(img);
        };
        img.onerror = () => {
            console.error("Failed to load image: " + src);
            // Create fallback canvas image to prevent crash
            const fallback = document.createElement("canvas");
            fallback.width = 64;
            fallback.height = 64;
            const fctx = fallback.getContext("2d");
            fctx.fillStyle = "#ff00ff";
            fctx.fillRect(0, 0, 64, 64);
            images[key] = fallback;
            resolve(fallback);
        };
        // Add cache buster query parameter to force browser to load modified files from disk
        img.src = src + "?t=" + Date.now();
    });
}

// Game Settings & Constants
const GROUND_Y = 430; // Street level
const PLAYER_GROUND_Y = 475; // Middle of street for player & obstacles
const GRAVITY = 0.5; // Reduced from 0.8 to make jumps floatier (further horizontal distance)
const PLAYER_RUN_SPEED = 7;
const PARALLAX_BG_SPEED = 3;

// Game State
let gameState = "START"; // START, PLAYING, GAMEOVER
let score = 0; // Distance in meters
let totalTicks = 0;

// Entities
let player;
let catcher;
let streets = [];
let backgrounds = [];
let obstacles = [];
let collectibles = [];
let particles = [];

// Retro Web Audio Chase Music Player
class RetroMusicPlayer {
    constructor() {
        this.ctx = null;
        this.isPlaying = false;
        this.bgMusic = null;
    }

    init() {
        if (this.ctx) return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass();
    }

    start() {
        this.init();
        
        if (this.ctx && this.ctx.resume) {
            this.ctx.resume();
        }
        
        if (!this.bgMusic) {
            this.bgMusic = new Audio("Audio/apex_sprint.mp3");
            this.bgMusic.loop = true;
        }
        
        if (this.isPlaying) {
            // Already initialized, ensure it is playing if not already
            this.bgMusic.play().catch(e => console.log(e));
            return;
        }
        
        this.isPlaying = true;
        this.bgMusic.play().catch(e => {
            console.log("Audio play blocked, resetting isPlaying flag...", e);
            this.isPlaying = false; // Reset so next trigger can play it!
        });
    }

    stop() {
        this.isPlaying = false;
        if (this.bgMusic) {
            this.bgMusic.pause();
        }
    }

    playTone(freq, type, volume, startTime, duration) {
        if (!this.ctx) return;
        const schedTime = Math.max(startTime, this.ctx.currentTime);
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, schedTime);

        gain.gain.setValueAtTime(0, schedTime);
        gain.gain.linearRampToValueAtTime(volume, schedTime + 0.02);
        gain.gain.linearRampToValueAtTime(0.0001, schedTime + duration);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(schedTime);
        osc.stop(schedTime + duration);
    }

    playNoise(volume, startTime, duration) {
        if (!this.ctx) return;
        const schedTime = Math.max(startTime, this.ctx.currentTime);
        
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noiseNode = this.ctx.createBufferSource();
        noiseNode.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 10000;

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(volume, schedTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, schedTime + duration);

        noiseNode.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        noiseNode.start(schedTime);
        noiseNode.stop(schedTime + duration);
    }

    playJumpSound() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = "triangle";
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(600, now + 0.15);
        
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.15);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.15);
    }

    playFlipSound() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.25);
        
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.25);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.25);
    }

    playStepSound() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        
        osc.type = "sine";
        osc.frequency.setValueAtTime(80, now);
        
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.08);
        
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        
        osc.start(now);
        osc.stop(now + 0.08);
    }
}

const musicPlayer = new RetroMusicPlayer();

// Unblock audio context on any click/touch gesture
window.addEventListener("click", () => musicPlayer.init(), { once: true });
window.addEventListener("touchstart", () => musicPlayer.init(), { once: true });

// Preload assets
async function preload() {
    const loadPromises = [];

    // Player runner animation (6 frames)
    for (let i = 1; i <= 6; i++) {
        loadPromises.push(loadImage(`runner_${i}`, `textures/runner_0${i}.png`));
    }
    // Player jumper animation (5 frames, mapping around deleted/bad files)
    const jumperFiles = [
        "textures/jumper_01.png",
        "textures/jumper_02.png",
        "textures/jumper_03.png",
        "textures/jumper_04.png",
        "textures/jumper_06.png"
    ];
    for (let i = 0; i < jumperFiles.length; i++) {
        loadPromises.push(loadImage(`jumper_${i + 1}`, jumperFiles[i]));
    }
    // Player salto (flip) animation (8 frames)
    for (let i = 1; i <= 8; i++) {
        loadPromises.push(loadImage(`salto_${i}`, `textures/salto_0${i}.png`));
    }

    // Background Image
    loadPromises.push(loadImage("background_img", "assets/Background.jpg"));

    // Catcher logos
    loadPromises.push(loadImage("logo_microsoft", "textures/Catcher_Microsoft.png"));
    loadPromises.push(loadImage("logo_rockstar", "textures/Catcher_Rockstar.png"));
    loadPromises.push(loadImage("logo_fbi", "textures/Catcher_FBI.png"));

    // Streets
    loadPromises.push(loadImage("street_normal", "assets/Street normal.png"));
    loadPromises.push(loadImage("street_normal2", "assets/Street normal 2.png"));
    loadPromises.push(loadImage("street_zebra", "assets/Street zebra.png"));
    loadPromises.push(loadImage("street_water", "assets/Street water.png"));

    // Background Buildings & Trees
    loadPromises.push(loadImage("house_1", "assets/House 1.png"));
    loadPromises.push(loadImage("house_2", "assets/House 2.png"));
    loadPromises.push(loadImage("house_3", "assets/House 3.png"));
    loadPromises.push(loadImage("block_1", "assets/Block 1.png"));
    loadPromises.push(loadImage("block_2", "assets/Block 2.png"));
    loadPromises.push(loadImage("tree_big", "assets/Tree big.png"));
    loadPromises.push(loadImage("tree_small", "assets/Tree small.png"));

    // Obstacles (Cars & Street Barriers)
    loadPromises.push(loadImage("car_1", "assets/Car 1.png"));
    loadPromises.push(loadImage("car_2", "assets/Car 2.png"));
    loadPromises.push(loadImage("taxi", "assets/taxi.png"));
    loadPromises.push(loadImage("container", "assets/Container.png"));
    loadPromises.push(loadImage("street_bock", "assets/Street Bock.png"));

    await Promise.all(loadPromises);
    console.log("All assets loaded successfully!");
}

// Player Class
class Player {
    constructor() {
        this.x = 280;
        this.y = PLAYER_GROUND_Y;
        this.width = 112; // 75 * 1.5 (50% larger)
        this.height = 142; // 95 * 1.5 (50% larger)
        this.vy = 0;
        this.state = "RUNNING"; // RUNNING, JUMPING, FLIPPING
        this.frame = 1;
        this.frameTime = 0;
        this.jumpForce = -17; // Floatier jump height (with gravity = 0.5)
        this.flipForce = -19; // Floatier flip height (with gravity = 0.5)
    }

    jump() {
        if (this.state === "RUNNING") {
            this.state = "JUMPING";
            this.vy = this.jumpForce;
            this.frame = 1;
            this.frameTime = 0;
            spawnDustParticles(this.x + 20, this.y);
            musicPlayer.playJumpSound(); // Play jump sound effect!
        }
    }

    flip() {
        if (this.state === "RUNNING" || this.state === "JUMPING") {
            this.state = "FLIPPING";
            this.vy = this.flipForce;
            this.frame = 1;
            this.frameTime = 0;
            // Add purple ring particles for flip style
            for (let i = 0; i < 10; i++) {
                particles.push(new Particle(
                    this.x + this.width / 2,
                    this.y - this.height / 2,
                    (Math.random() - 0.5) * 6,
                    (Math.random() - 0.5) * 6,
                    "#ec4899",
                    Math.random() * 6 + 4
                ));
            }
            musicPlayer.playFlipSound(); // Play flip sound effect!
        }
    }

    update() {
        // Physics
        if (this.state !== "RUNNING" && this.state !== "LANDING") {
            this.vy += GRAVITY;
            this.y += this.vy;
            
            // Check ground collision
            const footY = this.y;
            if (footY >= PLAYER_GROUND_Y) {
                const lastState = this.state;
                this.y = PLAYER_GROUND_Y;
                this.vy = 0;
                this.state = "LANDING";
                this.frame = (lastState === "JUMPING") ? 5 : 8; // set landing dust frame
                this.frameTime = 0;
                spawnDustParticles(this.x + 20, this.y);
            }
        }

        // Animation cycling
        this.frameTime++;
        if (this.state === "RUNNING") {
            // Run has 6 frames
            if (this.frameTime > 4) {
                this.frame = (this.frame % 6) + 1;
                this.frameTime = 0;
                // Play footstep thump on frames 2 and 5
                if (this.frame === 2 || this.frame === 5) {
                    musicPlayer.playStepSound();
                }
            }
        } else if (this.state === "JUMPING") {
            // Jump has 5 frames, limit to frame 4 in the air (frame 5 has landing dust)
            if (this.frameTime > 5) {
                this.frame = Math.min(this.frame + 1, 4);
                this.frameTime = 0;
            }
        } else if (this.state === "FLIPPING") {
            // Salto has 8 frames, limit to frame 7 in the air (frame 8 has landing dust)
            if (this.frameTime > 3) {
                this.frame = Math.min(this.frame + 1, 7);
                this.frameTime = 0;
            }
        } else if (this.state === "LANDING") {
            // Display landing frame (5 or 8) for 6 ticks before returning to RUNNING
            if (this.frameTime > 6) {
                this.state = "RUNNING";
                this.frame = 1;
                this.frameTime = 0;
            }
        }
    }

    draw() {
        let key = "";
        if (this.state === "RUNNING") key = `runner_${this.frame}`;
        else if (this.state === "JUMPING") key = `jumper_${this.frame}`;
        else if (this.state === "FLIPPING") key = `salto_${this.frame}`;
        else if (this.state === "LANDING") {
            // Draw either jumper landing (frame 5) or salto landing (frame 8)
            key = (this.frame === 5) ? "jumper_5" : "salto_8";
        }

        const img = images[key];
        if (img) {
            let drawH = this.height; // Always keep height consistent (142px)
            const ratio = img.width / img.height;
            let drawW = drawH * ratio; // Dynamically scale width to match original image aspect ratio
            
            // Downscale salto_7 slightly to compensate for lack of empty padding in image
            if (key === "salto_7") {
                drawW *= 0.82;
                drawH *= 0.82;
            }

            // Center horizontally relative to player default width
            let drawX = this.x + (this.width - drawW) / 2;
            let drawY = this.y;

            // Draw character
            ctx.drawImage(img, drawX, drawY - drawH, drawW, drawH);
        }
    }

    getBounds() {
        // Return slightly inset bounding box for fair collision
        return {
            x: this.x + 22, // 15 * 1.5
            y: this.y - this.height + 15, // 10 * 1.5
            width: this.width - 44, // 30 * 1.5
            height: this.height - 22 // 15 * 1.5
        };
    }
}

// Catcher Class (Rockstar, Microsoft, FBI chasing)
class Catcher {
    constructor() {
        this.x = 20;
        this.y = PLAYER_GROUND_Y;
        this.width = 165; // 110 * 1.5
        this.height = 150; // 100 * 1.5
        this.vy = 0;
        this.state = "RUNNING"; // RUNNING, JUMPING
        this.logos = ["logo_microsoft", "logo_rockstar", "logo_fbi"];
        this.activeTime = 0;
        this.speed = 1.2;
    }

    update() {
        this.activeTime++;
        
        // Catcher slowly advances
        let targetX = player.x - 220; // Default chase position
        
        // Over time, catcher gets slightly closer
        const dangerMultiplier = Math.min(score / 800, 0.6);
        targetX += dangerMultiplier * 140;

        if (this.x < targetX) {
            this.x += this.speed;
        } else if (this.x > targetX + 10) {
            this.x -= 0.5; // slow back off
        }

        // Keep bounds
        if (this.x < 10) this.x = 10;

        // Auto jump over upcoming obstacles
        if (this.state === "RUNNING") {
            // Find closest obstacle ahead of catcher
            let closestObs = null;
            for (let obs of obstacles) {
                if (obs.x > this.x && obs.x < this.x + 180) {
                    closestObs = obs;
                    break;
                }
            }
            if (closestObs) {
                this.state = "JUMPING";
                this.vy = -15;
            }
        } else {
            this.vy += GRAVITY;
            this.y += this.vy;
            if (this.y >= PLAYER_GROUND_Y) {
                this.y = PLAYER_GROUND_Y;
                this.vy = 0;
                this.state = "RUNNING";
            }
        }
    }

    pushBack(amount) {
        this.x -= amount;
        if (this.x < 10) this.x = 10;
        
        // Spawn green blast effect particles
        for (let i = 0; i < 15; i++) {
            particles.push(new Particle(
                this.x + this.width / 2,
                this.y - this.height / 2,
                (Math.random() - 0.5) * 8 - 4,
                (Math.random() - 0.5) * 8,
                "#22d3ee",
                Math.random() * 8 + 4
            ));
        }
    }

    draw() {
        const logoSpacing = 35;
        // Float logos slightly
        const bounce = Math.sin(this.activeTime * 0.15) * 8;
        
        this.logos.forEach((logoKey, idx) => {
            const img = images[logoKey];
            if (img) {
                const logoSize = 48;
                const lx = this.x + idx * logoSpacing;
                // Stacked / Offset pattern
                const ly = this.y - 120 + bounce - (idx % 2 === 0 ? 10 : -10) + (this.y - PLAYER_GROUND_Y);
                
                ctx.save();
                // Add soft drop shadow
                ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
                ctx.shadowBlur = 8;
                ctx.drawImage(img, lx, ly, logoSize, logoSize);
                ctx.restore();
            }
        });
    }

    getBounds() {
        return {
            x: this.x,
            y: this.y - this.height,
            width: this.width,
            height: this.height
        };
    }
}

// Street Segment Class
class StreetSegment {
    constructor(x, key) {
        this.x = x;
        this.width = 480; // Image width
        this.height = 110;
        this.key = key;
    }

    update() {
        this.x -= PLAYER_RUN_SPEED;
    }

    draw() {
        const img = images[this.key];
        if (img) {
            ctx.drawImage(img, this.x, GROUND_Y - 2, this.width, this.height);
        }
    }
}

// Parallax Background Class (Houses, trees)
class BackgroundObject {
    constructor(x, key, isBuilding = true) {
        this.x = x;
        this.key = key;
        this.isBuilding = isBuilding;
        const img = images[key];
        this.width = img ? img.width : 200;
        this.height = img ? img.height : 250;
        
        // Scale to reasonable heights
        if (isBuilding) {
            this.width = this.width * 0.8;
            this.height = this.height * 0.8;
            this.y = GROUND_Y - this.height + 4;
        } else { // Trees
            this.width = this.width * 0.65;
            this.height = this.height * 0.65;
            if (this.key === "tree_small") {
                this.y = GROUND_Y - this.height + 16; // Shift down slightly more to hide roots
            } else {
                this.y = GROUND_Y - this.height + 4;
            }
        }
    }

    update() {
        this.x -= PARALLAX_BG_SPEED;
    }

    draw() {
        const img = images[this.key];
        if (img) {
            ctx.drawImage(img, this.x, this.y, this.width, this.height);
        }
    }
}

// Obstacle Class (Cars)
class Obstacle {
    constructor(x, key) {
        this.x = x;
        this.key = key;
        const img = images[key];
        
        // Define clean jumpable heights relative to street size (50% larger)
        let targetHeight = 135;
        if (key === "container") {
            targetHeight = 150; // 100 * 1.5
        } else if (key === "taxi") {
            targetHeight = 135; // 90 * 1.5
        } else {
            targetHeight = 128; // 85 * 1.5
        }
        
        const origW = img ? img.width : 120;
        const origH = img ? img.height : 60;
        const ratio = origW / origH;
        
        this.height = targetHeight;
        this.width = targetHeight * ratio;
        this.y = PLAYER_GROUND_Y - this.height + 4;
    }

    update() {
        this.x -= PLAYER_RUN_SPEED;
    }

    draw() {
        const img = images[this.key];
        if (img) {
            ctx.drawImage(img, this.x, this.y, this.width, this.height);
        }
    }

    getBounds() {
        // Fair collision box (scaled up)
        return {
            x: this.x + 15, // 10 * 1.5
            y: this.y + 8, // 5 * 1.5
            width: this.width - 30, // 20 * 1.5
            height: this.height - 12 // 8 * 1.5
        };
    }
}

// Hourglass Collectible
class Collectible {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 30;
        this.height = 40;
        this.angle = 0;
    }

    update() {
        this.x -= PLAYER_RUN_SPEED;
        this.angle += 0.05;
    }

    draw() {
        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
        ctx.rotate(Math.sin(this.angle) * 0.3); // swing gently
        
        // Draw vector hourglass
        ctx.fillStyle = "#eab308";
        ctx.shadowColor = "rgba(234, 179, 8, 0.8)";
        ctx.shadowBlur = 10;
        
        // Top and bottom plates
        ctx.fillRect(-15, -20, 30, 4);
        ctx.fillRect(-15, 16, 30, 4);
        
        // Glass body paths
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-12, -16);
        ctx.lineTo(12, -16);
        ctx.lineTo(3, 0);
        ctx.lineTo(12, 16);
        ctx.lineTo(-12, 16);
        ctx.lineTo(-3, 0);
        ctx.closePath();
        ctx.stroke();

        // Sand filling
        ctx.beginPath();
        ctx.moveTo(-9, -14);
        ctx.lineTo(9, -14);
        ctx.lineTo(2, 0);
        ctx.lineTo(-2, 0);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    getBounds() {
        return {
            x: this.x,
            y: this.y,
            width: this.width,
            height: this.height
        };
    }
}

// Particle Class
class Particle {
    constructor(x, y, vx, vy, color, size) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.color = color;
        this.size = size;
        this.life = 1.0;
        this.decay = Math.random() * 0.04 + 0.02;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = this.life;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

function spawnDustParticles(x, y) {
    for (let i = 0; i < 5; i++) {
        particles.push(new Particle(
            x,
            y,
            -Math.random() * 3 - 1,
            -Math.random() * 2,
            "rgba(100, 116, 139, 0.5)",
            Math.random() * 4 + 2
        ));
    }
}

// Grid Terrain Generator
function generateTerrain() {
    // Generate initial streets
    let nextX = 0;
    while (nextX < V_WIDTH + 480) {
        streets.push(new StreetSegment(nextX, "street_normal"));
        nextX += 480;
    }

    // Generate initial background buildings & trees
    let bgX = 0;
    const items = ["house_1", "house_2", "house_3", "block_1", "block_2", "tree_big", "tree_small"];
    while (bgX < V_WIDTH + 400) {
        let itemKey = items[Math.floor(Math.random() * items.length)];
        
        // Prevent Block 2 from spawning next to trees
        if (itemKey === "block_2" && backgrounds.length > 0) {
            const prevKey = backgrounds[backgrounds.length - 1].key;
            if (prevKey.startsWith("tree")) {
                const fallbacks = ["house_1", "house_2", "house_3", "block_1"];
                itemKey = fallbacks[Math.floor(Math.random() * fallbacks.length)];
            }
        }
        
        const isBuilding = !itemKey.startsWith("tree");
        const obj = new BackgroundObject(bgX, itemKey, isBuilding);
        backgrounds.push(obj);
        
        // If block_2 is spawned, force next element to be a house/block_1 directly next to it
        if (itemKey === "block_2") {
            bgX += obj.width;
            const nextKeys = ["house_1", "house_2", "house_3", "block_1"];
            const nextKey = nextKeys[Math.floor(Math.random() * nextKeys.length)];
            const nextObj = new BackgroundObject(bgX, nextKey, true);
            backgrounds.push(nextObj);
            bgX += nextObj.width + Math.random() * 40;
        } else {
            bgX += obj.width + (isBuilding ? Math.random() * 40 : Math.random() * 120);
        }
    }
}

let globalStats = { totalPlays: 0, highscores: [] };

async function loadStats() {
    try {
        const res = await fetch("/api/stats");
        globalStats = await res.json();
        const globalPlaysEl = document.getElementById("globalPlays");
        if (globalPlaysEl) globalPlaysEl.innerText = globalStats.totalPlays;
        
        const listDiv = document.getElementById("leaderboardList");
        if (listDiv) {
            if (globalStats.highscores.length === 0) {
                listDiv.innerHTML = "<p style='color: #aaa;'>Keine Einträge vorhanden</p>";
            } else {
                listDiv.innerHTML = globalStats.highscores.map((hs, idx) => 
                    `<div style="display:flex; justify-content:space-between; margin: 4px 0; border-bottom: 1px dashed rgba(255,255,255,0.05); padding: 2px 4px;">
                        <span>${idx+1}. ${hs.name}</span>
                        <span style="color:#eab308; font-weight:bold;">${hs.score}m</span>
                     </div>`
                ).join("");
            }
        }
    } catch (e) {
        console.error("Failed to load stats", e);
    }
}

// Reset Game
function resetGame() {
    score = 0;
    totalTicks = 0;
    player = new Player();
    catcher = new Catcher();
    
    streets = [];
    backgrounds = [];
    obstacles = [];
    collectibles = [];
    particles = [];

    generateTerrain();
    
    // Pause GameOver Video if playing
    const goVideo = document.getElementById("gameOverVideo");
    if (goVideo) goVideo.pause();

    // Increment global played counter on backend
    fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incrementPlay: true })
    })
    .then(res => res.json())
    .then(data => {
        globalStats = data;
        const globalPlaysEl = document.getElementById("globalPlays");
        if (globalPlaysEl) globalPlaysEl.innerText = data.totalPlays;
    })
    .catch(e => console.error(e));

    musicPlayer.start(); // Start background loop music
}

// Collision Check
function checkCollision(r1, r2) {
    return r1.x < r2.x + r2.width &&
           r1.x + r1.width > r2.x &&
           r1.y < r2.y + r2.height &&
           r1.y + r1.height > r2.y;
}

// Handle Game Over
function triggerGameOver() {
    gameState = "GAMEOVER";
    document.getElementById("finalScore").innerText = Math.floor(score);
    
    const goVideoScreen = document.getElementById("gameOverVideoScreen");
    const goMenuScreen = document.getElementById("gameOverMenuScreen");
    const goVideo = document.getElementById("gameOverVideo");
    
    // Hide menu overlay, show video overlay
    if (goMenuScreen) goMenuScreen.classList.add("hidden");
    if (goVideoScreen) goVideoScreen.classList.remove("hidden");
    
    musicPlayer.stop(); // Stop loop music so video audio is audible

    function transitionToGameOverMenu() {
        if (goVideoScreen) goVideoScreen.classList.add("hidden");
        if (goVideo) goVideo.pause();
        if (goMenuScreen) {
            goMenuScreen.classList.remove("hidden");
            const contentDiv = document.querySelector("#gameOverMenuScreen .overlayContent");
            if (contentDiv) contentDiv.scrollTop = 0;
        }
    }

    // Check if player broke a new record to show highscore input
    loadStats().then(() => {
        const currentScore = Math.floor(score);
        const scores = globalStats.highscores;
        const isTop = scores.length < 10 || currentScore > scores[scores.length - 1].score;
        
        const hsForm = document.getElementById("highscoreForm");
        if (hsForm) {
            if (isTop && currentScore > 0) {
                hsForm.classList.remove("hidden");
            } else {
                hsForm.classList.add("hidden");
            }
        }
    });

    if (goVideo) {
        goVideo.currentTime = 0;
        goVideo.play()
            .then(() => {
                // Show menus after the GTA6 video ends
                goVideo.onended = () => {
                    transitionToGameOverMenu();
                };
            })
            .catch(e => {
                console.log("Game over video play blocked", e);
                transitionToGameOverMenu();
            });
    } else {
        transitionToGameOverMenu();
    }
}

// Update loop
function update() {
    totalTicks++;
    score += PLAYER_RUN_SPEED / 60; // Calculate meters run based on tick speed
    document.getElementById("score").innerText = Math.floor(score);

    // Update Player & Catcher
    player.update();
    
    const warningDiv = document.getElementById("catcherWarning");
    if (score >= 50) {
        catcher.update();
        warningDiv.style.display = "block";
        
        // HUD Catcher Warning updating
        const distanceToCatcher = Math.max(0, Math.floor((player.x - (catcher.x + catcher.width)) / 10));
        document.getElementById("catcherDist").innerText = distanceToCatcher;
        if (distanceToCatcher > 12) {
            warningDiv.className = "safe";
        } else if (distanceToCatcher > 5) {
            warningDiv.className = "warning";
        } else {
            warningDiv.className = "danger";
        }
    } else {
        warningDiv.style.display = "none";
    }

    // Street manager (Infinite scrolling)
    streets.forEach(seg => seg.update());
    if (streets[0].x <= -streets[0].width) {
        const oldSeg = streets.shift();
        // Spawns next segment at the tail of the last one
        const lastSeg = streets[streets.length - 1];
        
        // Randomize street types (80% Normal, 20% specials)
        let streetType = "street_normal";
        const roll = Math.random();
        if (roll < 0.08) streetType = "street_water";
        else if (roll < 0.15) streetType = "street_zebra";
        else if (roll < 0.20) streetType = "street_normal2";

        streets.push(new StreetSegment(lastSeg.x + lastSeg.width, streetType));
    }

    // Background manager (Infinite Parallax scrolling)
    backgrounds.forEach(bg => bg.update());
    if (backgrounds.length > 0 && backgrounds[0].x <= -backgrounds[0].width) {
        backgrounds.shift();
    }
    const lastBg = backgrounds[backgrounds.length - 1];
    if (lastBg && lastBg.x < V_WIDTH + 100) {
        const items = ["house_1", "house_2", "house_3", "block_1", "block_2", "tree_big", "tree_small"];
        let itemKey = items[Math.floor(Math.random() * items.length)];
        
        // Prevent Block 2 from spawning next to trees
        if (itemKey === "block_2") {
            const prevKey = lastBg.key;
            if (prevKey.startsWith("tree")) {
                const fallbacks = ["house_1", "house_2", "house_3", "block_1"];
                itemKey = fallbacks[Math.floor(Math.random() * fallbacks.length)];
            }
        }
        
        const isBuilding = !itemKey.startsWith("tree");
        
        // If previous element was block_2, spawn next building directly adjacent
        if (lastBg.key === "block_2") {
            const nextKeys = ["house_1", "house_2", "house_3", "block_1"];
            const nextKey = nextKeys[Math.floor(Math.random() * nextKeys.length)];
            const obj = new BackgroundObject(lastBg.x + lastBg.width, nextKey, true);
            backgrounds.push(obj);
        } else {
            const obj = new BackgroundObject(lastBg.x + lastBg.width + (isBuilding ? Math.random() * 30 : Math.random() * 120), itemKey, isBuilding);
            backgrounds.push(obj);
        }
    }

    // Spawn Obstacles (random interval)
    if (totalTicks % 120 === 0 && Math.random() > 0.3) {
        const carKeys = ["car_1", "car_2", "taxi", "container", "street_bock"];
        const key = carKeys[Math.floor(Math.random() * carKeys.length)];
        // Ensure obstacles don't spawn too close to each other
        const lastObs = obstacles[obstacles.length - 1];
        if (!lastObs || lastObs.x < V_WIDTH - 250) {
            obstacles.push(new Obstacle(V_WIDTH + 100, key));
        }
    }

    // Update Obstacles
    obstacles.forEach(obs => obs.update());
    if (obstacles.length > 0 && obstacles[0].x <= -obstacles[0].width) {
        obstacles.shift();
    }

    // Spawn Collectibles (Sanduhr)
    if (totalTicks % 210 === 0 && Math.random() > 0.4) {
        const lastCollect = collectibles[collectibles.length - 1];
        if (!lastCollect || lastCollect.x < V_WIDTH - 300) {
            // Spawn sanduhr either flat on ground or slightly elevated for jumping
            const yOffset = Math.random() > 0.5 ? (PLAYER_GROUND_Y - 140) : (PLAYER_GROUND_Y - 50);
            collectibles.push(new Collectible(V_WIDTH + 100, yOffset));
        }
    }

    // Update Collectibles
    collectibles.forEach(col => col.update());
    if (collectibles.length > 0 && collectibles[0].x <= -collectibles[0].width) {
        collectibles.shift();
    }

    // Update Particles
    particles.forEach(p => p.update());
    particles = particles.filter(p => p.life > 0);

    // Collisions check
    const pBounds = player.getBounds();

    // Check obstacle crash
    for (let obs of obstacles) {
        if (checkCollision(pBounds, obs.getBounds())) {
            triggerGameOver();
            return;
        }
    }

    // Check catcher catch (only active after 50 meters)
    if (score >= 50 && checkCollision(pBounds, catcher.getBounds())) {
        triggerGameOver();
        return;
    }

    // Collect hourglass checks
    for (let i = collectibles.length - 1; i >= 0; i--) {
        const col = collectibles[i];
        if (checkCollision(pBounds, col.getBounds())) {
            // Collect!
            catcher.pushBack(160); // Push catcher back
            collectibles.splice(i, 1);
            
            // Add flash indicator particles
            for (let j = 0; j < 15; j++) {
                particles.push(new Particle(
                    player.x + player.width/2,
                    player.y - player.height/2,
                    (Math.random() - 0.5) * 10,
                    (Math.random() - 0.5) * 10,
                    "#eab308",
                    Math.random() * 6 + 3
                ));
            }
        }
    }
}

// Render loop
function draw() {
    ctx.clearRect(0, 0, V_WIDTH, V_HEIGHT);

    // 1. Draw Background Sky Image
    const bgImg = images["background_img"];
    if (bgImg) {
        ctx.drawImage(bgImg, 0, 0, V_WIDTH, V_HEIGHT);
    } else {
        const gradient = ctx.createLinearGradient(0, 0, 0, V_HEIGHT);
        gradient.addColorStop(0, "#120024"); // Deep space violet
        gradient.addColorStop(0.4, "#2e0854"); // Dark purple
        gradient.addColorStop(0.7, "#86198f"); // Magenta/pink blend
        gradient.addColorStop(1, "#ec4899"); // Bright synthwave pink horizon
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, V_WIDTH, V_HEIGHT);
    }

    // Grid details on sky background
    ctx.strokeStyle = "rgba(109, 40, 217, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 0; i < V_WIDTH; i += 60) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, GROUND_Y);
        ctx.stroke();
    }

    // 2. Draw Parallax buildings/trees
    backgrounds.forEach(bg => bg.draw());

    // 3. Draw Streets
    streets.forEach(seg => seg.draw());

    // 4. Draw Collectibles
    collectibles.forEach(col => col.draw());

    // 5. Draw Obstacles
    obstacles.forEach(obs => obs.draw());

    // 6. Draw Player & Catcher
    player.draw();
    if (score >= 50) {
        catcher.draw();
    }

    // 7. Draw Particles
    particles.forEach(p => p.draw());
}

// Main Loop
function gameLoop() {
    if (gameState === "PLAYING") {
        update();
        draw();
        requestAnimationFrame(gameLoop);
    }
}

// Event Bindings
document.getElementById("startBtn").addEventListener("click", () => {
    document.getElementById("startScreen").classList.add("hidden");
    gameState = "PLAYING";
    resetGame();
    gameLoop();
});

document.getElementById("restartBtn").addEventListener("click", () => {
    document.getElementById("gameOverMenuScreen").classList.add("hidden");
    gameState = "PLAYING";
    resetGame();
    gameLoop();
});

// Touch / Mouse controls
const jumpBtn = document.getElementById("jumpBtn");
const flipBtn = document.getElementById("flipBtn");

jumpBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (gameState === "PLAYING") player.jump();
});
jumpBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (gameState === "PLAYING") player.jump();
});

flipBtn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (gameState === "PLAYING") player.flip();
});
flipBtn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (gameState === "PLAYING") player.flip();
});

// Keyboard controls
window.addEventListener("keydown", (e) => {
    if (gameState !== "PLAYING") return;
    
    if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        player.jump();
    } else if (e.code === "KeyF" || e.code === "ControlLeft" || e.code === "ControlRight") {
        e.preventDefault();
        player.flip();
    }
});

// Show initial background details even in start menu
preload().then(() => {
    resetGame();
    draw();
    loadStats(); // Load initial highscores and global plays counter
});

// Highscore Form Submission listener
document.getElementById("submitHighscoreBtn").addEventListener("click", () => {
    const nameInput = document.getElementById("playerNameInput");
    const name = nameInput.value.trim();
    if (!name) return;
    
    const currentScore = Math.floor(score);
    
    fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, score: currentScore })
    })
    .then(res => res.json())
    .then(data => {
        globalStats = data;
        document.getElementById("highscoreForm").classList.add("hidden");
        nameInput.value = "";
        loadStats();
    })
    .catch(e => console.error(e));
});

// Run Intro Sequence (Splash Screen -> Piss Video Screen -> Wanted Poster Screen -> Start Screen)
window.addEventListener("DOMContentLoaded", () => {
    const splashScreen = document.getElementById("splashScreen");
    const introVideoScreen = document.getElementById("introVideoScreen");
    const introWantedScreen = document.getElementById("introWantedScreen");
    const introVideo = document.getElementById("introVideo");
    
    let introTransitioned = false;
    function transitionToWanted() {
        if (introTransitioned) return;
        introTransitioned = true;
        
        // Hide and pause Video Screen
        if (introVideoScreen) {
            introVideoScreen.classList.add("hidden");
        }
        if (introVideo) {
            introVideo.pause();
        }

        // Show Wanted Poster Screen
        if (introWantedScreen) {
            introWantedScreen.classList.remove("hidden");
            
            // Show Wanted poster screen for 2.5 seconds, then fade it out
            setTimeout(() => {
                introWantedScreen.style.opacity = 0;
                setTimeout(() => {
                    introWantedScreen.classList.add("hidden");
                }, 500);
            }, 2500);
        }
    }

    if (splashScreen) {
        splashScreen.addEventListener("click", () => {
            // Unblock audio context immediately on interaction
            musicPlayer.init();
            
            // Hide Splash Screen
            splashScreen.classList.add("hidden");
            
            // Show Video Screen
            if (introVideoScreen) {
                introVideoScreen.classList.remove("hidden");
            }
            
            if (introVideo) {
                // Play unmuted since this runs directly inside user gesture click callback
                introVideo.muted = false;
                introVideo.play().catch(e => {
                    console.error("Video play failed unmuted, trying muted...", e);
                    introVideo.muted = true;
                    introVideo.play().catch(err => {
                        console.error("Video completely failed, skipping to Wanted...", err);
                        transitionToWanted();
                    });
                });

                // Once the video finishes, show the Wanted poster screen
                introVideo.onended = () => {
                    transitionToWanted();
                };

                // Fallback safety timeout (6.5s) to guarantee wanted screen shows up even if video fails
                setTimeout(() => {
                    transitionToWanted();
                }, 6500);
            } else {
                transitionToWanted();
            }
        });
    } else {
        transitionToWanted();
    }
});
