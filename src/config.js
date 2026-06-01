export const PIXI_WIDTH = 1024;
export const PIXI_HEIGHT = 640;
export const INTERACT_DISTANCE = 86;
export const PLAYER_SPEED = 3.1;
export const FNV_OFFSET = 0xcbf29ce484222325n;
export const FNV_PRIME = 0x100000001b3n;
export const MASK_64 = 0xffffffffffffffffn;
export const SOMNIA_CHAIN_ID_DECIMAL = 50312;
export const SOMNIA_CHAIN_ID_HEX = "0xc488";
export const SOMNIA_RPC_URL = "https://dream-rpc.somnia.network/";
export const DEFAULT_GAME_CONTRACT_ADDRESS = "0xF0045108604638ec0c4f986Ff44fCeBB9946607e";
export const STORAGE_CONTRACT_ADDRESS = "gatesOfSogent.contractAddress";
export const CONTRACT_QUERY_PARAM = "contract";
export const WORLD_ASSET = "./public/assets/world/sogent-camp.png";
export const CAMPFIRE_ASSET = "./public/assets/world/campfire-companions.png";
export const PLAYER_SHEET_ASSET = "./public/assets/sprites/player-knight-sheet-source.png";
export const NPC_SHEET_ASSET = "./public/assets/sprites/npc-agents-sheet-source.png";
export const PLAYER_SHEET_COLS = 3;
export const PLAYER_SHEET_ROWS = 4;
export const PLAYER_DIRECTIONS = ["down", "left", "right", "up"];
export const PLAYER_DIRECTION_Y_OFFSETS = {
    down: 0,
    left: 0,
    right: 0,
    up: 0,
  };
export const NPC_SHEET_IDS = ["recruiter", "oracle", "warden", "blacksmith"];
export const CAMPFIRE_SCENE = {
    x: 210,
    y: 160,
    scale: 0.18,
    flameOffsetX: 0,
    flameOffsetY: -44,
  };

export const GAME_CONTRACT_ABI = [
    "function requestHero(string name) external payable returns (uint256 groupId)",
    "function contractVersion() external pure returns (string)",
    "function supportsGateRuns() external pure returns (bool)",
    "function supportsForge() external pure returns (bool)",
    "function supportsLLMGateDecisions() external pure returns (bool)",
    "function supportsOneTxAdventure() external pure returns (bool)",
    "function requiredTotalFee() external view returns (uint256)",
    "function requiredGateDecisionFee() external view returns (uint256)",
    "function WEAPON_SHARD_COST() external view returns (uint256)",
    "function getOwnerHeroes(address owner) external view returns (uint256[])",
    "function heroes(uint256 heroId) external view returns (address owner,string name,uint256 seed,uint256 bitcoinPrice,uint256 ethereumPrice,uint256 somniaPrice,uint8 classId,uint8 rarity,uint8 bravery,uint8 greed,uint8 wisdom)",
    "function gateRuns(uint256 heroId) external view returns (bool active,uint16 floor,uint16 hp,uint256 loot)",
    "function shards(address owner) external view returns (uint256)",
    "function craftedWeapons(address owner) external view returns (uint256)",
    "function startGateRun(uint256 heroId) external",
    "function startAdventure(uint256 heroId) external payable returns (uint256 requestId)",
    "function requestGateDecision(uint256 heroId) external payable returns (uint256 requestId)",
    "function resolveGateFloor(uint256 heroId) external",
    "function craftWeapon() external",
    "function pendingGateDecision(uint256 heroId) external view returns (bool)",
    "function lastGateDecision(uint256 heroId) external view returns (string)",
    "function latestBitcoinPrice() external view returns (uint256)",
    "function latestEthereumPrice() external view returns (uint256)",
    "function latestSomniaPrice() external view returns (uint256)",
    "event HeroRequested(uint256 indexed groupId,address indexed owner,string name)",
    "event HeroGenerated(uint256 indexed heroId,address indexed owner,string name,uint256 seed,uint256 bitcoinPrice,uint256 ethereumPrice,uint256 somniaPrice,uint8 classId,uint8 rarity,uint8 bravery,uint8 greed,uint8 wisdom)",
    "event AgentRequestFailed(uint256 indexed requestId,uint256 indexed groupId,uint8 status)",
    "event GateRunStarted(uint256 indexed heroId,address indexed owner,uint16 hp)",
    "event GateDecisionRequested(uint256 indexed requestId,uint256 indexed heroId,address indexed owner)",
    "event GateDecisionReceived(uint256 indexed requestId,uint256 indexed heroId,string route)",
    "event GateAdventureNarrated(uint256 indexed requestId,uint256 indexed heroId,string route,string story)",
    "event GateFloorResolved(uint256 indexed heroId,address indexed owner,uint16 floor,uint16 hp,uint256 loot,bool active,string outcome)",
    "event ShardsBanked(address indexed owner,uint256 amount,uint256 balance)",
    "event WeaponCrafted(address indexed owner,uint256 indexed weaponId,uint256 shardCost)",
  ];

export const WEAPON_SHARD_COST = 25;

export const CLASS_DEFS = [
    {
      id: 1,
      name: "Gate Knight",
      asset: "./public/assets/heroes/gate-knight.png",
      color: 0x42d6c5,
      css: "#42d6c5",
    },
    {
      id: 2,
      name: "Shard Rogue",
      asset: "./public/assets/heroes/shard-rogue.png",
      color: 0x9b6cff,
      css: "#9b6cff",
    },
    {
      id: 3,
      name: "Ember Seer",
      asset: "./public/assets/heroes/ember-seer.png",
      color: 0xf0a94b,
      css: "#f0a94b",
    },
    {
      id: 4,
      name: "Iron Warden",
      asset: "./public/assets/heroes/iron-warden.png",
      color: 0x86b86f,
      css: "#86b86f",
    },
  ];

export const HERO_PORTRAITS = [
    {
      id: 1,
      name: "Gate Knight",
      asset: "./public/assets/heroes/recruits/hero-01-gate-knight.png",
    },
    {
      id: 2,
      name: "Shard Rogue",
      asset: "./public/assets/heroes/recruits/hero-02-shard-rogue.png",
    },
    {
      id: 3,
      name: "Ember Seer",
      asset: "./public/assets/heroes/recruits/hero-03-ember-seer.png",
    },
    {
      id: 4,
      name: "Iron Warden",
      asset: "./public/assets/heroes/recruits/hero-04-iron-warden.png",
    },
    {
      id: 5,
      name: "Rune Archer",
      asset: "./public/assets/heroes/recruits/hero-05-rune-archer.png",
    },
    {
      id: 6,
      name: "Ash Cleric",
      asset: "./public/assets/heroes/recruits/hero-06-ash-cleric.png",
    },
    {
      id: 7,
      name: "Crystal Duelist",
      asset: "./public/assets/heroes/recruits/hero-07-crystal-duelist.png",
    },
    {
      id: 8,
      name: "Hollow Alchemist",
      asset: "./public/assets/heroes/recruits/hero-08-hollow-alchemist.png",
    },
    {
      id: 9,
      name: "Storm Monk",
      asset: "./public/assets/heroes/recruits/hero-09-storm-monk.png",
    },
    {
      id: 10,
      name: "Relic Captain",
      asset: "./public/assets/heroes/recruits/hero-10-relic-captain.png",
    },
  ];

export const RARITIES = {
    1: { name: "Common", color: "#aab1aa" },
    2: { name: "Uncommon", color: "#86b86f" },
    3: { name: "Rare", color: "#42d6c5" },
    4: { name: "Epic", color: "#9b6cff" },
    5: { name: "Ancient", color: "#f0a94b" },
  };

export const NPCS = [
    {
      id: "camp-mira",
      name: "Mira of the Ash",
      tag: "Mira",
      hiddenSprite: true,
      x: 165,
      y: 124,
      color: 0x42d6c5,
      label: "Listen",
      dialogue: "The fire keeps the gate-whispers quiet. For a while.",
      actionEvent: "Mira watches the flames and marks a safe path through the ruins.",
    },
    {
      id: "camp-brann",
      name: "Brann the Tired",
      tag: "Brann",
      hiddenSprite: true,
      x: 260,
      y: 124,
      color: 0xf0a94b,
      label: "Listen",
      dialogue: "If the gate starts singing, do not answer it.",
      actionEvent: "Brann warms his gauntlets and mutters about the last patrol.",
    },
    {
      id: "recruiter",
      name: "Recruiter Agent",
      tag: "Recruiter",
      skin: "recruiter",
      x: 188,
      y: 278,
      color: 0xf0a94b,
      label: "Recruit",
      dialogue: "I can call the market agent and shape a new hero from the returned seed.",
    },
    {
      id: "warden",
      name: "Gate Warden",
      tag: "Warden",
      skin: "oracle",
      x: 502,
      y: 318,
      color: 0x86b86f,
      label: "Run Gate",
      dialogue: "The gate is open. One order sends your hero in and asks the LLM for a route and story.",
    },
    {
      id: "blacksmith",
      name: "Blacksmith Agent",
      tag: "Forge",
      skin: "blacksmith",
      x: 846,
      y: 472,
      color: 0xb8a27c,
      label: "Forge Weapon",
      dialogue: "I can turn banked gate shards into a weapon for the selected hero.",
    },
  ];

export const OBSTACLES = [
    { x: 0, y: 0, w: 1024, h: 122 },
    { x: 270, y: 110, w: 482, h: 172 },
    { x: 70, y: 160, w: 120, h: 112 },
    { x: 833, y: 160, w: 120, h: 112 },
    { x: 80, y: 474, w: 138, h: 86 },
    { x: 770, y: 502, w: 164, h: 60 },
  ];

export const DEFAULT_NAMES = ["Aryn", "Mira", "Darik", "Sol", "Kara", "Venn", "Liora", "Rusk"];
