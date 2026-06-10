import {
  PIXI_WIDTH,
  PIXI_HEIGHT,
  INTERACT_DISTANCE,
  PLAYER_SPEED,
  SOMNIA_CHAIN_ID_HEX,
  DEFAULT_GAME_CONTRACT_ADDRESS,
  WEAPON_SHARD_COST,
  CLASS_DEFS,
  CAMPFIRE_SCENE,
  CAMPFIRE_COMPANIONS,
  LIGHT_SOURCES,
  RARITIES,
  NPCS,
  SCENE_CONFIG,
  DEFAULT_NAMES,
  PLAYER_DIRECTION_Y_OFFSETS,
} from "./config.js?v=20260610-dialogue2";
import { loadTextures } from "./assets.js?v=20260610-dialogue2";
import { SimulationGameAdapter, SomniaContractAdapter } from "./adapters.js?v=20260610-dialogue2";
import { clamp, formatTime, getClass, getHeroPortrait, normalizeError, shortAddress } from "./utils.js?v=20260610-dialogue2";

const elements = {
    appShell: document.querySelector("#app-shell"),
    loginScreen: document.querySelector("#login-screen"),
    loginConnect: document.querySelector("#login-connect"),
    loginMessage: document.querySelector("#login-message"),
    stage: document.querySelector("#pixi-stage"),
    locationName: document.querySelector("#location-name"),
    nearbyLabel: document.querySelector("#nearby-label"),
    talkButton: document.querySelector("#talk-button"),
    hudHero: document.querySelector("#hud-hero"),
    hudShards: document.querySelector("#hud-shards"),
    hudWeapon: document.querySelector("#hud-weapon"),
    hudWallet: document.querySelector("#hud-wallet"),
    hudPending: document.querySelector("#hud-pending"),
    chronicleOpen: document.querySelector("#chronicle-open"),
    gameScreen: document.querySelector("#game-screen"),
    gameScreenTitle: document.querySelector("#game-screen-title"),
    gameScreenKicker: document.querySelector("#game-screen-kicker"),
    gameScreenClose: document.querySelector("#game-screen-close"),
    screenPages: Array.from(document.querySelectorAll(".game-screen-page")),
    dialogue: document.querySelector("#dialogue"),
    dialoguePortrait: document.querySelector("#dialogue-portrait"),
    dialogueSpeaker: document.querySelector("#dialogue-speaker"),
    dialogueText: document.querySelector("#dialogue-text"),
    dialogueAction: document.querySelector("#dialogue-action"),
    dialogueClose: document.querySelector("#dialogue-close"),
    storyModal: document.querySelector("#story-modal"),
    storyTitle: document.querySelector("#story-title"),
    storySource: document.querySelector("#story-source"),
    storyText: document.querySelector("#story-text"),
    storyClose: document.querySelector("#story-close"),
    recruitForm: document.querySelector("#recruit-form"),
    recruitSubmit: document.querySelector("#recruit-form button"),
    heroName: document.querySelector("#hero-name"),
    selectedHero: document.querySelector("#selected-hero"),
    heroList: document.querySelector("#hero-list"),
    heroCount: document.querySelector("#hero-count"),
    selectedName: document.querySelector("#selected-name"),
    connectWallet: document.querySelector("#login-connect"),
    walletMessage: document.querySelector("#login-message"),
    pendingCount: document.querySelector("#pending-count"),
    pendingList: document.querySelector("#pending-list"),
    shardCount: document.querySelector("#shard-count"),
    weaponName: document.querySelector("#weapon-name"),
    weaponCount: document.querySelector("#weapon-count"),
    forgeStatus: document.querySelector("#forge-status"),
    forgeAction: document.querySelector("#forge-action"),
    weaponList: document.querySelector("#weapon-list"),
    weaponEquip: document.querySelector("#weapon-equip"),
    weaponTransfer: document.querySelector("#weapon-transfer"),
    weaponRecipient: document.querySelector("#weapon-recipient"),
    arenaChoice: document.querySelector("#arena-choice"),
    arenaModeCreate: document.querySelector("#arena-mode-create"),
    arenaModeJoin: document.querySelector("#arena-mode-join"),
    arenaCreatePanel: document.querySelector("#arena-create-panel"),
    arenaJoinPanel: document.querySelector("#arena-join-panel"),
    arenaBackButtons: Array.from(document.querySelectorAll(".arena-back")),
    arenaStake: document.querySelector("#arena-stake"),
    arenaRoomId: document.querySelector("#arena-room-id"),
    arenaCreate: document.querySelector("#arena-create"),
    arenaJoin: document.querySelector("#arena-join"),
    arenaRoomStatus: document.querySelector("#arena-room-status"),
    arenaMessage: document.querySelector("#arena-message"),
    eventLog: document.querySelector("#event-log"),
    logCount: document.querySelector("#log-count"),
    mobileControls: document.querySelector(".mobile-controls"),
  };

  const state = {
    scene: "camp",
    heroes: [],
    events: [],
    selectedHeroId: null,
    nearbyNpcId: null,
    activeNpcId: null,
    activeScreen: null,
    keys: new Set(),
    touchMoves: new Set(),
    seenStories: new Set(),
    arena: {
      mode: "menu",
      lastRoomId: null,
      lastFight: null,
      pendingStoryRoomId: null,
      seenStories: new Set(),
      createdChallengeOwners: new Map(),
    },
    connection: {
      mode: "simulation",
      wallet: "",
      contractAddress: "",
      contractVersion: "Unknown",
      gateSupport: false,
      forgeSupport: false,
      llmGateSupport: false,
      arenaSupport: false,
      message: "Waiting for wallet connection.",
      pendingRequests: [],
      busy: false,
    },
    forgeCost: WEAPON_SHARD_COST,
    selectedWeaponId: null,
    player: {
      x: 512,
      y: 504,
      dir: "down",
      moving: false,
      moveTarget: null,
      queuedNpcId: null,
    },
  };

  let adapter = new SimulationGameAdapter();
  let pixi = null;
  let textures = {};
  let dialogueAnimation = {
    key: "",
    frameId: null,
  };
  let storyAnimation = {
    key: "",
    frameId: null,
    text: "",
  };
  let arenaRoomSyncTimer = null;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    hydrateContractAddress();

    wireDomEvents();
    addEvent("system", "Camp loaded. The Somnia path is ready when you connect a contract.");
    renderAll();

    if (!window.PIXI) {
      addEvent("danger", "PixiJS did not load from CDN.");
      renderLog();
      return;
    }

    await initPixi();
    renderAll();

    setInterval(async () => {
      if (state.connection.busy) return;
      try {
        await adapter.updateMarket();
        renderMarket(adapter.peekMarket());
      } catch (error) {
        addEvent("danger", `Market refresh failed: ${normalizeError(error)}`);
        renderAll();
      }
    }, 9000);

    setInterval(() => {
      if (state.connection.busy) return;
      const order = adapter.getInventory?.().forgeOrder;
      if (!order?.active) return;
      renderInventory();
      renderDialogue();
    }, 1000);
  }

  function hydrateContractAddress() {
    const address = DEFAULT_GAME_CONTRACT_ADDRESS.trim();
    state.connection.contractAddress = address;
    state.connection.message = address ? "Connect wallet to enter Sogent." : "Game contract is not configured yet.";
  }

  function wireDomEvents() {
    window.addEventListener("keydown", (event) => {
      if (isTyping()) return;
      const key = normalizeKey(event.key);
      if (!key) return;
      event.preventDefault();
      if (key === "interact") {
        openNearbyDialogue();
      } else {
        state.keys.add(key);
      }
    });

    window.addEventListener("keyup", (event) => {
      const key = normalizeKey(event.key);
      if (key && key !== "interact") {
        state.keys.delete(key);
      }
    });

    elements.talkButton.addEventListener("click", openNearbyDialogue);
    elements.dialogueClose.addEventListener("click", closeDialogue);
    elements.dialogueText.addEventListener("click", finishDialogueAnimation);
    elements.storyClose.addEventListener("click", closeStoryModal);
    elements.storyText.addEventListener("click", finishStoryAnimation);
    elements.gameScreenClose.addEventListener("click", closeGameScreen);
    elements.chronicleOpen.addEventListener("click", () => openGameScreen("chronicle"));
    elements.arenaModeCreate.addEventListener("click", () => {
      state.arena.mode = "create";
      renderArena();
    });
    elements.arenaModeJoin.addEventListener("click", () => {
      state.arena.mode = "join";
      renderArena();
      queueArenaRoomSync();
    });
    elements.arenaBackButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.arena.mode = "menu";
        renderArena();
      });
    });
    elements.arenaCreate.addEventListener("click", () => {
      void createArenaRoomFromInput();
    });
    elements.arenaJoin.addEventListener("click", () => {
      void joinArenaRoomFromInput();
    });
    elements.forgeAction.addEventListener("click", () => {
      void performBlacksmithAction();
    });
    elements.weaponEquip.addEventListener("click", () => {
      void equipSelectedWeapon();
    });
    elements.weaponTransfer.addEventListener("click", () => {
      void transferSelectedWeapon();
    });
    elements.arenaStake.addEventListener("input", renderArena);
    elements.arenaRoomId.addEventListener("input", () => {
      renderAll();
      queueArenaRoomSync();
    });
    elements.dialogueAction.addEventListener("click", () => {
      const npc = getActiveNpc();
      if (npc) {
        void performNpcAction(npc.id);
      }
    });

    elements.recruitForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void recruitHeroFromInput();
    });

    elements.connectWallet.addEventListener("click", () => {
      void connectSomniaAdapter();
    });

    elements.heroList.addEventListener("click", (event) => {
      const card = event.target.closest("[data-hero-id]");
      if (!card) return;
      state.selectedHeroId = Number(card.dataset.heroId);
      closeDialogue();
      renderAll();
    });

    elements.mobileControls.addEventListener("pointerdown", (event) => {
      const button = event.target.closest("[data-move]");
      if (!button) return;
      button.setPointerCapture(event.pointerId);
      state.touchMoves.add(button.dataset.move);
    });

    elements.mobileControls.addEventListener("pointerup", clearTouchMove);
    elements.mobileControls.addEventListener("pointercancel", clearTouchMove);
    elements.mobileControls.addEventListener("pointerleave", clearTouchMove);

    if (window.ethereum?.on) {
      window.ethereum.on("accountsChanged", () => {
        if (state.connection.mode !== "somnia") return;
        adapter = new SimulationGameAdapter();
        state.connection.mode = "simulation";
        state.connection.wallet = "";
        state.connection.contractVersion = "Unknown";
        state.connection.gateSupport = false;
        state.connection.forgeSupport = false;
        state.connection.llmGateSupport = false;
        state.connection.arenaSupport = false;
        state.forgeCost = WEAPON_SHARD_COST;
        state.selectedWeaponId = null;
        state.connection.pendingRequests = [];
        state.connection.message = "Wallet account changed. Connect again to continue on Somnia.";
        addEvent("system", state.connection.message);
        renderAll();
      });

      window.ethereum.on("chainChanged", (chainId) => {
        if (state.connection.mode !== "somnia" || chainId === SOMNIA_CHAIN_ID_HEX) return;
        adapter = new SimulationGameAdapter();
        state.connection.mode = "simulation";
        state.connection.wallet = "";
        state.connection.contractVersion = "Unknown";
        state.connection.gateSupport = false;
        state.connection.forgeSupport = false;
        state.connection.llmGateSupport = false;
        state.connection.arenaSupport = false;
        state.forgeCost = WEAPON_SHARD_COST;
        state.connection.pendingRequests = [];
        state.connection.message = "Wallet left Somnia Testnet. Connect again after switching back.";
        addEvent("danger", state.connection.message);
        renderAll();
      });
    }
  }

  async function initPixi() {
    const app = new PIXI.Application();
    await app.init({
      width: PIXI_WIDTH,
      height: PIXI_HEIGHT,
      background: "#071013",
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });

    const canvas = app.canvas || app.view;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    elements.stage.replaceChildren(canvas);
    canvas.addEventListener("click", handleCanvasClick);
    textures = await loadTextures({ addEvent });

    const worldLayer = new PIXI.Container();
    const objectLayer = new PIXI.Container();
    const groundFxLayer = new PIXI.Container();
    const npcLayer = new PIXI.Container();
    const playerLayer = new PIXI.Container();
    const fxLayer = new PIXI.Container();
    app.stage.addChild(worldLayer, objectLayer, groundFxLayer, npcLayer, playerLayer, fxLayer);

    const worldBackground = drawWorld(worldLayer);
    drawObjects(objectLayer);
    const campfireScene = buildCampfireScene();
    if (campfireScene) objectLayer.addChild(campfireScene);
    const campfireCompanions = buildCampfireCompanions();
    objectLayer.addChild(campfireCompanions);

    const npcSprites = new Map();
    NPCS.forEach((npc) => {
      const sprite = buildNpcSprite(npc);
      npcLayer.addChild(sprite);
      npcSprites.set(npc.id, sprite);
    });

    const playerSprite = buildPlayerSprite();
    playerLayer.addChild(playerSprite);

    const gateFx = new PIXI.Graphics();
    const campfireFx = new PIXI.Graphics();
    const lightFx = new PIXI.Graphics();
    const destinationMarker = new PIXI.Graphics();
    const interactRing = new PIXI.Graphics();
    const floatingLayer = new PIXI.Container();
    const playerLabel = buildWorldLabel("Wanderer", CLASS_DEFS[0].color);
    const gateStatusLabel = buildWorldLabel("Gate Dormant", 0x42d6c5);
    const attentionMarkers = new Map([
      ["warden", buildStoryMarker()],
      ["arena-master", buildStoryMarker()],
    ]);
    const storyMarker = attentionMarkers.get("warden");
    gateStatusLabel.x = 512;
    gateStatusLabel.y = 42;
    groundFxLayer.addChild(destinationMarker, interactRing);
    fxLayer.addChild(lightFx, gateFx, campfireFx, ...attentionMarkers.values(), playerLabel, gateStatusLabel, floatingLayer);

    pixi = {
      app,
      npcSprites,
      worldBackground,
      campfireScene,
      campfireCompanions,
      playerSprite,
      playerLabel,
      gateStatusLabel,
      storyMarker,
      attentionMarkers,
      gateFx,
      campfireFx,
      lightFx,
      destinationMarker,
      interactRing,
      floatingLayer,
      floatingTexts: [],
      portalPulse: 0,
    };

    applySceneVisuals();
    app.ticker.add((ticker) => tick(ticker.deltaTime || 1));
  }

  function tick(delta) {
    movePlayer(delta);
    updateNearbyNpc();
    updatePixiSprites();
    updateFloatingTexts(delta);
  }

  function movePlayer(delta) {
    const input = getMovementInput();
    const manualMove = input.x !== 0 || input.y !== 0;
    state.player.moving = manualMove;

    if (!manualMove) {
      movePlayerToTarget(delta);
      return;
    }

    clearAutoMove();

    if (Math.abs(input.x) > Math.abs(input.y)) {
      state.player.dir = input.x > 0 ? "right" : "left";
    } else {
      state.player.dir = input.y > 0 ? "down" : "up";
    }

    const len = Math.hypot(input.x, input.y) || 1;
    const dx = (input.x / len) * PLAYER_SPEED * delta;
    const dy = (input.y / len) * PLAYER_SPEED * delta;
    tryMove(dx, dy);
  }

  function movePlayerToTarget(delta) {
    const target = state.player.moveTarget;
    if (!target) {
      state.player.moving = false;
      return;
    }

    const dx = target.x - state.player.x;
    const dy = target.y - state.player.y;
    const distance = Math.hypot(dx, dy);
    const step = PLAYER_SPEED * delta;

    if (distance <= step + 1) {
      state.player.x = target.x;
      state.player.y = target.y;
      state.player.moving = false;
      const npc = state.player.queuedNpcId ? getCurrentNpcs().find((item) => item.id === state.player.queuedNpcId) : null;
      clearAutoMove();
      if (npc && Math.hypot(state.player.x - npc.x, state.player.y - npc.y) <= getNpcInteractDistance(npc) + 12) {
        state.nearbyNpcId = npc.id;
        openDialogue(npc);
      }
      return;
    }

    state.player.moving = true;
    if (Math.abs(dx) > Math.abs(dy)) {
      state.player.dir = dx > 0 ? "right" : "left";
    } else {
      state.player.dir = dy > 0 ? "down" : "up";
    }

    const beforeX = state.player.x;
    const beforeY = state.player.y;
    tryMove((dx / distance) * step, (dy / distance) * step);

    if (Math.abs(beforeX - state.player.x) < 0.05 && Math.abs(beforeY - state.player.y) < 0.05) {
      clearAutoMove();
      state.player.moving = false;
    }
  }

  function tryMove(dx, dy) {
    const bounds = getSceneBounds();
    const nextX = clamp(state.player.x + dx, bounds.minX, bounds.maxX);
    const nextY = clamp(state.player.y + dy, bounds.minY, bounds.maxY);

    if (!isBlocked(nextX, state.player.y)) {
      state.player.x = nextX;
    }
    if (!isBlocked(state.player.x, nextY)) {
      state.player.y = nextY;
    }

    handleSceneTransition();
  }

  function isBlocked(x, y) {
    return getSceneObstacles().some((rect) => x > rect.x && x < rect.x + rect.w && y > rect.y && y < rect.y + rect.h);
  }

  function getMovementInput() {
    let x = 0;
    let y = 0;
    const active = new Set([...state.keys, ...state.touchMoves]);
    if (active.has("left")) x -= 1;
    if (active.has("right")) x += 1;
    if (active.has("up")) y -= 1;
    if (active.has("down")) y += 1;
    return { x, y };
  }

  function updateNearbyNpc() {
    const closest = findNpcNear(state.player.x, state.player.y, INTERACT_DISTANCE);
    const nearId = closest ? closest.id : null;
    if (nearId !== state.nearbyNpcId) {
      state.nearbyNpcId = nearId;
      renderNearby();
    }
  }

  function updatePixiSprites() {
    if (!pixi) return;
    applySceneVisuals();
    const hero = getSelectedHero();
    const heroClass = hero ? getClass(hero.classId) : CLASS_DEFS[0];

    pixi.playerSprite.x = state.player.x;
    pixi.playerSprite.y = state.player.y;
    pixi.playerSprite.scale.x = 1;
    pixi.playerSprite.tint = 0xffffff;
    pixi.playerLabel.x = state.player.x;
    pixi.playerLabel.y = state.player.y - 72;
    pixi.playerLabel.text = hero ? hero.name : "Wanderer";
    pixi.playerLabel.style.fill = heroClass.css;

    const animatedPlayer = pixi.playerSprite.children.find((child) => child.label === "animated-player");
    if (animatedPlayer) {
      const frames = textures.playerFrames?.[state.player.dir] || textures.playerFrames?.down || [];
      const frameIndex = state.player.moving ? 1 + (Math.floor(Date.now() / 135) % 2) : 0;
      if (frames[frameIndex] && animatedPlayer.texture !== frames[frameIndex]) {
        animatedPlayer.texture = frames[frameIndex];
      }
      const idleBreath = state.player.moving ? 1 : 1 + Math.sin(pixi.portalPulse * 2.2) * 0.018;
      const moveBob = state.player.moving ? Math.sin(Date.now() / 70) * 2 : Math.sin(pixi.portalPulse * 2.2) * 0.45;
      animatedPlayer.scale.x = animatedPlayer.baseScaleX * (1 - (idleBreath - 1) * 0.4);
      animatedPlayer.scale.y = animatedPlayer.baseScaleY * idleBreath;
      animatedPlayer.y = animatedPlayer.baseY + (PLAYER_DIRECTION_Y_OFFSETS[state.player.dir] || 0) + moveBob;
    } else {
      const bob = state.player.moving ? Math.sin(Date.now() / 70) * 2 : 0;
      pixi.playerSprite.scale.x = state.player.dir === "left" ? -1 : 1;
      pixi.playerSprite.children.forEach((child) => {
        if (child.label === "accent") child.tint = heroClass.color;
        if (child.label === "portrait-frame") child.tint = heroClass.color;
        if (child.label === "hero-portrait" && child.texture !== textures[heroClass.id]) {
          child.texture = textures[heroClass.id];
        }
        child.y += (child.baseY || 0) - child.y + bob * 0.12;
      });
    }

    pixi.portalPulse += 0.04;
    pixi.npcSprites.forEach((sprite, id) => {
      const npc = NPCS.find((item) => item.id === id);
      const isVisible = npc ? isNpcInCurrentScene(npc) : false;
      sprite.visible = isVisible;
      if (!isVisible) return;

      sprite.y = sprite.baseY;
      sprite.alpha = id === state.nearbyNpcId ? 1 : 0.88;
      const npcAgent = sprite.children.find((child) => child.label === "npc-agent" || child.label === "npc-fallback");
      if (npcAgent) {
        const breath = 1 + Math.sin(pixi.portalPulse * 1.9 + sprite.phase) * 0.026;
        const sway = Math.sin(pixi.portalPulse * 1.15 + sprite.phase) * 0.012;
        npcAgent.scale.x = npcAgent.baseScaleX * (1 - (breath - 1) * 0.35);
        npcAgent.scale.y = npcAgent.baseScaleY * breath;
        npcAgent.rotation = sway;
        npcAgent.y = npcAgent.baseY || 0;
      }
      const label = sprite.children.find((child) => child.label === "npc-label");
      if (label) {
        label.alpha = id === state.nearbyNpcId || id === state.activeNpcId ? 1 : 0.76;
        label.y = label.baseY || -94;
      }
    });
    updateGateStatusLabel();
    updateStoryMarker();
    updateCampfireCompanions();

    drawGateFx();
    drawCampfireFx();
    drawLightFx();
    drawDestinationMarker();
    drawInteractRing();
  }

  function drawLightFx() {
    if (!pixi?.lightFx) return;
    const g = pixi.lightFx;
    const t = pixi.portalPulse;
    const sources = LIGHT_SOURCES[state.scene] || [];

    g.clear();
    sources.forEach((source, index) => {
      const phase = t * (source.type === "cyan" ? 2.4 : 3.1) + index * 0.73;
      if (source.type === "cyan") {
        drawCyanLight(g, source.x, source.y, source.radius, phase);
      } else {
        drawFireLight(g, source.x, source.y, source.radius, phase);
      }
    });
  }

  function drawCyanLight(g, x, y, radius, phase) {
    const pulse = 0.5 + Math.sin(phase) * 0.12;
    const flickerX = Math.sin(phase * 1.7) * 1.2;

    g.circle(x, y + 4, radius + pulse * 3).fill({
      color: 0x42d6c5,
      alpha: 0.055 + pulse * 0.035,
    });
    g.ellipse(x, y + 16, radius * 0.7, radius * 0.32).fill({
      color: 0x42d6c5,
      alpha: 0.045 + pulse * 0.02,
    });
    g.ellipse(x + flickerX, y - 2, 5, 12 + Math.sin(phase * 2.3) * 2).fill({
      color: 0x42d6c5,
      alpha: 0.22,
    });
    g.rect(x - 1 + flickerX, y - 15, 2, 7).fill({
      color: 0x9ffdf3,
      alpha: 0.2 + pulse * 0.08,
    });
  }

  function drawFireLight(g, x, y, radius, phase) {
    const pulse = 0.5 + Math.sin(phase) * 0.14;
    const flickerX = Math.sin(phase * 1.9) * 1.4;

    g.circle(x, y + 5, radius + pulse * 4).fill({
      color: 0xf0a94b,
      alpha: 0.045 + pulse * 0.035,
    });
    g.ellipse(x, y + 14, radius * 0.76, radius * 0.34).fill({
      color: 0xff7a1a,
      alpha: 0.04 + pulse * 0.025,
    });
    g.ellipse(x + flickerX, y - 1, 5, 11 + Math.sin(phase * 2.2) * 2).fill({
      color: 0xff7a1a,
      alpha: 0.2,
    });
    g.rect(x - 1 + flickerX, y - 11, 2, 6).fill({
      color: 0xffd45a,
      alpha: 0.18 + pulse * 0.08,
    });
  }

  function drawGateFx() {
    if (!pixi) return;
    const g = pixi.gateFx;
    const t = pixi.portalPulse;
    g.clear();
    if (state.scene !== "camp") return;

    for (let i = 0; i < 4; i += 1) {
      const phase = t + i * 0.8;
      const alpha = 0.12 + Math.sin(phase) * 0.04;
      g.ellipse(512, 96, 36 + i * 10 + Math.sin(phase) * 3, 46 + i * 8).stroke({
        width: 2,
        color: i % 2 === 0 ? 0x42d6c5 : 0x9b6cff,
        alpha,
      });
    }

    for (let i = 0; i < 8; i += 1) {
      const x = 468 + ((i * 23 + Math.sin(t + i) * 10) % 92);
      const y = 56 + ((i * 31 + Math.cos(t * 1.4 + i) * 14) % 86);
      g.rect(x, y, 4, 12).fill({ color: i % 2 === 0 ? 0x42d6c5 : 0xf0a94b, alpha: 0.24 });
    }
  }

  function drawCampfireFx() {
    if (!pixi?.campfireFx) return;
    const g = pixi.campfireFx;
    const t = pixi.portalPulse;
    const campfire = getCampfireFlameAnchor();

    g.clear();
    if (state.scene !== "camp") return;
    drawCampfireFlame(g, campfire.x, campfire.y, t);
  }

  function updateCampfireCompanions() {
    if (!pixi?.campfireCompanions) return;
    pixi.campfireCompanions.visible = state.scene === "camp";
    if (state.scene !== "camp") return;

    pixi.campfireCompanions.children.forEach((sprite) => {
      const breath = 1 + Math.sin(pixi.portalPulse * 1.8 + sprite.phase) * 0.018;
      const sway = Math.sin(pixi.portalPulse * 1.2 + sprite.phase) * 0.006;
      sprite.scale.x = sprite.baseScaleX * (1 - (breath - 1) * 0.45);
      sprite.scale.y = sprite.baseScaleY * breath;
      sprite.y = sprite.baseY + Math.sin(pixi.portalPulse * 1.55 + sprite.phase) * 0.35;
      sprite.rotation = sway;
    });
  }

  function getCampfireFlameAnchor() {
    return {
      x: CAMPFIRE_SCENE.x + (CAMPFIRE_SCENE.flameOffsetX || 0),
      y: CAMPFIRE_SCENE.y + (CAMPFIRE_SCENE.flameOffsetY || -44),
    };
  }

  function drawCampfireFlame(g, x, y, t) {
    const pulse = 0.48 + Math.sin(t * 4.2) * 0.12;

    g.circle(x, y + 10, 34 + Math.sin(t * 2.7) * 4).fill({
      color: 0xf0a94b,
      alpha: 0.08 + pulse * 0.08,
    });
    g.ellipse(x, y + 8, 17, 26 + Math.sin(t * 5.4) * 4).fill({
      color: 0xff7a1a,
      alpha: 0.18,
    });
    g.ellipse(x + Math.sin(t * 3) * 3, y, 9, 18).fill({
      color: 0xffd45a,
      alpha: 0.24,
    });

    for (let i = 0; i < 5; i += 1) {
      const drift = (t * 18 + i * 11) % 34;
      const emberX = x - 16 + i * 8 + Math.sin(t * 2 + i) * 4;
      const emberY = y - 8 - drift;
      g.rect(emberX, emberY, 2, 4).fill({ color: 0xf0a94b, alpha: 0.28 * (1 - drift / 34) });
    }
  }

  function drawDestinationMarker() {
    if (!pixi) return;
    const g = pixi.destinationMarker;
    g.clear();
    const target = state.player.moveTarget;
    if (!target) return;

    const pulse = 0.5 + Math.sin(pixi.portalPulse * 3) * 0.18;
    g.ellipse(target.x, target.y + 8, 24, 8).stroke({ width: 2, color: 0xf0a94b, alpha: pulse });
    g.moveTo(target.x, target.y - 20)
      .lineTo(target.x + 10, target.y - 8)
      .lineTo(target.x, target.y + 4)
      .lineTo(target.x - 10, target.y - 8)
      .closePath()
      .fill({ color: 0xf0a94b, alpha: 0.35 + pulse * 0.2 });
  }

  function drawInteractRing() {
    if (!pixi) return;
    const g = pixi.interactRing;
    g.clear();
    const npc = getNearbyNpc();
    if (!npc) return;
    const pulse = 0.55 + Math.sin(pixi.portalPulse * 2) * 0.18;
    const ringY = npc.y + (npc.hiddenSprite ? 8 : 22);
    const markerTop = npc.y + (npc.hiddenSprite ? -42 : -74);
    g.ellipse(npc.x, ringY, npc.hiddenSprite ? 34 : 46, npc.hiddenSprite ? 10 : 14).stroke({
      width: 3,
      color: npc.color,
      alpha: pulse,
    });
    g.moveTo(npc.x, markerTop)
      .lineTo(npc.x + 9, markerTop + 13)
      .lineTo(npc.x, markerTop + 26)
      .lineTo(npc.x - 9, markerTop + 13)
      .closePath()
      .fill({ color: npc.color, alpha: 0.68 });
  }

  function updateGateStatusLabel() {
    if (!pixi?.gateStatusLabel) return;
    if (state.scene !== "camp") {
      pixi.gateStatusLabel.visible = false;
      return;
    }
    pixi.gateStatusLabel.visible = true;
    const hero = getSelectedHero();
    const run = hero ? adapter.getRun(hero.id) : null;

    pixi.gateStatusLabel.x = 512;
    pixi.gateStatusLabel.y = 42 + Math.sin(pixi.portalPulse * 1.4) * 1.2;

    if (!hero) {
      pixi.gateStatusLabel.text = "Gate Dormant";
      pixi.gateStatusLabel.style.fill = "#42d6c5";
      return;
    }

    if (!run) {
      pixi.gateStatusLabel.text = `${hero.name}: Ready`;
      pixi.gateStatusLabel.style.fill = "#f0a94b";
      return;
    }

    if (run.active) {
      pixi.gateStatusLabel.text = `Floor ${run.floor} / ${run.hp} HP`;
      pixi.gateStatusLabel.style.fill = "#42d6c5";
      return;
    }

    if (run.hp <= 0) {
      pixi.gateStatusLabel.text = "Run Failed";
      pixi.gateStatusLabel.style.fill = "#e06758";
      return;
    }

    pixi.gateStatusLabel.text = `${run.loot} Shards Safe`;
    pixi.gateStatusLabel.style.fill = "#f0a94b";
  }

  function updateStoryMarker() {
    if (!pixi?.attentionMarkers) return;

    const hero = getSelectedHero();
    const story = hero ? getUnreadAdventureStory(hero.id) : null;
    const run = hero ? adapter.getRun(hero.id) : null;
    const showWardenMarker = Boolean(state.scene === "camp" && story && !run?.active);
    updateNpcAttentionMarker("warden", showWardenMarker);

    const roomId = Number(elements.arenaRoomId.value.trim() || state.arena.lastRoomId || 0);
    const arenaStory = roomId ? getUnreadArenaStory(roomId) : null;
    const showArenaMarker = Boolean(state.scene === "arena" && arenaStory);
    updateNpcAttentionMarker("arena-master", showArenaMarker);
  }

  function updateNpcAttentionMarker(npcId, visible) {
    const marker = pixi.attentionMarkers.get(npcId);
    if (!marker) return;
    const npc = NPCS.find((item) => item.id === npcId);
    if (!visible || !npc || !isNpcInCurrentScene(npc)) {
      marker.visible = false;
      return;
    }

    marker.visible = true;
    marker.x = npc.x;
    marker.y = npc.y + (npc.markerY ?? (npc.hiddenSprite ? -68 : -112)) + Math.sin(pixi.portalPulse * 3.1) * 6;
    marker.rotation = Math.sin(pixi.portalPulse * 2.4) * 0.06;
    marker.scale.set(1 + Math.sin(pixi.portalPulse * 4.2) * 0.08);
  }

  function spawnFloatingEvent(type, message) {
    if (!pixi?.floatingLayer) return;
    if (type === "system") return;

    const anchor = getFloatingAnchor(message);
    const text = getFloatingText(type, message);
    if (!text) return;
    const color = getFloatingColor(type);
    spawnFloatingText(text, anchor.x, anchor.y, color);
  }

  function clearFloatingTexts() {
    if (!pixi?.floatingTexts) return;
    pixi.floatingTexts.forEach((item) => item.label.destroy());
    pixi.floatingTexts = [];
  }

  function getFloatingAnchor(message) {
    const lower = message.toLowerCase();
    if (lower.includes("market") || lower.includes("btc")) return { x: 512, y: 278 };
    if (lower.includes("forge") || lower.includes("weapon")) return { x: 795, y: 420 };
    if (lower.includes("generated") || lower.includes("hero request") || lower.includes("on-chain hero")) {
      return { x: state.player.x, y: state.player.y - 86 };
    }
    if (
      lower.includes("gate") ||
      lower.includes("floor") ||
      lower.includes("retreated") ||
      lower.includes("returned") ||
      lower.includes("defeated")
    ) {
      return { x: 512, y: 238 };
    }
    return { x: state.player.x, y: state.player.y - 78 };
  }

  function getFloatingText(type, message) {
    const lower = message.toLowerCase();
    if (lower.includes("generated")) return "Hero recruited";
    if (lower.includes("crafted")) return "Weapon forged";
    if (lower.includes("banked")) return "Shards banked";
    if (lower.includes("entered floor")) return "Gate opened";
    if (lower.includes("floor") && lower.includes("cleared")) {
      const loot = message.match(/Loot \+(\d+)/i);
      return loot ? `+${loot[1]} shards` : "Floor cleared";
    }
    if (lower.includes("continues")) return "Deeper";
    if (lower.includes("returned safely") || lower.includes("retreated")) return "Loot secured";
    if (lower.includes("defeated") || lower.includes("broke")) return "Defeated";
    if (type === "danger") return "Failed";
    if (type === "reward") return "Reward";
    return "";
  }

  function getFloatingColor(type) {
    if (type === "danger") return 0xe06758;
    if (type === "reward") return 0xf0a94b;
    return 0x42d6c5;
  }

  function spawnFloatingText(text, x, y, color) {
    const label = new PIXI.Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: 15,
        fontWeight: "700",
        fill: `#${color.toString(16).padStart(6, "0")}`,
        stroke: { color: "#050707", width: 5 },
        align: "center",
      },
    });
    label.anchor.set(0.5);
    label.resolution = 2;
    label.x = x;
    label.y = y;

    pixi.floatingLayer.addChild(label);
    pixi.floatingTexts.push({
      label,
      startY: y,
      life: 132,
      maxLife: 132,
      wobble: Math.random() * Math.PI * 2,
    });
  }

  function spawnArenaFightAnimation(fight) {
    if (!pixi?.floatingLayer || state.scene !== "arena") return;

    const leftHero = state.heroes.find((hero) => hero.id === fight.winnerHeroId) || getSelectedHero();
    const rightHero = state.heroes.find((hero) => hero.id === fight.loserHeroId) || getSelectedHero();
    const centerX = 512;
    const centerY = 362;
    const c = new PIXI.Container();
    c.x = centerX;
    c.y = centerY;
    c.life = 168;

    const left = buildArenaFighter(leftHero, -86, 0, "right");
    const right = buildArenaFighter(rightHero, 86, 0, "left");
    const cloud = buildFightCloud();
    const slash = new PIXI.Graphics();
    slash.label = "arena-slash";
    slash.alpha = 0;
    const impacts = new PIXI.Graphics();
    impacts.label = "arena-impacts";

    c.addChild(left, right, cloud, slash, impacts);
    pixi.floatingLayer.addChild(c);

    const item = {
      label: c,
      startY: centerY,
      life: 168,
      maxLife: 168,
      wobble: 0,
      arenaFight: { left, right, cloud, slash, impacts },
    };
    pixi.floatingTexts.push(item);
  }

  function buildFightCloud() {
    if (textures.fightCloud) {
      const sprite = new PIXI.Sprite(textures.fightCloud);
      sprite.anchor.set(0.5);
      sprite.scale.set(0.19);
      sprite.y = -16;
      sprite.alpha = 0;
      return sprite;
    }

    const g = new PIXI.Graphics();
    g.alpha = 0;
    g.ellipse(0, -16, 92, 54).fill({ color: 0xf8f2df, alpha: 0.96 });
    g.circle(-48, -28, 38).fill({ color: 0xffffff, alpha: 0.9 });
    g.circle(8, -44, 44).fill({ color: 0xffffff, alpha: 0.92 });
    g.circle(58, -22, 34).fill({ color: 0xf0eee4, alpha: 0.94 });
    g.ellipse(0, 30, 86, 34).fill({ color: 0xd8dee2, alpha: 0.52 });
    return g;
  }

  function buildArenaFighter(hero, x, y, dir) {
    const c = new PIXI.Container();
    const heroClass = hero ? getClass(hero.classId) : CLASS_DEFS[0];
    const frames = textures.playerFrames?.[dir] || textures.playerFrames?.down || [];
    const sprite = new PIXI.Sprite(frames[1] || frames[0] || PIXI.Texture.EMPTY);
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(0.26);
    sprite.tint = heroClass.color;
    sprite.y = 8;

    const shadow = new PIXI.Graphics();
    shadow.ellipse(0, 10, 18, 5).fill({ color: 0x000000, alpha: 0.35 });

    const label = buildWorldLabel(hero ? hero.name : "Fighter", heroClass.color);
    label.y = -66;
    c.x = x;
    c.y = y;
    c.addChild(shadow, sprite, label);
    return c;
  }

  function updateFloatingTexts(delta) {
    if (!pixi?.floatingTexts) return;

    for (let i = pixi.floatingTexts.length - 1; i >= 0; i -= 1) {
      const item = pixi.floatingTexts[i];
      item.life -= delta;
      const age = item.maxLife - item.life;
      if (item.arenaFight) {
        updateArenaFightAnimation(item, age);
      } else {
        item.label.y = item.startY - age * 0.42;
        item.label.x += Math.sin(age * 0.08 + item.wobble) * 0.12;
      }
      item.label.alpha = clamp(item.life / 28, 0, 1);

      if (item.life <= 0) {
        item.label.destroy();
        pixi.floatingTexts.splice(i, 1);
      }
    }
  }

  function updateArenaFightAnimation(item, age) {
    const { left, right, cloud, slash, impacts } = item.arenaFight;
    const clash = Math.min(1, age / 46);
    const recoil = age > 78 ? Math.min(1, (age - 78) / 30) : 0;
    left.x = -86 + clash * 52 - recoil * 18;
    right.x = 86 - clash * 52 + recoil * 34;
    left.y = Math.sin(age * 0.22) * 2;
    right.y = Math.cos(age * 0.2) * 2;

    const cloudIn = clamp(age / 18, 0, 1);
    const cloudOut = age > 124 ? clamp(1 - (age - 124) / 34, 0, 1) : 1;
    const cloudPulse = 1 + Math.sin(age * 0.24) * 0.035;
    const fighterAlpha = age < 116 ? 1 - cloudIn * cloudOut * 0.9 : 1;
    left.alpha = fighterAlpha;
    right.alpha = fighterAlpha;
    cloud.alpha = cloudIn * cloudOut;
    cloud.x = Math.sin(age * 0.55) * 5 + Math.sin(age * 0.17) * 3;
    cloud.y = -16 + Math.cos(age * 0.49) * 3;
    cloud.rotation = Math.sin(age * 0.16) * 0.035;
    cloud.scale.set(0.18 + cloudIn * 0.02 + cloudPulse * 0.006);

    slash.clear();
    impacts.clear();
    if (age > 20 && age < 130) {
      drawFightImpacts(impacts, age);
    }

    if (age > 36 && age < 104) {
      slash.alpha = Math.sin(((age - 36) / 68) * Math.PI) * 0.58;
      slash.moveTo(-30, -58).lineTo(34, 10).stroke({ width: 5, color: 0xf0a94b, alpha: 0.75 });
      slash.moveTo(28, -56).lineTo(-34, 12).stroke({ width: 3, color: 0x42d6c5, alpha: 0.62 });
    } else {
      slash.alpha = 0;
    }
  }

  function drawFightImpacts(g, age) {
    const burst = Math.sin(age * 0.36);
    const sparks = [
      { x: -112, y: -56, color: 0xf0a94b, phase: 0 },
      { x: 112, y: -48, color: 0x42d6c5, phase: 1.3 },
      { x: -88, y: 42, color: 0xdfe7dd, phase: 2.4 },
      { x: 90, y: 36, color: 0xf8d790, phase: 3.2 },
    ];

    sparks.forEach((spark, index) => {
      const pulse = 0.48 + Math.sin(age * 0.21 + spark.phase) * 0.32;
      const alpha = clamp(pulse, 0.18, 0.86);
      const x = spark.x + Math.sin(age * 0.12 + index) * 12;
      const y = spark.y + Math.cos(age * 0.15 + index) * 8;
      const size = 6 + pulse * 8;
      g.moveTo(x, y - size)
        .lineTo(x + size * 0.34, y - size * 0.34)
        .lineTo(x + size, y)
        .lineTo(x + size * 0.34, y + size * 0.34)
        .lineTo(x, y + size)
        .lineTo(x - size * 0.34, y + size * 0.34)
        .lineTo(x - size, y)
        .lineTo(x - size * 0.34, y - size * 0.34)
        .closePath()
        .fill({ color: spark.color, alpha });
    });

    g.circle(-138 + burst * 8, 4, 6).fill({ color: 0xf8f2df, alpha: 0.54 });
    g.circle(136 - burst * 8, 10, 7).fill({ color: 0xf8f2df, alpha: 0.5 });
    g.circle(-106, -84, 4).fill({ color: 0xffffff, alpha: 0.42 });
    g.circle(118, -76, 4).fill({ color: 0xffffff, alpha: 0.42 });
  }

  function drawWorld(layer) {
    if (textures.world) {
      textures.world.source.scaleMode = "nearest";
      const background = new PIXI.Sprite(textures.world);
      background.width = PIXI_WIDTH;
      background.height = PIXI_HEIGHT;
      layer.addChild(background);
      return background;
    }

    const fallback = new PIXI.Graphics();
    fallback.rect(0, 0, PIXI_WIDTH, PIXI_HEIGHT).fill(0x071013);
    fallback.rect(0, 118, PIXI_WIDTH, 522).fill(0x17201b);
    layer.addChild(fallback);
    return null;
  }

  function drawObjects(layer) {
    const vignette = new PIXI.Graphics();
    vignette.rect(0, 0, PIXI_WIDTH, PIXI_HEIGHT).stroke({ width: 2, color: 0x263331, alpha: 0.85 });
    layer.addChild(vignette);
  }

  function applySceneVisuals() {
    if (!pixi) return;
    const scene = getSceneConfig();
    const backgroundTexture = textures[scene.textureKey];

    if (pixi.worldBackground && backgroundTexture && pixi.worldBackground.texture !== backgroundTexture) {
      backgroundTexture.source.scaleMode = "nearest";
      pixi.worldBackground.texture = backgroundTexture;
      pixi.worldBackground.width = PIXI_WIDTH;
      pixi.worldBackground.height = PIXI_HEIGHT;
    }

    if (pixi.campfireScene) {
      pixi.campfireScene.visible = state.scene === "camp";
    }
  }

  function getSceneConfig(sceneId = state.scene) {
    return SCENE_CONFIG[sceneId] || SCENE_CONFIG.camp;
  }

  function getSceneBounds() {
    return getSceneConfig().bounds;
  }

  function getSceneObstacles() {
    return getSceneConfig().obstacles || [];
  }

  function getCurrentNpcs() {
    return NPCS.filter(isNpcInCurrentScene);
  }

  function isNpcInCurrentScene(npc) {
    return (npc.scene || "camp") === state.scene;
  }

  function handleSceneTransition() {
    const scene = getSceneConfig();
    const exit = scene.exits?.find(
      (item) =>
        state.player.x >= item.xMin &&
        state.player.x <= item.xMax &&
        state.player.y >= item.yMin &&
        state.player.y <= item.yMax,
    );
    if (!exit) return;

    switchScene(exit.to, exit.spawn, exit.message);
  }

  function switchScene(sceneId, spawn, message) {
    if (!SCENE_CONFIG[sceneId] || state.scene === sceneId) return;

    state.scene = sceneId;
    state.player.x = spawn.x;
    state.player.y = spawn.y;
    state.player.dir = spawn.dir || state.player.dir;
    state.player.moving = false;
    state.nearbyNpcId = null;
    closeDialogue();
    clearAutoMove();
    applySceneVisuals();
    addEvent("system", message || `Entered ${getSceneConfig().name}.`);
    renderAll();
  }

  function drawTent(g, x, y, fabric, trim) {
    g.moveTo(x, y - 48).lineTo(x - 68, y + 42).lineTo(x + 68, y + 42).closePath().fill(fabric);
    g.moveTo(x, y - 48).lineTo(x - 24, y + 42).lineTo(x + 24, y + 42).closePath().fill(0x131617);
    g.poly([x - 68, y + 42, x + 68, y + 42, x + 54, y + 58, x - 54, y + 58]).fill(0x0e1112);
    g.lineStyle({ width: 4, color: trim, alpha: 0.75 });
    g.moveTo(x, y - 46).lineTo(x - 68, y + 42);
    g.moveTo(x, y - 46).lineTo(x + 68, y + 42);
  }

  function drawForge(g, x, y) {
    g.rect(x - 58, y - 34, 116, 54).fill(0x252b2c).stroke({ width: 3, color: 0x101313 });
    g.rect(x - 40, y - 58, 80, 30).fill(0x3a2d24);
    g.rect(x - 26, y - 46, 52, 18).fill(0xf0a94b);
    g.circle(x + 54, y - 58, 18).fill(0x454c4a);
    g.rect(x + 43, y - 62, 42, 8).fill(0x77746d);
  }

  function drawCrateStack(g, x, y) {
    for (let i = 0; i < 5; i += 1) {
      const cx = x + (i % 2) * 36;
      const cy = y - Math.floor(i / 2) * 32;
      g.rect(cx, cy, 34, 30).fill(0x5a4028).stroke({ width: 2, color: 0x24180e });
      g.lineStyle({ width: 2, color: 0x24180e, alpha: 0.5 });
      g.moveTo(cx, cy).lineTo(cx + 34, cy + 30);
      g.moveTo(cx + 34, cy).lineTo(cx, cy + 30);
    }
  }

  function drawWell(g, x, y) {
    g.ellipse(x, y, 52, 24).fill(0x121719).stroke({ width: 5, color: 0x59605a });
    g.ellipse(x, y - 2, 32, 12).fill(0x0a0e10);
    g.rect(x - 42, y - 86, 10, 76).fill(0x3b2b1e);
    g.rect(x + 32, y - 86, 10, 76).fill(0x3b2b1e);
    g.rect(x - 50, y - 90, 100, 10).fill(0x4b3726);
  }

  function drawMarketTable(g, x, y) {
    g.rect(x - 68, y - 18, 136, 36).fill(0x5a4028).stroke({ width: 3, color: 0x25180d });
    g.rect(x - 58, y - 32, 34, 18).fill(0x42d6c5);
    g.rect(x - 12, y - 34, 34, 20).fill(0xf0a94b);
    g.rect(x + 32, y - 30, 34, 16).fill(0x9b6cff);
  }

  function drawGateMarkers(g) {
    for (let i = 0; i < 6; i += 1) {
      const x = 300 + i * 84;
      g.rect(x, 314, 18, 52).fill(0x293231).stroke({ width: 2, color: 0x111515 });
      g.circle(x + 9, 306, 10).fill(i % 2 === 0 ? 0x42d6c5 : 0xf0a94b);
    }
  }

  function buildCampfireScene() {
    if (!textures.campfire) return null;

    const sprite = new PIXI.Sprite(textures.campfire);
    sprite.anchor.set(0.5, 1);
    sprite.x = CAMPFIRE_SCENE.x;
    sprite.y = CAMPFIRE_SCENE.y;
    sprite.scale.set(CAMPFIRE_SCENE.scale);
    sprite.alpha = 0.94;
    sprite.roundPixels = true;
    return sprite;
  }

  function buildCampfireCompanions() {
    const c = new PIXI.Container();
    const sceneLeft = CAMPFIRE_SCENE.x - (CAMPFIRE_SCENE.width * CAMPFIRE_SCENE.scale) / 2;
    const sceneTop = CAMPFIRE_SCENE.y - CAMPFIRE_SCENE.height * CAMPFIRE_SCENE.scale;

    CAMPFIRE_COMPANIONS.forEach((companion) => {
      const texture = textures.campfireNpcs?.[companion.texture];
      if (!texture) return;
      const sprite = new PIXI.Sprite(texture);
      sprite.label = companion.id;
      sprite.anchor.set(0.5, 1);
      sprite.x = sceneLeft + (companion.sourceX + companion.width / 2) * CAMPFIRE_SCENE.scale;
      sprite.y = sceneTop + (companion.sourceY + companion.height) * CAMPFIRE_SCENE.scale;
      sprite.baseY = sprite.y;
      sprite.phase = companion.phase || 0;
      sprite.scale.set(CAMPFIRE_SCENE.scale);
      sprite.baseScaleX = CAMPFIRE_SCENE.scale;
      sprite.baseScaleY = CAMPFIRE_SCENE.scale;
      sprite.roundPixels = true;
      c.addChild(sprite);
    });

    return c;
  }

  function buildNpcSprite(npc) {
    const c = new PIXI.Container();
    c.x = npc.x;
    c.y = npc.y;
    c.baseY = npc.y;
    c.phase = Math.random() * Math.PI * 2;
    const spriteScale = npc.scale || 0.185;
    const spriteBaseY = npc.spriteBaseY ?? 8;

    const shadow = new PIXI.Graphics();
    shadow.ellipse(0, npc.ringY ?? 8, npc.shadowWidth || 28, npc.shadowHeight || 9).fill({
      color: 0x000000,
      alpha: npc.hiddenSprite ? 0 : 0.36,
    });

    const npcTexture = textures.npcs?.[npc.skin || npc.id];
    if (npc.hiddenSprite) {
      c.addChild(shadow);
    } else if (npcTexture) {
      const sprite = new PIXI.Sprite(npcTexture);
      sprite.label = "npc-agent";
      sprite.anchor.set(0.5, 1);
      sprite.scale.set(spriteScale);
      sprite.baseScaleX = spriteScale;
      sprite.baseScaleY = spriteScale;
      sprite.baseY = spriteBaseY;
      sprite.y = spriteBaseY;
      c.addChild(shadow, sprite);
    } else {
      const g = new PIXI.Graphics();
      g.label = "npc-fallback";
      g.rect(-17, -58, 34, 76).fill(0x232728).stroke({ width: 2, color: npc.color });
      g.circle(0, -64, 18).fill(0xc79b73).stroke({ width: 2, color: 0x0c0f10 });
      g.rect(-20, -82, 40, 18).fill(npc.color);
      g.baseScaleX = 1;
      g.baseScaleY = 1;
      g.baseY = 0;
      c.addChild(shadow, g);
    }

    const hit = new PIXI.Graphics();
    hit.rect(
      -42,
      npc.hitY ?? (npc.hiddenSprite ? -62 : -96),
      84,
      npc.hitHeight ?? (npc.hiddenSprite ? 84 : 116),
    ).fill({ color: 0xffffff, alpha: 0.001 });
    const name = buildWorldLabel(npc.tag, npc.color);
    name.label = "npc-label";
    name.baseY = npc.labelY ?? (npc.hiddenSprite ? -48 : -92);
    name.y = name.baseY;
    c.addChild(hit, name);
    return c;
  }

  function buildWorldLabel(text, color) {
    const label = new PIXI.Text({
      text,
      style: {
        fontFamily: "Courier New",
        fontSize: 13,
        fontWeight: "700",
        fill: `#${color.toString(16).padStart(6, "0")}`,
        stroke: { color: "#050707", width: 4 },
        align: "center",
      },
    });
    label.anchor.set(0.5);
    label.resolution = 2;
    return label;
  }

  function buildStoryMarker() {
    const marker = new PIXI.Text({
      text: "!",
      style: {
        fontFamily: "Courier New",
        fontSize: 34,
        fontWeight: "900",
        fill: "#f0a94b",
        stroke: { color: "#050707", width: 6 },
        align: "center",
      },
    });
    marker.anchor.set(0.5);
    marker.resolution = 2;
    marker.visible = false;
    return marker;
  }

  function buildPlayerSprite() {
    const c = new PIXI.Container();
    c.x = state.player.x;
    c.y = state.player.y;

    const shadow = new PIXI.Graphics();
    shadow.label = "player-shadow";
    shadow.ellipse(0, 4, 18, 5).fill({ color: 0x000000, alpha: 0.34 });
    shadow.baseY = 4;

    if (textures.playerFrames?.down?.[0]) {
      const animated = new PIXI.Sprite(textures.playerFrames.down[0]);
      animated.label = "animated-player";
      animated.anchor.set(0.5, 1);
      animated.scale.set(0.31);
      animated.baseScaleX = 0.31;
      animated.baseScaleY = 0.31;
      animated.baseY = 8;
      animated.y = 8;

      c.addChild(shadow, animated);
      return c;
    }

    const legs = new PIXI.Graphics();
    legs.rect(-12, 15, 8, 22).fill(0x111415);
    legs.rect(4, 15, 8, 22).fill(0x111415);
    legs.baseY = 0;

    const body = new PIXI.Graphics();
    body.rect(-18, -18, 36, 40).fill(0x2d3335).stroke({ width: 2, color: 0x0b0d0e });
    body.rect(-22, -7, 44, 18).fill(0x171d1e);
    body.baseY = 0;

    const accent = new PIXI.Graphics();
    accent.label = "accent";
    accent.rect(-20, -22, 40, 8).fill(0xffffff);
    accent.rect(-5, -18, 10, 40).fill(0xffffff);
    accent.baseY = 0;

    const head = new PIXI.Graphics();
    head.circle(0, -34, 17).fill(0xc79b73).stroke({ width: 2, color: 0x0b0d0e });
    head.rect(-12, -45, 24, 7).fill(0x161819);
    head.baseY = 0;

    const portraitFrame = new PIXI.Graphics();
    portraitFrame.label = "portrait-frame";
    portraitFrame.roundRect(-18, -54, 36, 36, 4).fill(0x42d6c5);
    portraitFrame.roundRect(-15, -51, 30, 30, 3).fill(0x0b0d0e);
    portraitFrame.baseY = 0;

    const portrait = new PIXI.Sprite(textures[1]);
    portrait.label = "hero-portrait";
    portrait.anchor.set(0.5);
    portrait.x = 0;
    portrait.y = -36;
    portrait.width = 28;
    portrait.height = 28;
    portrait.baseY = -36;

    c.addChild(shadow, legs, body, accent, head, portraitFrame, portrait);
    return c;
  }

  function handleCanvasClick(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * PIXI_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * PIXI_HEIGHT;
    handleWorldTap(x, y);
  }

  function handleWorldTap(x, y) {
    const npc = findNpcNear(x, y, 58);
    if (npc) {
      handleNpcTap(npc);
      return;
    }

    setMoveTarget(x, y, null);
    closeDialogue();
  }

  function handleNpcTap(npc) {
    const distance = Math.hypot(state.player.x - npc.x, state.player.y - npc.y);
    if (distance <= getNpcInteractDistance(npc)) {
      clearAutoMove();
      state.nearbyNpcId = npc.id;
      openDialogue(npc);
      return;
    }

    const target = getNpcApproachPoint(npc);
    setMoveTarget(target.x, target.y, npc.id);
    closeDialogue();
  }

  function setMoveTarget(x, y, npcId) {
    const bounds = getSceneBounds();
    const target = {
      x: clamp(x, bounds.minX, bounds.maxX),
      y: clamp(y, bounds.minY, bounds.maxY),
    };

    if (isBlocked(target.x, target.y)) return;

    state.player.moveTarget = target;
    state.player.queuedNpcId = npcId;
  }

  function clearAutoMove() {
    state.player.moveTarget = null;
    state.player.queuedNpcId = null;
  }

  function getNpcApproachPoint(npc) {
    if (npc.approach) return { x: npc.x + npc.approach.x, y: npc.y + npc.approach.y };
    if (npc.hiddenSprite) return { x: npc.x, y: npc.y + 46 };
    if (npc.id === "oracle") return { x: npc.x, y: npc.y + 76 };
    if (npc.id === "blacksmith") return { x: npc.x - 66, y: npc.y - 44 };
    return { x: npc.x, y: npc.y + 64 };
  }

  function openNearbyDialogue() {
    const npc = getNearbyNpc();
    if (!npc) return;
    openDialogue(npc);
  }

  function openDialogue(npc) {
    state.activeNpcId = npc.id;
    elements.dialogue.classList.remove("is-hidden");
    renderDialogue();
    renderNearby();
  }

  function closeDialogue() {
    state.activeNpcId = null;
    stopDialogueAnimation();
    elements.dialogue.classList.add("is-hidden");
    renderNearby();
  }

  function openGameScreen(screenId) {
    const titles = {
      recruiter: ["Call a Hero", "Recruiter"],
      guildmaster: ["Roster", "Guildmaster"],
      blacksmith: ["Forge", "Blacksmith"],
      arena: ["Challenges", "Arena Master"],
      chronicle: ["Ledger", "Camp Chronicle"],
    };
    const [title, kicker] = titles[screenId] || titles.chronicle;
    state.activeScreen = screenId;
    closeDialogue();
    elements.gameScreenTitle.textContent = title;
    elements.gameScreenKicker.textContent = kicker;
    elements.screenPages.forEach((page) => {
      page.classList.toggle("is-active", page.id === `screen-${screenId}`);
    });
    elements.gameScreen.classList.remove("is-hidden");
    if (screenId === "arena") queueArenaRoomSync();
    renderAll();
  }

  function closeGameScreen() {
    state.activeScreen = null;
    elements.gameScreen.classList.add("is-hidden");
  }

  function openAdventureStory(hero, story) {
    state.seenStories.add(getStoryKey(hero.id, story));
    elements.storyTitle.textContent = `${hero.name}'s Gate Legend`;
    elements.storySource.textContent = "Warden's Chronicle";
    elements.storyModal.classList.remove("is-hidden");
    startStoryAnimation(cleanLegendText(story.story));
  }

  function openArenaStory(roomId, story) {
    state.arena.seenStories.add(getArenaStoryKey(roomId, story));
    elements.storyTitle.textContent = `Challenge ${roomId} Legend`;
    elements.storySource.textContent = "Arena Master's Chronicle";
    elements.storyModal.classList.remove("is-hidden");
    const fight = state.arena.lastFight?.roomId === Number(roomId) ? state.arena.lastFight : null;
    const resultLine = fight ? `${arenaFightMessage(fight)}\n\n` : "";
    startStoryAnimation(`${resultLine}${cleanLegendText(story.story || story)}`);
  }

  function closeStoryModal() {
    stopStoryAnimation();
    elements.storyModal.classList.add("is-hidden");
    renderAll();
  }

  function cleanLegendText(value) {
    return String(value || "")
      .replace(/^\s*ROUTE\s*=\s*[PSps]+\s*/gm, "")
      .replace(/\bROUTE\s*=\s*[PSps]+\b/g, "")
      .replace(/^\s*STORY\s*=\s*/i, "")
      .replace(/^<+|>+$/g, "")
      .trim();
  }

  async function performNpcAction(npcId) {
    if (state.connection.busy) return;

    if (npcId === "recruiter") {
      openGameScreen("recruiter");
      return;
    }

    if (npcId === "guildmaster") {
      openGameScreen("guildmaster");
      return;
    }

    if (npcId === "camp-mira" || npcId === "camp-brann") {
      const npc = getActiveNpc();
      addEvent("system", npc?.actionEvent || "The campfire crackles under the ruined wall.");
      renderAll();
      return;
    }

    if (npcId === "sogent-gate") {
      const npc = getActiveNpc();
      addEvent("system", npc?.actionEvent || "The Gate of Sogent hums beneath the ruined arch.");
      renderAll();
      return;
    }

    if (npcId === "oracle") {
      state.connection.busy = true;
      state.connection.message = "Reading the hidden omen...";
      renderAll();
      try {
        await adapter.updateMarket();
        state.connection.message = "The omen is ready.";
      } catch (error) {
        state.connection.message = normalizeError(error);
        addEvent("danger", state.connection.message);
      } finally {
        state.connection.busy = false;
        renderAll();
      }
      return;
    }

    if (npcId === "warden") {
      const hero = getSelectedHero();
      if (!hero) {
        addEvent("danger", "Gate Warden needs a recruited hero first.");
        renderAll();
        return;
      }
      const run = adapter.getRun(hero.id);
      if (run?.active && run.pendingDecision) {
        addEvent("system", `${hero.name}'s omen is still being read by the Warden.`);
        renderAll();
        return;
      }
      const unreadStory = getUnreadAdventureStory(hero.id);
      if (unreadStory && !run?.active) {
        openAdventureStory(hero, unreadStory);
        renderAll();
        return;
      }
      state.connection.busy = true;
      state.connection.message =
        run?.active && state.connection.mode === "somnia" && adapter.llmGateSupport
          ? "Reading the next gate omen..."
          : run?.active
            ? "Resolving gate floor..."
            : state.connection.mode === "somnia" && adapter.llmGateSupport
              ? "Entering gate and opening the chronicle..."
              : "Starting gate run...";
      renderAll();
      try {
        const events = [];
        if (run?.active) {
          const result = await adapter.resolveGateStep(hero);
          events.push(...result.events);
        } else {
          const entry = await adapter.enterGate(hero.id, hero.name);
          events.push(...entry.events);

          const activeRun = adapter.getRun(hero.id);
          if (activeRun?.active && !entry.pendingDecision && (state.connection.mode !== "somnia" || adapter.llmGateSupport)) {
            state.connection.message =
              state.connection.mode === "somnia" && adapter.llmGateSupport
                ? "Reading the first gate omen..."
                : "Resolving Floor 1...";
            renderConnection();
            const result = await adapter.resolveGateStep(hero);
            events.push(...result.events);
          }
        }
        state.connection.message =
          state.connection.mode === "somnia" && adapter.llmGateSupport
            ? "Gate order confirmed. The Warden is writing the chronicle."
            : state.connection.mode === "somnia"
              ? "Gate transaction confirmed."
              : "Simulation gate action resolved.";
        events.forEach((item) => addEvent(item.type, item.message));
      } catch (error) {
        state.connection.message = normalizeError(error);
        addEvent("danger", state.connection.message);
      } finally {
        state.connection.busy = false;
        renderAll();
      }
      return;
    }

    if (npcId === "blacksmith") {
      openGameScreen("blacksmith");
      return;
    }

    if (npcId === "arena-master") {
      const roomId = Number(elements.arenaRoomId.value.trim() || state.arena.lastRoomId || 0);
      const story = roomId ? getUnreadArenaStory(roomId) : null;
      if (story) {
        openArenaStory(roomId, story);
        renderAll();
        return;
      }
      openGameScreen("arena");
    }
  }

  async function performBlacksmithAction() {
    const inventory = adapter.getInventory ? adapter.getInventory() : {};
    const order = inventory.forgeOrder;
    state.connection.busy = true;
    state.connection.message = order?.active && order.ready ? "Claiming forged weapon..." : "Starting forge order...";
    renderAll();
    try {
      const result = order?.active && order.ready ? await adapter.claimForgeOrder() : await adapter.startForgeOrder();
      state.connection.message =
        state.connection.mode === "somnia" ? "Forge transaction confirmed." : "Simulation forge action resolved.";
      result.events.forEach((item) => addEvent(item.type, item.message));
    } catch (error) {
      state.connection.message = normalizeError(error);
      addEvent("danger", state.connection.message);
    } finally {
      state.connection.busy = false;
      renderAll();
    }
  }

  async function recruitHeroFromInput() {
    if (state.connection.busy) return;

    const typedName = elements.heroName.value.trim();
    const fallback = DEFAULT_NAMES[state.heroes.length % DEFAULT_NAMES.length];
    const name = typedName || `${fallback} ${state.heroes.length + 1}`;

    state.connection.busy = true;
    state.connection.message =
      state.connection.mode === "somnia" ? "Opening recruitment rite on Somnia..." : "Generating simulated hero...";
    renderAll();

    try {
      const result = await adapter.recruitHero(name);

      if (result.hero) {
        addOrReplaceHero(result.hero);
        state.selectedHeroId = result.hero.id;
      }
      elements.heroName.value = "";
      state.connection.message =
        state.connection.mode === "somnia"
          ? "Recruitment rite confirmed."
          : "Simulation hero generated.";

      result.events.forEach((item) => addEvent(item.type, item.message));
    } catch (error) {
      state.connection.message = normalizeError(error);
      addEvent("danger", state.connection.message);
    } finally {
      state.connection.busy = false;
      renderAll();
    }
  }

  function chooseNextHeroAtGuildmaster() {
    if (state.heroes.length === 0) {
      addEvent("danger", "The Guildmaster needs a recruited hero first.");
      renderAll();
      return;
    }

    const currentIndex = state.heroes.findIndex((hero) => hero.id === state.selectedHeroId);
    const nextHero = state.heroes[(currentIndex + 1 + state.heroes.length) % state.heroes.length];
    state.selectedHeroId = nextHero.id;
    addEvent("system", `Guildmaster selected ${nextHero.name} as the active hero.`);
    renderAll();
  }

  async function createArenaRoomFromInput() {
    if (state.connection.busy) return;
    const hero = getSelectedHero();
    if (!hero) {
      addEvent("danger", "Arena Master needs a selected hero first.");
      renderAll();
      return;
    }

    const stake = elements.arenaStake.value.trim() || "0.01";
    state.connection.busy = true;
    state.connection.message = state.connection.mode === "somnia" ? "Posting arena challenge on Somnia..." : "Posting simulated arena challenge...";
    renderAll();

    try {
      const result = await adapter.createArenaRoom(hero, stake);
      if (result.roomId) {
        state.arena.lastRoomId = Number(result.roomId);
        if (state.connection.wallet) {
          state.arena.createdChallengeOwners.set(Number(result.roomId), state.connection.wallet.toLowerCase());
        }
        elements.arenaRoomId.value = String(result.roomId);
        state.arena.mode = "join";
      }
      state.connection.message =
        state.connection.mode === "somnia"
          ? "Challenge posted. Share the challenge id with another wallet."
          : "Simulation arena challenge posted.";
      result.events.forEach((item) => addEvent(item.type, item.message));
    } catch (error) {
      state.connection.message = normalizeError(error);
      addEvent("danger", state.connection.message);
    } finally {
      state.connection.busy = false;
      renderAll();
    }
  }

  async function joinArenaRoomFromInput() {
    if (state.connection.busy) return;
    const hero = getSelectedHero();
    if (!hero) {
      addEvent("danger", "Select the hero who will accept this challenge.");
      renderAll();
      return;
    }

    const roomId = Number(elements.arenaRoomId.value.trim());
    if (!Number.isInteger(roomId) || roomId <= 0) {
      addEvent("danger", "Enter a valid challenge id.");
      renderAll();
      return;
    }

    state.connection.busy = true;
    state.connection.message =
      state.connection.mode === "somnia" ? "Accepting challenge and opening the arena chronicle..." : "Resolving simulated arena challenge...";
    renderAll();

    try {
      const result = await adapter.joinArenaRoom(hero, roomId);
      state.arena.lastRoomId = Number(roomId);
      state.arena.mode = "menu";
      if (result.fight) {
        state.arena.lastFight = decorateArenaFight(result.fight);
        closeGameScreen();
        spawnArenaFightAnimation(result.fight);
      }
      if (result.story) {
        state.arena.pendingStoryRoomId = Number(roomId);
      } else if (result.pendingNarration) {
        state.arena.pendingStoryRoomId = Number(roomId);
      }
      void syncArenaRoomResult(roomId);
      state.connection.message =
        state.connection.mode === "somnia" ? "Arena fight confirmed. The Master is writing the chronicle." : "Simulation arena fight resolved.";
      result.events.forEach((item) => addEvent(item.type, item.message));
    } catch (error) {
      state.connection.message = normalizeError(error);
      addEvent("danger", state.connection.message);
    } finally {
      state.connection.busy = false;
      renderAll();
    }
  }

  async function runDemoArenaFight() {
    if (state.connection.busy) return;
    if (state.connection.mode !== "simulation") {
      addEvent("danger", "Switch to Simulation before running a local demo fight.");
      renderAll();
      return;
    }

    state.connection.busy = true;
    state.connection.message = "Preparing local arena demo...";
    renderAll();

    try {
      if (state.scene !== "arena") {
        switchScene("arena", { x: 512, y: 92, dir: "down" }, "Demo fight moved to the Sogent Arena.");
      }

      while (state.heroes.length < 2) {
        const name = `Demo ${state.heroes.length + 1}`;
        const recruit = await adapter.recruitHero(name);
        if (recruit.hero) {
          addOrReplaceHero(recruit.hero);
          state.selectedHeroId = recruit.hero.id;
        }
        recruit.events.forEach((item) => addEvent(item.type, item.message, { silentFloat: true }));
      }

      const creator = getSelectedHero() || state.heroes[0];
      const challenger = state.heroes.find((hero) => hero.id !== creator.id);
      if (!creator || !challenger) {
        throw new Error("Demo fight needs two different heroes.");
      }

      state.selectedHeroId = creator.id;
      const stake = elements.arenaStake.value.trim() || "0.01";
      const created = await adapter.createArenaRoom(creator, stake);
      const roomId = Number(created.roomId);
      state.arena.lastRoomId = roomId;
      elements.arenaRoomId.value = String(roomId);
      created.events.forEach((item) => addEvent(item.type, item.message, { silentFloat: true }));

      const result = await adapter.joinArenaRoom(challenger, roomId);
      state.selectedHeroId = challenger.id;
      state.arena.lastFight = result.fight ? decorateArenaFight(result.fight) : null;
      clearFloatingTexts();
      if (result.fight) {
        closeGameScreen();
        spawnArenaFightAnimation(result.fight);
      }
      if (result.story || result.pendingNarration) {
        state.arena.pendingStoryRoomId = roomId;
      }
      result.events.forEach((item) => addEvent(item.type, item.message, { silentFloat: true }));
      state.connection.message = "Local demo fight resolved.";
    } catch (error) {
      state.connection.message = normalizeError(error);
      addEvent("danger", state.connection.message);
    } finally {
      state.connection.busy = false;
      renderAll();
    }
  }

  async function equipSelectedWeapon() {
    if (state.connection.busy) return;
    const hero = getSelectedHero();
    if (!hero) {
      addEvent("danger", "Select a hero before equipping a weapon.");
      renderAll();
      return;
    }
    if (!state.selectedWeaponId) {
      addEvent("danger", "Select a forged weapon first.");
      renderAll();
      return;
    }

    state.connection.busy = true;
    state.connection.message =
      state.connection.mode === "somnia" ? "Equipping weapon on Somnia..." : "Equipping simulated weapon...";
    renderAll();

    try {
      const result = await adapter.equipWeapon(hero, state.selectedWeaponId);
      state.connection.message =
        state.connection.mode === "somnia" ? "Weapon equipped on-chain." : "Simulation weapon equipped.";
      result.events.forEach((item) => addEvent(item.type, item.message));
    } catch (error) {
      state.connection.message = normalizeError(error);
      addEvent("danger", state.connection.message);
    } finally {
      state.connection.busy = false;
      renderAll();
    }
  }

  async function transferSelectedWeapon() {
    if (state.connection.busy) return;
    if (!state.selectedWeaponId) {
      addEvent("danger", "Select a forged weapon first.");
      renderAll();
      return;
    }

    const recipient = elements.weaponRecipient.value.trim();
    state.connection.busy = true;
    state.connection.message =
      state.connection.mode === "somnia" ? "Sending weapon NFT..." : "Sending simulated weapon...";
    renderAll();

    try {
      const result = await adapter.transferWeapon(state.selectedWeaponId, recipient);
      elements.weaponRecipient.value = "";
      state.selectedWeaponId = null;
      state.connection.message =
        state.connection.mode === "somnia" ? "Weapon transfer confirmed." : "Simulation weapon sent.";
      result.events.forEach((item) => addEvent(item.type, item.message));
    } catch (error) {
      state.connection.message = normalizeError(error);
      addEvent("danger", state.connection.message);
    } finally {
      state.connection.busy = false;
      renderAll();
    }
  }

  function renderAll() {
    renderNearby();
    renderConnection();
    renderMarket(adapter.peekMarket());
    renderInventory();
    renderArena();
    renderSelectedHero();
    renderHeroes();
    renderDialogue();
    renderLog();
  }

  function renderDialogue() {
    const npc = getActiveNpc();
    if (!npc) return;

    const text = getNpcDialogue(npc);
    renderDialoguePortrait(npc);
    elements.dialogueSpeaker.textContent = npc.name;
    renderDialogueText(npc, text);
    elements.dialogueAction.textContent = getNpcActionLabel(npc);
    elements.dialogueAction.disabled = getNpcActionDisabled(npc);
  }

  function renderDialoguePortrait(npc) {
    const portrait = getDialoguePortrait(npc);
    elements.dialoguePortrait.src = portrait;
    elements.dialoguePortrait.alt = "";
  }

  function getDialoguePortrait(npc) {
    const skin = npc.skin || npc.id;
    const portraits = {
      "camp-mira": "./public/assets/ui/dialogue-portraits/mira.png",
      "camp-brann": "./public/assets/ui/dialogue-portraits/brann.png",
      "sogent-gate": "./public/assets/ui/dialogue-portraits/sogent-gate.png?v=20260610-dialogue2",
      recruiter: "./public/assets/ui/dialogue-portraits/recruiter.png?v=20260610-dialogue2",
      guildmaster: "./public/assets/ui/dialogue-portraits/guildmaster.png?v=20260604-11",
      oracle: "./public/assets/ui/dialogue-portraits/oracle.png?v=20260604-2",
      warden: "./public/assets/ui/dialogue-portraits/warden.png?v=20260610-dialogue2",
      blacksmith: "./public/assets/ui/dialogue-portraits/blacksmith.png",
      "arena-master": "./public/assets/ui/dialogue-portraits/arena-master.png",
    };

    return portraits[skin] || portraits[npc.id] || portraits.recruiter;
  }

  function renderDialogueText(npc, text) {
    const shouldAnimate = shouldAnimateDialogue(npc, text);
    const key = `${npc.id}:${state.selectedHeroId || "none"}:${shouldAnimate ? "animated" : "plain"}:${text}`;
    if (dialogueAnimation.key === key) return;

    stopDialogueAnimation();
    dialogueAnimation.key = key;

    if (!shouldAnimate) {
      elements.dialogueText.classList.remove("is-typing");
      elements.dialogueText.textContent = text;
      return;
    }

    elements.dialogueText.classList.add("is-typing");
    elements.dialogueText.textContent = "";

    const startedAt = performance.now();
    const charsPerSecond = text.length > 220 ? 86 : 64;
    const step = (now) => {
      if (dialogueAnimation.key !== key) return;

      const visibleChars = Math.min(text.length, Math.max(1, Math.floor(((now - startedAt) / 1000) * charsPerSecond)));
      elements.dialogueText.textContent = text.slice(0, visibleChars);

      if (visibleChars < text.length) {
        dialogueAnimation.frameId = requestAnimationFrame(step);
      } else {
        dialogueAnimation.frameId = null;
        elements.dialogueText.classList.remove("is-typing");
      }
    };

    dialogueAnimation.frameId = requestAnimationFrame(step);
  }

  function shouldAnimateDialogue(npc, text) {
    return npc.id === "warden" && text.includes("Route ");
  }

  function finishDialogueAnimation() {
    if (!dialogueAnimation.frameId) return;

    const key = dialogueAnimation.key;
    const text = elements.dialogueText.textContent;
    stopDialogueAnimation();
    dialogueAnimation.key = key;
    elements.dialogueText.classList.remove("is-typing");

    const npc = getActiveNpc();
    if (npc) {
      elements.dialogueText.textContent = getNpcDialogue(npc);
    } else {
      elements.dialogueText.textContent = text;
    }
  }

  function stopDialogueAnimation() {
    if (dialogueAnimation.frameId) {
      cancelAnimationFrame(dialogueAnimation.frameId);
    }
    dialogueAnimation = {
      key: "",
      frameId: null,
    };
    elements.dialogueText.classList.remove("is-typing");
  }

  function startStoryAnimation(text) {
    stopStoryAnimation();
    storyAnimation.key = `${Date.now()}-${text}`;
    storyAnimation.text = text;
    elements.storyText.classList.add("is-typing");
    elements.storyText.textContent = "";

    const key = storyAnimation.key;
    const startedAt = performance.now();
    const charsPerSecond = text.length > 260 ? 78 : 58;
    const step = (now) => {
      if (storyAnimation.key !== key) return;

      const visibleChars = Math.min(text.length, Math.max(1, Math.floor(((now - startedAt) / 1000) * charsPerSecond)));
      elements.storyText.textContent = text.slice(0, visibleChars);

      if (visibleChars < text.length) {
        storyAnimation.frameId = requestAnimationFrame(step);
      } else {
        storyAnimation.frameId = null;
        elements.storyText.classList.remove("is-typing");
      }
    };

    storyAnimation.frameId = requestAnimationFrame(step);
  }

  function finishStoryAnimation() {
    if (!storyAnimation.frameId) return;

    const text = storyAnimation.text;
    stopStoryAnimation();
    elements.storyText.textContent = text;
  }

  function stopStoryAnimation() {
    if (storyAnimation.frameId) {
      cancelAnimationFrame(storyAnimation.frameId);
    }
    storyAnimation = {
      key: "",
      frameId: null,
      text: "",
    };
    elements.storyText.classList.remove("is-typing");
  }

  function renderNearby() {
    const npc = getNearbyNpc();
    const active = getActiveNpc();
    elements.locationName.textContent = getSceneConfig().name;
    elements.nearbyLabel.textContent = active ? active.name : npc ? npc.name : "No one nearby";
    elements.talkButton.disabled = !npc;
  }

  function renderConnection() {
    const {
      mode,
      wallet,
      contractAddress,
      message,
      busy,
      pendingRequests,
    } = state.connection;
    const unlocked = mode === "somnia" && Boolean(wallet);
    elements.appShell.classList.toggle("is-unlocked", unlocked);
    elements.walletMessage.textContent = message;
    elements.connectWallet.disabled = busy || !contractAddress;
    elements.hudWallet.textContent = wallet ? shortAddress(wallet) : "Not connected";
    elements.hudPending.textContent = String(pendingRequests.length);
    elements.heroName.disabled = busy;
    elements.recruitSubmit.disabled = busy;
    elements.pendingCount.textContent = String(pendingRequests.length);
    renderPendingRequests();
  }

  function renderInventory() {
    const inventory = adapter.getInventory ? adapter.getInventory() : { shards: 0, weapons: 0, weaponName: "None" };
    state.forgeCost = inventory.forgeCost || state.forgeCost || WEAPON_SHARD_COST;
    elements.shardCount.textContent = String(inventory.shards);
    elements.weaponCount.textContent = String(inventory.weapons);
    elements.weaponName.textContent = inventory.weaponName || "None";
    elements.hudShards.textContent = String(inventory.shards);
    elements.hudWeapon.textContent = inventory.weaponName || "None";
    renderForgeStatus(inventory);
    renderWeaponList(inventory.weaponItems || []);
  }

  function renderForgeStatus(inventory) {
    const order = inventory.forgeOrder;
    elements.forgeStatus.classList.remove("is-working", "is-ready");
    if (!order?.active) {
      elements.forgeStatus.textContent = "Forge: Idle";
      elements.forgeAction.textContent = `Start Order (${inventory.forgeCost || state.forgeCost} shards)`;
      elements.forgeAction.disabled = state.connection.busy || inventory.shards < (inventory.forgeCost || state.forgeCost);
      return;
    }

    const remaining = Math.max(0, order.readyAt - Date.now());
    if (remaining <= 0) {
      elements.forgeStatus.textContent = `Shard Blade ${order.tier} ready to claim`;
      elements.forgeStatus.classList.add("is-ready");
      elements.forgeAction.textContent = "Claim Weapon";
      elements.forgeAction.disabled = state.connection.busy;
      return;
    }

    elements.forgeStatus.textContent = `Forge working... ${formatCountdown(remaining)}`;
    elements.forgeStatus.classList.add("is-working");
    elements.forgeAction.textContent = "Forge Working";
    elements.forgeAction.disabled = true;
  }

  function renderWeaponList(weapons) {
    const hero = getSelectedHero();
    const equipped = hero && adapter.getEquippedWeapon ? adapter.getEquippedWeapon(hero.id) : null;
    if (!weapons.length) {
      state.selectedWeaponId = null;
      elements.weaponList.innerHTML = `<div class="weapon-empty">No forged weapons yet</div>`;
    } else {
      if (!weapons.some((weapon) => weapon.id === state.selectedWeaponId)) {
        state.selectedWeaponId = weapons[0].id;
      }
      elements.weaponList.innerHTML = "";
      weapons.forEach((weapon) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "weapon-item";
        if (weapon.id === state.selectedWeaponId) button.classList.add("is-selected");
        if (equipped?.id === weapon.id) button.classList.add("is-equipped");
        button.dataset.weaponId = String(weapon.id);
        button.innerHTML = `<strong>${weapon.name || `Shard Blade ${weapon.tier}`}</strong><span>+${weapon.arenaBonus} arena</span>`;
        button.addEventListener("click", () => {
          state.selectedWeaponId = weapon.id;
          renderInventory();
          renderArena();
          renderSelectedHero();
        });
        elements.weaponList.append(button);
      });
    }

    elements.weaponEquip.disabled = state.connection.busy || !hero || !state.selectedWeaponId;
    elements.weaponTransfer.disabled = state.connection.busy || !state.selectedWeaponId;
    elements.weaponRecipient.disabled = state.connection.busy || !state.selectedWeaponId;
  }

  function formatCountdown(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function queueArenaRoomSync() {
    if (arenaRoomSyncTimer) {
      clearTimeout(arenaRoomSyncTimer);
    }
    arenaRoomSyncTimer = setTimeout(() => {
      arenaRoomSyncTimer = null;
      const roomId = Number(elements.arenaRoomId.value.trim() || state.arena.lastRoomId || 0);
      if (Number.isInteger(roomId) && roomId > 0) {
        void syncArenaRoomResult(roomId);
      }
    }, 350);
  }

  async function syncArenaRoomResult(roomId) {
    if (!adapter.getArenaRoomResult || !Number.isInteger(Number(roomId)) || Number(roomId) <= 0) return;
    try {
      const result = await adapter.getArenaRoomResult(Number(roomId));
      if (!result) return;
      state.arena.lastRoomId = Number(roomId);
      if (result.fight) {
        state.arena.lastFight = decorateArenaFight(result.fight);
      }
      if (result.story) {
        state.arena.pendingStoryRoomId = null;
      } else if (result.pendingNarration) {
        state.arena.pendingStoryRoomId = Number(roomId);
      }
      renderAll();
    } catch (error) {
      addEvent("danger", `Arena lookup failed: ${normalizeError(error)}`);
      renderAll();
    }
  }

  function decorateArenaFight(fight) {
    if (!fight) return null;
    const selectedHero = getSelectedHero();
    const winnerHero = state.heroes.find((hero) => hero.id === fight.winnerHeroId);
    const loserHero = state.heroes.find((hero) => hero.id === fight.loserHeroId);
    const account = state.connection.wallet.toLowerCase();
    const accountWon =
      typeof fight.accountWon === "boolean"
        ? fight.accountWon
        : Boolean(fight.winner && account && fight.winner.toLowerCase() === account);
    const accountIsParticipant = Boolean(
      account &&
        ((fight.creator && fight.creator.toLowerCase() === account) ||
          (fight.challenger && fight.challenger.toLowerCase() === account)),
    );
    const selectedHeroLost = selectedHero?.id === fight.loserHeroId;
    const selectedHeroWon = selectedHero?.id === fight.winnerHeroId;

    return {
      ...fight,
      winnerHeroName: fight.winnerHeroName || winnerHero?.name || `Hero ${fight.winnerHeroId}`,
      loserHeroName: fight.loserHeroName || loserHero?.name || `Hero ${fight.loserHeroId}`,
      accountWon,
      accountLost: selectedHeroLost || (accountIsParticipant && !accountWon),
      selectedHeroWon,
      selectedHeroLost,
    };
  }

  function arenaFightMessage(fight, hasStory = false) {
    const decorated = decorateArenaFight(fight);
    if (!decorated) return "";
    const winner = decorated.winnerHeroName || `Hero ${decorated.winnerHeroId}`;
    const loser = decorated.loserHeroName || `Hero ${decorated.loserHeroId}`;
    const selectedHero = getSelectedHero();
    const perspective =
      decorated.selectedHeroWon || decorated.accountWon
        ? "You won."
        : decorated.selectedHeroLost || decorated.accountLost
          ? "You lost."
          : "";
    const storySuffix = hasStory ? " Chronicle ready." : "";
    const selectedPower =
      selectedHero?.id === decorated.creatorHeroId
        ? decorated.creatorPower
        : selectedHero?.id === decorated.challengerHeroId
          ? decorated.challengerPower
          : null;
    const powerText = selectedPower
      ? ` Your power: ${selectedPower}. Fight power: ${decorated.creatorPower} vs ${decorated.challengerPower}.`
      : ` Strength ${decorated.creatorPower} vs ${decorated.challengerPower}.`;

    return `${perspective ? `${perspective} ` : ""}${winner} defeated ${loser} in challenge ${decorated.roomId}.${powerText}${storySuffix}`;
  }

  function renderArena() {
    const hero = getSelectedHero();
    const roomId = Number(elements.arenaRoomId.value.trim() || state.arena.lastRoomId || 0);
    const story = roomId ? getUnreadArenaStory(roomId) : null;
    const lastFight = state.arena.lastFight?.roomId === roomId ? state.arena.lastFight : null;
    const creator = roomId ? state.arena.createdChallengeOwners.get(roomId) : "";
    const createdByCurrentWallet =
      state.connection.mode === "somnia" &&
      Boolean(roomId && creator && state.connection.wallet && creator === state.connection.wallet.toLowerCase());

    elements.arenaCreate.disabled = state.connection.busy || !hero;
    elements.arenaJoin.disabled = state.connection.busy || !hero || !roomId || createdByCurrentWallet;
    elements.arenaRoomStatus.textContent = roomId ? `Challenge ${roomId}` : "No challenge";
    elements.arenaChoice.hidden = state.arena.mode !== "menu";
    elements.arenaCreatePanel.hidden = state.arena.mode !== "create";
    elements.arenaJoinPanel.hidden = state.arena.mode !== "join";
    elements.arenaModeCreate.disabled = state.connection.busy || !hero;
    elements.arenaModeJoin.disabled = state.connection.busy || !hero;

    if (lastFight) {
      elements.arenaMessage.textContent = arenaFightMessage(lastFight, Boolean(story));
      return;
    }
    if (story) {
      elements.arenaMessage.textContent = `Arena Master has a new chronicle for challenge ${roomId}.`;
      return;
    }
    if (state.arena.pendingStoryRoomId === roomId) {
      elements.arenaMessage.textContent = `Challenge ${roomId} resolved. The Arena Master is still writing the chronicle.`;
      return;
    }
    if (!hero) {
      elements.arenaMessage.textContent = "Recruit and select a hero before posting or accepting a challenge.";
      return;
    }
    if (state.arena.mode === "menu") {
      const weapon = adapter.getEquippedWeapon ? adapter.getEquippedWeapon(hero.id) : null;
      const weaponText = weapon ? `${weapon.name} gives +${weapon.arenaBonus} arena power.` : "No weapon equipped.";
      elements.arenaMessage.textContent = `${hero.name} can challenge another player or respond to an existing challenge. ${weaponText}`;
      return;
    }
    if (createdByCurrentWallet) {
      elements.arenaMessage.textContent = `Challenge ${roomId} is posted. Share this id with another wallet; they paste it here, select a hero, and press Accept.`;
      return;
    }
    const weapon = adapter.getEquippedWeapon ? adapter.getEquippedWeapon(hero.id) : null;
    const weaponText = weapon ? `${weapon.name} gives +${weapon.arenaBonus} arena power.` : "No weapon equipped.";
    if (state.arena.mode === "create") {
      elements.arenaMessage.textContent = `${hero.name} will post a wager challenge. ${weaponText}`;
      return;
    }
    elements.arenaMessage.textContent = roomId
      ? `${hero.name} will accept challenge ${roomId}. ${weaponText}`
      : "Paste a challenge id, then accept with the selected hero.";
  }

  function renderPendingRequests() {
    const pending = state.connection.pendingRequests;
    elements.hudPending.textContent = String(pending.length);
    if (pending.length === 0) {
      const row = document.createElement("li");
      row.className = "empty";
      row.textContent = "No pending omens";
      elements.pendingList.replaceChildren(row);
      return;
    }

    const rows = pending.map((request) => {
      const row = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = `${request.name} / Omen ${request.groupId}`;
      const status = document.createElement("span");
      status.textContent = request.txHash ? `Awaiting recruitment after ${shortAddress(request.txHash)}` : request.status;
      row.append(title, status);
      return row;
    });
    elements.pendingList.replaceChildren(...rows);
  }

  async function connectSomniaAdapter() {
    const address = state.connection.contractAddress || DEFAULT_GAME_CONTRACT_ADDRESS.trim();
    state.connection.busy = true;
    state.connection.message = address ? "Connecting wallet..." : "Game contract is not configured yet.";
    renderConnection();

    try {
      if (!address) {
        throw new Error("Game contract is not configured.");
      }
      const contractAdapter = new SomniaContractAdapter({
        contractAddress: address,
        onHeroRequested: handleContractHeroRequest,
        onHeroGenerated: handleContractHero,
        onAgentFailed: handleContractAgentFailure,
        onArenaFight: handleContractArenaFight,
        onArenaStory: handleContractArenaStory,
        onEvent: (type, message) => {
          addEvent(type, message);
          renderAll();
        },
      });

      await contractAdapter.connect();
      adapter = contractAdapter;
      state.connection.mode = "somnia";
      state.connection.wallet = contractAdapter.account;
      state.connection.contractAddress = contractAdapter.contractAddress;
      state.connection.contractVersion = contractAdapter.contractVersion;
      state.connection.gateSupport = contractAdapter.gateSupport;
      state.connection.forgeSupport = contractAdapter.forgeSupport;
      state.connection.llmGateSupport = contractAdapter.llmGateSupport;
      state.connection.arenaSupport = contractAdapter.arenaSupport;
      state.forgeCost = contractAdapter.forgeCost || WEAPON_SHARD_COST;
      state.selectedWeaponId = null;
      state.connection.message = "Connected. Enter Sogent and speak with the camp agents.";

      const loadedHeroes = await contractAdapter.loadOwnerHeroes();
      loadedHeroes.forEach(addOrReplaceHero);
      if (!state.selectedHeroId && loadedHeroes.length > 0) {
        state.selectedHeroId = loadedHeroes[0].id;
      }

      addEvent("system", `Wallet connected on Somnia: ${shortAddress(contractAdapter.account)}.`);
      if (loadedHeroes.length > 0) {
        addEvent("reward", `Loaded ${loadedHeroes.length} on-chain hero${loadedHeroes.length === 1 ? "" : "es"}.`);
      }
      await adapter.updateMarket();
    } catch (error) {
      state.connection.message = normalizeError(error);
      addEvent("danger", state.connection.message);
      adapter = new SimulationGameAdapter();
      state.connection.mode = "simulation";
      state.connection.wallet = "";
      state.connection.contractVersion = "Unknown";
      state.connection.gateSupport = false;
      state.connection.forgeSupport = false;
      state.connection.llmGateSupport = false;
      state.connection.arenaSupport = false;
      state.forgeCost = WEAPON_SHARD_COST;
      state.selectedWeaponId = null;
    } finally {
      state.connection.busy = false;
      renderAll();
    }
  }

  function useSimulationAdapter() {
    adapter = new SimulationGameAdapter();
    state.connection.mode = "simulation";
    state.connection.wallet = "";
    state.connection.contractVersion = "Unknown";
    state.connection.gateSupport = false;
    state.connection.forgeSupport = false;
    state.connection.llmGateSupport = false;
    state.connection.arenaSupport = false;
    state.forgeCost = WEAPON_SHARD_COST;
    state.selectedWeaponId = null;
    state.connection.message = "Camp simulation active. Wallet calls are paused.";
    state.connection.pendingRequests = [];
    addEvent("system", "Returned to local simulation mode.");
    renderAll();
  }

  async function reloadOnChainHeroes() {
    if (state.connection.mode !== "somnia" || !adapter.loadOwnerHeroes) return;

    state.connection.busy = true;
    state.connection.message = "Reloading on-chain heroes...";
    renderConnection();

    try {
      const loadedHeroes = await adapter.loadOwnerHeroes();
      loadedHeroes.forEach(addOrReplaceHero);
      if (!state.selectedHeroId && loadedHeroes.length > 0) {
        state.selectedHeroId = loadedHeroes[0].id;
      }
      state.connection.message = `Reloaded ${loadedHeroes.length} on-chain hero${loadedHeroes.length === 1 ? "" : "es"}.`;
      addEvent("system", state.connection.message);
    } catch (error) {
      state.connection.message = normalizeError(error);
      addEvent("danger", state.connection.message);
    } finally {
      state.connection.busy = false;
      renderAll();
    }
  }

  function handleContractHeroRequest(request) {
    upsertPendingRequest({
      groupId: Number(request.groupId),
      name: request.name,
      txHash: request.txHash || "",
      status: "Awaiting recruitment rite",
    });
    addEvent("system", `Recruitment rite opened for ${request.name}.`);
    renderAll();
  }

  function handleContractHero(hero) {
    removePendingRequest(hero.id);
    addOrReplaceHero(hero);
    state.selectedHeroId = hero.id;
    const heroClass = getClass(hero.classId);
    const heroPortrait = getHeroPortrait(hero);
    const rarity = RARITIES[hero.rarity];
    addEvent("reward", `On-chain hero ready: ${hero.name} as ${rarity.name} ${heroClass.name}.`);
    renderAll();
  }

  function handleContractAgentFailure(details) {
    removePendingRequest(Number(details.groupId));
    addEvent("danger", `Somnia omen failed for group ${details.groupId}.`);
    renderAll();
  }

  function handleContractArenaFight(fight) {
    state.arena.lastRoomId = Number(fight.roomId);
    state.arena.lastFight = decorateArenaFight(fight);
    void syncArenaRoomResult(fight.roomId);
    renderAll();
  }

  function handleContractArenaStory(roomId, story) {
    state.arena.lastRoomId = Number(roomId);
    state.arena.pendingStoryRoomId = null;
    void syncArenaRoomResult(roomId);
    addEvent("reward", `Arena chronicle ready for challenge ${roomId}.`);
    renderAll();
  }

  function addOrReplaceHero(hero) {
    const index = state.heroes.findIndex((item) => item.id === hero.id);
    if (index >= 0) {
      state.heroes[index] = hero;
    } else {
      state.heroes.unshift(hero);
    }
  }

  function upsertPendingRequest(request) {
    const index = state.connection.pendingRequests.findIndex((item) => item.groupId === request.groupId);
    if (index >= 0) {
      state.connection.pendingRequests[index] = {
        ...state.connection.pendingRequests[index],
        ...request,
      };
      return;
    }
    state.connection.pendingRequests.unshift(request);
  }

  function removePendingRequest(groupId) {
    state.connection.pendingRequests = state.connection.pendingRequests.filter((item) => item.groupId !== groupId);
  }

  function renderMarket(market) {
    void market;
  }

  function renderSelectedHero() {
    const hero = getSelectedHero();
    elements.heroCount.textContent = String(state.heroes.length);
    elements.selectedName.textContent = hero ? hero.name : "No hero";
    elements.hudHero.textContent = hero ? hero.name : "No hero";

    if (!hero) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Recruit at the camp";
      elements.selectedHero.replaceChildren(empty);
      return;
    }

    const heroClass = getClass(hero.classId);
    const heroPortrait = getHeroPortrait(hero);
    const rarity = RARITIES[hero.rarity];

    const card = document.createElement("div");
    card.className = "selected-card";

    const img = document.createElement("img");
    img.src = heroPortrait.asset;
    img.alt = `${heroPortrait.name} portrait`;

    const body = document.createElement("div");
    body.className = "selected-body";

    const header = document.createElement("div");
    header.className = "selected-header";

    const title = document.createElement("div");
    title.className = "selected-title";
    title.textContent = hero.name;

    const subtitle = document.createElement("p");
    subtitle.className = "selected-subtitle";
    subtitle.textContent = `${rarity.name} ${heroClass.name}`;
    subtitle.style.color = rarity.color;

    header.append(title, subtitle);
    body.append(header, selectedTraitLine(hero), selectedHeroLines(hero));
    card.append(img, body);
    elements.selectedHero.replaceChildren(card);
  }

  function selectedTraitLine(hero) {
    const row = document.createElement("div");
    row.className = "selected-traits";

    [
      ["BRV", hero.bravery],
      ["GRD", hero.greed],
      ["WIS", hero.wisdom],
    ].forEach(([label, value]) => {
      const item = document.createElement("span");
      const labelEl = document.createElement("small");
      labelEl.textContent = label;
      item.append(labelEl, ` ${value}`);
      row.appendChild(item);
    });

    return row;
  }

  function selectedHeroLines(hero) {
    const lines = document.createElement("div");
    lines.className = "selected-lines";

    const weapon = adapter.getEquippedWeapon ? adapter.getEquippedWeapon(hero.id) : null;
    const weaponLine = selectedInfoLine("Weapon", weapon ? `${weapon.name} +${weapon.arenaBonus}` : "No weapon");

    const run = adapter.getRun(hero.id);
    const runLine = selectedInfoLine("Gate", selectedRunText(run));

    lines.append(weaponLine, runLine);
    return lines;
  }

  function selectedInfoLine(label, value) {
    const line = document.createElement("p");
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    line.append(labelEl, ` ${value}`);
    return line;
  }

  function selectedRunText(run) {
    if (!run) return "Ready at camp";
    if (run.active) return run.pendingDecision ? `Floor ${run.floor}, waiting` : `Floor ${run.floor}, ${run.hp} HP`;
    if (run.hp <= 0) return "Defeated";
    return `Returned with ${run.loot} shards`;
  }

  function equippedWeaponBadge(hero) {
    const weapon = adapter.getEquippedWeapon ? adapter.getEquippedWeapon(hero.id) : null;
    const badge = document.createElement("div");
    badge.className = "run-status";

    const label = document.createElement("span");
    label.className = "run-status-label";
    label.textContent = "Equipped";

    const strong = document.createElement("strong");
    strong.textContent = weapon ? weapon.name : "No weapon";

    const detail = document.createElement("span");
    detail.className = "run-status-detail";
    detail.textContent = weapon ? `Arena bonus +${weapon.arenaBonus}` : "Forge and equip a weapon for arena fights";

    badge.append(label, strong, detail);
    return badge;
  }

  function renderHeroes() {
    if (state.heroes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No heroes recruited";
      elements.heroList.replaceChildren(empty);
      return;
    }

    const cards = state.heroes.map((hero) => {
      const heroClass = getClass(hero.classId);
      const heroPortrait = getHeroPortrait(hero);
      const rarity = RARITIES[hero.rarity];
      const card = document.createElement("button");
      card.type = "button";
      card.className = `hero-card${hero.id === state.selectedHeroId ? " is-selected" : ""}`;
      card.dataset.heroId = String(hero.id);

      const portrait = document.createElement("img");
      portrait.src = heroPortrait.asset;
      portrait.alt = `${heroPortrait.name} portrait`;

      const body = document.createElement("div");
      const nameRow = document.createElement("div");
      nameRow.className = "hero-name-row";

      const name = document.createElement("span");
      name.className = "hero-name";
      name.textContent = hero.name;

      const rarityEl = document.createElement("span");
      rarityEl.className = "rarity";
      rarityEl.style.color = rarity.color;
      rarityEl.textContent = rarity.name;

      const classEl = document.createElement("p");
      classEl.className = "hero-class";
      classEl.textContent = heroClass.name;

      const runBadge = compactRunBadge(hero);

      nameRow.append(name, rarityEl);
      body.append(nameRow, classEl);
      if (runBadge) body.append(runBadge);
      card.append(portrait, body);
      return card;
    });

    elements.heroList.replaceChildren(...cards);
  }

  function statGrid(hero) {
    const grid = document.createElement("div");
    grid.className = "stat-grid";

    [
      ["BRV", hero.bravery],
      ["GRD", hero.greed],
      ["WIS", hero.wisdom],
    ].forEach(([label, value]) => {
      const box = document.createElement("div");
      box.className = "stat-box";

      const labelEl = document.createElement("span");
      labelEl.className = "stat-label";
      labelEl.textContent = label;

      const valueEl = document.createElement("span");
      valueEl.className = "stat-value";
      valueEl.textContent = String(value);

      box.append(labelEl, valueEl);
      grid.appendChild(box);
    });

    return grid;
  }

  function runStatusCard(hero) {
    const run = adapter.getRun(hero.id);
    const status = document.createElement("div");
    status.className = "run-status";

    const label = document.createElement("span");
    label.className = "run-status-label";
    label.textContent = "Gate Run";

    const value = document.createElement("strong");
    const detail = document.createElement("span");
    detail.className = "run-status-detail";

    if (!run) {
      status.classList.add("is-ready");
      value.textContent = "Ready at camp";
      detail.textContent = "Talk to the Gate Warden";
    } else if (run.active) {
      status.classList.add("is-active");
      value.textContent = run.pendingDecision ? `Floor ${run.floor} / waiting` : `Floor ${run.floor} / ${run.hp} HP`;
      detail.textContent = run.pendingDecision ? "Awaiting the Warden's omen" : `${run.loot} shards carried`;
    } else if (run.hp <= 0) {
      status.classList.add("is-danger");
      value.textContent = "Defeated";
      detail.textContent = "Temporary loot was lost";
    } else {
      status.classList.add("is-returned");
      value.textContent = "Returned safely";
      detail.textContent = `${run.loot} shards / ${run.hp} HP`;
    }

    status.append(label, value, detail);
    return status;
  }

  function compactRunBadge(hero) {
    const run = adapter.getRun(hero.id);
    if (!run) return null;

    const badge = document.createElement("span");
    badge.className = "hero-run-badge";

    if (run.active) {
      badge.classList.add("is-active");
      badge.textContent = run.pendingDecision ? `Gate F${run.floor} / omen` : `Gate F${run.floor} / ${run.hp} HP`;
    } else if (run.hp <= 0) {
      badge.classList.add("is-danger");
      badge.textContent = "Defeated";
    } else {
      badge.classList.add("is-returned");
      badge.textContent = `${run.loot} shards returned`;
    }

    return badge;
  }

  function renderLog() {
    elements.logCount.textContent = String(state.events.length);
    const rows = state.events.slice(0, 30).map((event) => {
      const row = document.createElement("li");
      row.className = event.type;

      const time = document.createElement("span");
      time.className = "event-time";
      time.textContent = event.time;

      const text = document.createElement("span");
      text.textContent = event.message;

      row.append(time, text);
      return row;
    });
    elements.eventLog.replaceChildren(...rows);
  }

  function addEvent(type, message, options = {}) {
    state.events.unshift({
      id: `${Date.now()}-${Math.random()}`,
      type,
      message,
      time: formatTime(new Date()),
    });
    if (!options.silentFloat) {
      spawnFloatingEvent(type, message);
    }
  }

  function clearTouchMove(event) {
    const button = event.target.closest("[data-move]");
    if (button) {
      state.touchMoves.delete(button.dataset.move);
    } else {
      state.touchMoves.clear();
    }
  }

  function normalizeKey(key) {
    const lowered = key.toLowerCase();
    if (lowered === "arrowleft" || lowered === "a") return "left";
    if (lowered === "arrowright" || lowered === "d") return "right";
    if (lowered === "arrowup" || lowered === "w") return "up";
    if (lowered === "arrowdown" || lowered === "s") return "down";
    if (lowered === "e" || lowered === " " || lowered === "enter") return "interact";
    return null;
  }

  function isTyping() {
    const active = document.activeElement;
    return active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
  }

  function getNearbyNpc() {
    return getCurrentNpcs().find((npc) => npc.id === state.nearbyNpcId) || null;
  }

  function getActiveNpc() {
    return getCurrentNpcs().find((npc) => npc.id === state.activeNpcId) || null;
  }

  function getNpcDialogue(npc) {
    if (npc.id === "guildmaster") {
      const hero = getSelectedHero();
      if (!state.heroes.length) {
        return "Bring me sworn names first. The guild cannot choose from an empty roster.";
      }
      if (!hero) {
        return "The guild roster is ready. Choose who carries Sogent's banner today.";
      }
      return `${hero.name} currently carries Sogent's banner. Ask me to call the next sworn hero forward.`;
    }

    if (npc.id === "arena-master") {
      const roomId = Number(elements.arenaRoomId.value.trim() || state.arena.lastRoomId || 0);
      const story = roomId ? getUnreadArenaStory(roomId) : null;
      if (story) {
        return `Challenge ${roomId} has a new arena chronicle. Read it before posting another wager.`;
      }
      const hero = getSelectedHero();
      if (!hero) {
        return "Recruit and select a hero before posting a wager challenge. Strength will affect the fight odds.";
      }
      if (roomId) {
        return `${hero.name} can accept challenge ${roomId}. Strength and weapons shape the odds, then the Arena Master records the fight.`;
      }
      return `${hero.name} can post a wager challenge. Share the challenge id with another player, or recruit a second hero to test locally.`;
    }

    if (npc.id === "blacksmith") {
      const inventory = adapter.getInventory ? adapter.getInventory() : { shards: 0, weapons: 0 };
      const forgeCost = inventory.forgeCost || state.forgeCost;
      const order = inventory.forgeOrder;
      if (order?.active && order.ready) {
        return `Shard Blade ${order.tier} is ready. Claim it, then equip it before entering an arena challenge.`;
      }
      if (order?.active) {
        return `The forge is working on Shard Blade ${order.tier}. Come back in ${formatCountdown(order.readyAt - Date.now())}.`;
      }
      if (inventory.shards < forgeCost) {
        return `Bring ${forgeCost} banked shards from safe gate returns. Current stash: ${inventory.shards}.`;
      }
      return `The forge is hot. Spend ${forgeCost} shards to start Shard Blade ${inventory.nextForgeTier || 1}.`;
    }

    if (npc.id !== "warden") return npc.dialogue;

    const hero = getSelectedHero();
    if (!hero) {
      return "Recruit and select a hero first. The gate only accepts a named adventurer.";
    }

    const run = adapter.getRun(hero.id);
    if (!run) {
      return `${hero.name} is ready at camp. Enter the gate to start Floor 1.`;
    }
    if (run.active && run.pendingDecision) {
      return `${hero.name} is beyond the gate. The Warden is reading the omen before the chronicle is sealed.`;
    }
    if (run.active) {
      return `${hero.name} is on Floor ${run.floor} with ${run.hp} HP and ${run.loot} shards. Ask the Warden to read the next omen.`;
    }
    const unreadStory = getUnreadAdventureStory(hero.id);
    if (unreadStory) {
      return run.hp <= 0
        ? `${hero.name}'s gate run ended. The Warden has a new legend ready.`
        : `${hero.name} returned from the gate. The Warden has a new legend ready.`;
    }
    if (run.hp <= 0) {
      const adventureStory = getAdventureStory(hero.id);
      if (adventureStory) {
        return `${hero.name} was defeated. The story has been recorded in the battle log.`;
      }
      return `${hero.name} was defeated and lost temporary loot. Send them back in when you want another run.`;
    }
    const adventureStory = getAdventureStory(hero.id);
    if (adventureStory) {
      return `${hero.name} returned safely with ${run.loot} shards. The story has been recorded in the battle log.`;
    }
    return `${hero.name} returned safely with ${run.loot} shards. You can start another gate run.`;
  }

  function getAdventureStory(heroId) {
    return adapter.getAdventureStory ? adapter.getAdventureStory(heroId) : null;
  }

  function getArenaStory(roomId) {
    return adapter.getArenaStory ? adapter.getArenaStory(roomId) : null;
  }

  function getUnreadAdventureStory(heroId) {
    const story = getAdventureStory(heroId);
    if (!story || state.seenStories.has(getStoryKey(heroId, story))) return null;
    return story;
  }

  function getUnreadArenaStory(roomId) {
    const story = getArenaStory(roomId);
    if (!story || state.arena.seenStories.has(getArenaStoryKey(roomId, story))) return null;
    return story;
  }

  function getStoryKey(heroId, story) {
    return `${heroId}:${story.requestId || story.route}:${story.story}`;
  }

  function getArenaStoryKey(roomId, story) {
    return `${roomId}:${story.requestId || ""}:${story.story || story}`;
  }

  function getNpcActionLabel(npc) {
    if (npc.id === "recruiter") return "Recruit";

    if (npc.id === "guildmaster") {
      return "Roster";
    }

    if (npc.id === "arena-master") {
      const roomId = Number(elements.arenaRoomId.value.trim() || state.arena.lastRoomId || 0);
      if (roomId && getUnreadArenaStory(roomId)) return "See Fight";
      return "Arena";
    }

    if (npc.id === "blacksmith") {
      return "Forge";
    }

    if (npc.id !== "warden") return npc.label;

    const hero = getSelectedHero();
    if (!hero) return "Recruit First";

    const run = adapter.getRun(hero.id);
    if (!run?.active && getUnreadAdventureStory(hero.id)) return "See Story";
    if (run?.active && run.pendingDecision) return "Await Omen";
    if (run?.active && state.connection.mode === "somnia" && state.connection.llmGateSupport) return "Read Omen";
    return run?.active ? "Resolve Floor" : "Enter Gate";
  }

  function getNpcActionDisabled(npc) {
    if (state.connection.busy) return true;
    if (npc.id === "recruiter" || npc.id === "guildmaster" || npc.id === "blacksmith") return false;
    if (npc.id === "arena-master") {
      const roomId = Number(elements.arenaRoomId.value.trim() || state.arena.lastRoomId || 0);
      if (roomId && getUnreadArenaStory(roomId)) return false;
      return false;
    }
    if (npc.id === "warden") {
      const hero = getSelectedHero();
      if (!hero) return true;
      const run = adapter.getRun(hero.id);
      return Boolean(run?.active && run.pendingDecision);
    }
    return false;
  }

  function findNpcNear(x, y, maxDistance) {
    let closest = null;
    let closestDistance = Infinity;
    getCurrentNpcs().forEach((npc) => {
      const distance = Math.hypot(x - npc.x, y - npc.y);
      const interactionDistance = Math.max(maxDistance, getNpcInteractDistance(npc));
      if (distance <= interactionDistance && distance < closestDistance) {
        closest = npc;
        closestDistance = distance;
      }
    });
    return closest;
  }

  function getNpcInteractDistance(npc) {
    return npc.interactDistance || INTERACT_DISTANCE;
  }

  function getSelectedHero() {
    return state.heroes.find((hero) => hero.id === state.selectedHeroId) || null;
  }
