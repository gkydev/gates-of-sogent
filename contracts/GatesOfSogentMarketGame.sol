// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./GateAdventureLib.sol";
import "./ArenaCombatLib.sol";
import "./SomniaAgents.sol";
import "./SogentWeaponNFT.sol";

/// @title GatesOfSogentMarketGame
/// @notice Base prototype: Somnia JSON API Agent fetches market data used to generate hero traits.
contract GatesOfSogentMarketGame {
    string public constant GAME_VERSION = "0.6.0-forge-nfts";
    uint256 public constant SOMNIA_TESTNET_CHAIN_ID = 50312;
    uint8 public constant REQUEST_MARKET = 1;
    uint8 public constant REQUEST_GATE_DECISION = 2;
    uint8 public constant REQUEST_ARENA_NARRATION = 3;
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant LLM_INFERENCE_AGENT_ID = 12847293847561029384;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant JSON_FETCH_COST_PER_AGENT = 0.03 ether;
    uint256 public constant LLM_COST_PER_AGENT = 0.07 ether;
    uint256 public constant WEAPON_SHARD_COST = 25;
    uint256 public constant FORGE_BASE_DURATION = 45 seconds;
    uint256 public constant FORGE_TIER_DURATION = 15 seconds;
    uint256 public constant FORGE_MAX_DURATION = 180 seconds;
    uint256 public constant MAX_WEAPON_BONUS_TIER = 10;
    uint256 public constant WEAPON_ARENA_BONUS_PER_TIER = 18;
    uint256 public constant MAX_ROUTE_LENGTH = GateAdventureLib.MAX_ROUTE_LENGTH;
    uint256 public constant MAX_STORY_BYTES = GateAdventureLib.MAX_STORY_BYTES;

    string public constant MARKET_URL =
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,somnia&vs_currencies=usd";
    uint256 public constant MARKET_COUNT = 3;

    IAgentRequester public constant SOMNIA_AGENTS =
        IAgentRequester(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776);

    SogentWeaponNFT public immutable weaponNFT;

    struct Hero {
        address owner;
        string name;
        uint256 seed;
        uint256 bitcoinPrice;
        uint256 ethereumPrice;
        uint256 somniaPrice;
        uint8 classId;
        uint8 rarity;
        uint8 bravery;
        uint8 greed;
        uint8 wisdom;
    }

    struct PendingHero {
        address owner;
        string name;
        uint256 receivedMarkets;
        uint256 bitcoinPrice;
        uint256 ethereumPrice;
        uint256 somniaPrice;
    }

    struct GateRun {
        bool active;
        uint16 floor;
        uint16 hp;
        uint256 loot;
    }

    struct ForgeOrder {
        bool active;
        uint256 tier;
        uint256 shardCost;
        uint256 startedAt;
        uint256 readyAt;
    }

    struct ArenaRoom {
        address creator;
        address challenger;
        uint256 creatorHeroId;
        uint256 challengerHeroId;
        uint256 stake;
        uint16 creatorPower;
        uint16 challengerPower;
        address winner;
        uint256 winnerHeroId;
        bool resolved;
    }

    uint256 public nextHeroId = 1;
    uint256 public nextArenaRoomId = 1;
    uint256 public latestBitcoinPrice;
    uint256 public latestEthereumPrice;
    uint256 public latestSomniaPrice;

    mapping(uint256 => Hero) public heroes;
    mapping(uint256 => GateRun) public gateRuns;
    mapping(address => uint256) public shards;
    mapping(address => uint256) public craftedWeapons;
    mapping(address => ForgeOrder) public forgeOrders;
    mapping(uint256 => uint256) public equippedWeapons;
    mapping(uint256 => PendingHero) public pendingHeroes;
    mapping(uint256 => bool) public pendingRequests;
    mapping(uint256 => uint8) public requestKind;
    mapping(uint256 => uint256) public requestToMarketId;
    mapping(uint256 => uint256) public requestToGroupId;
    mapping(uint256 => bool) public pendingGateDecision;
    mapping(uint256 => string) public lastGateDecision;
    mapping(uint256 => uint256) public gateRunNonce;
    mapping(uint256 => ArenaRoom) public arenaRooms;
    mapping(uint256 => bool) public pendingArenaNarration;
    mapping(uint256 => string) public lastArenaStory;
    mapping(address => uint256[]) private ownerHeroes;

    event HeroRequested(uint256 indexed groupId, address indexed owner, string name);
    event MarketRequested(uint256 indexed requestId, uint256 indexed groupId, uint256 marketId, string selector);
    event MarketDataReceived(uint256 indexed requestId, uint256 indexed groupId, uint256 marketId, uint256 marketPrice);
    event HeroGenerated(
        uint256 indexed heroId,
        address indexed owner,
        string name,
        uint256 seed,
        uint256 bitcoinPrice,
        uint256 ethereumPrice,
        uint256 somniaPrice,
        uint8 classId,
        uint8 rarity,
        uint8 bravery,
        uint8 greed,
        uint8 wisdom
    );
    event AgentRequestFailed(uint256 indexed requestId, uint256 indexed groupId, ResponseStatus status);
    event GateRunStarted(uint256 indexed heroId, address indexed owner, uint16 hp);
    event GateDecisionRequested(uint256 indexed requestId, uint256 indexed heroId, address indexed owner);
    event GateDecisionReceived(uint256 indexed requestId, uint256 indexed heroId, string route);
    event GateAdventureNarrated(uint256 indexed requestId, uint256 indexed heroId, string route, string story);
    event GateFloorResolved(
        uint256 indexed heroId,
        address indexed owner,
        uint16 floor,
        uint16 hp,
        uint256 loot,
        bool active,
        string outcome
    );
    event ShardsBanked(address indexed owner, uint256 amount, uint256 balance);
    event WeaponCrafted(address indexed owner, uint256 indexed weaponId, uint256 shardCost);
    event ForgeOrderStarted(
        address indexed owner,
        uint256 indexed tier,
        uint256 shardCost,
        uint256 startedAt,
        uint256 readyAt
    );
    event ForgeOrderClaimed(
        address indexed owner,
        uint256 indexed weaponId,
        uint256 indexed tier,
        uint256 arenaBonus
    );
    event WeaponEquipped(uint256 indexed heroId, address indexed owner, uint256 indexed weaponId, uint256 arenaBonus);
    event WeaponUnequipped(uint256 indexed heroId, address indexed owner, uint256 indexed weaponId);
    event ArenaRoomCreated(uint256 indexed roomId, address indexed creator, uint256 indexed heroId, uint256 stake);
    event ArenaRoomCancelled(uint256 indexed roomId, address indexed creator, uint256 stake);
    event ArenaRoomJoined(uint256 indexed roomId, address indexed challenger, uint256 indexed heroId);
    event ArenaFightResolved(
        uint256 indexed roomId,
        address indexed winner,
        uint256 indexed winnerHeroId,
        uint256 loserHeroId,
        uint256 payout,
        uint16 creatorPower,
        uint16 challengerPower
    );
    event ArenaNarrationRequested(uint256 indexed requestId, uint256 indexed roomId);
    event ArenaFightNarrated(uint256 indexed requestId, uint256 indexed roomId, string story);

    modifier onlySomniaTestnet() {
        require(block.chainid == SOMNIA_TESTNET_CHAIN_ID, "Use Somnia testnet");
        _;
    }

    constructor() {
        weaponNFT = new SogentWeaponNFT(address(this));
    }

    function requiredFee() public view returns (uint256) {
        return SOMNIA_AGENTS.getRequestDeposit() + (JSON_FETCH_COST_PER_AGENT * SUBCOMMITTEE_SIZE);
    }

    function requiredTotalFee() public view returns (uint256) {
        return requiredFee() * MARKET_COUNT;
    }

    function requiredGateDecisionFee() public view returns (uint256) {
        return SOMNIA_AGENTS.getRequestDeposit() + (LLM_COST_PER_AGENT * SUBCOMMITTEE_SIZE);
    }

    function contractVersion() external pure returns (string memory) {
        return GAME_VERSION;
    }

    function supportsGateRuns() external pure returns (bool) {
        return true;
    }

    function supportsForge() external pure returns (bool) {
        return true;
    }

    function supportsWeaponNFTs() external pure returns (bool) {
        return true;
    }

    function weaponNFTAddress() external view returns (address) {
        return address(weaponNFT);
    }

    function supportsLLMGateDecisions() external pure returns (bool) {
        return true;
    }

    function supportsOneTxAdventure() external pure returns (bool) {
        return true;
    }

    function requestHero(
        string calldata name
    ) external payable onlySomniaTestnet returns (uint256 groupId) {
        require(bytes(name).length > 0 && bytes(name).length <= 40, "Bad hero name");
        uint256 totalFee = requiredTotalFee();
        require(msg.value == totalFee, "Send exact STT fee");

        groupId = nextHeroId;
        nextHeroId++;

        pendingHeroes[groupId] = PendingHero({
            owner: msg.sender,
            name: name,
            receivedMarkets: 0,
            bitcoinPrice: 0,
            ethereumPrice: 0,
            somniaPrice: 0
        });

        uint256 fee = totalFee / MARKET_COUNT;

        _requestMarket(groupId, 1, "bitcoin.usd", fee);
        _requestMarket(groupId, 2, "ethereum.usd", fee);
        _requestMarket(groupId, 3, "somnia.usd", fee);

        emit HeroRequested(groupId, msg.sender, name);
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        require(msg.sender == address(SOMNIA_AGENTS), "Only SomniaAgents");
        require(pendingRequests[requestId], "Unknown request");

        pendingRequests[requestId] = false;

        uint8 kind = requestKind[requestId];
        if (kind == REQUEST_GATE_DECISION) {
            _handleGateDecisionResponse(requestId, responses, status);
            return;
        }

        if (kind == REQUEST_ARENA_NARRATION) {
            _handleArenaNarrationResponse(requestId, responses, status);
            return;
        }

        require(kind == REQUEST_MARKET, "Unknown request kind");
        _handleMarketResponse(requestId, responses, status);
    }

    function getOwnerHeroes(address owner) external view returns (uint256[] memory) {
        return ownerHeroes[owner];
    }

    function startAdventure(uint256 heroId) external payable onlySomniaTestnet returns (uint256 requestId) {
        Hero storage hero = heroes[heroId];
        require(hero.owner == msg.sender, "Not hero owner");

        _startGateRun(heroId, msg.sender);
        requestId = _requestGateDecision(heroId, msg.sender);
    }

    function _startGateRun(uint256 heroId, address owner) private {
        require(!gateRuns[heroId].active, "Gate already active");

        gateRunNonce[heroId]++;
        gateRuns[heroId] = GateRun({active: true, floor: 1, hp: 100, loot: 0});

        emit GateRunStarted(heroId, owner, 100);
    }

    function _requestGateDecision(uint256 heroId, address owner) private returns (uint256 requestId) {
        GateRun storage run = gateRuns[heroId];
        require(run.active, "No active gate");
        require(!pendingGateDecision[heroId], "Decision pending");

        uint256 fee = requiredGateDecisionFee();
        require(msg.value == fee, "Send exact LLM fee");

        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            _gateAdventurePrompt(heroId),
            _gateAdventureSystem(),
            false,
            _emptyAllowedValues()
        );

        requestId = SOMNIA_AGENTS.createRequest{value: fee}(
            LLM_INFERENCE_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );

        pendingRequests[requestId] = true;
        requestKind[requestId] = REQUEST_GATE_DECISION;
        requestToGroupId[requestId] = heroId;
        pendingGateDecision[heroId] = true;

        emit GateDecisionRequested(requestId, heroId, owner);
    }

    function startForgeOrder() external onlySomniaTestnet returns (uint256 tier) {
        return _startForgeOrder(msg.sender);
    }

    function claimForgeOrder() external onlySomniaTestnet returns (uint256 weaponId) {
        ForgeOrder memory order = forgeOrders[msg.sender];
        require(order.active, "No forge order");
        require(block.timestamp >= order.readyAt, "Forge not ready");

        delete forgeOrders[msg.sender];

        uint256 arenaBonus = _weaponArenaBonus(order.tier);
        weaponId = weaponNFT.mintWeapon(msg.sender, order.tier, arenaBonus);
        craftedWeapons[msg.sender] = order.tier;

        emit ForgeOrderClaimed(msg.sender, weaponId, order.tier, arenaBonus);
        emit WeaponCrafted(msg.sender, weaponId, order.shardCost);
    }

    function equipWeapon(uint256 heroId, uint256 weaponId) external onlySomniaTestnet {
        Hero storage hero = heroes[heroId];
        require(hero.owner == msg.sender, "Not hero owner");
        require(weaponNFT.ownerOf(weaponId) == msg.sender, "Not weapon owner");

        equippedWeapons[heroId] = weaponId;
        emit WeaponEquipped(heroId, msg.sender, weaponId, weaponNFT.weaponArenaBonus(weaponId));
    }

    function unequipWeapon(uint256 heroId) external onlySomniaTestnet {
        Hero storage hero = heroes[heroId];
        require(hero.owner == msg.sender, "Not hero owner");

        uint256 weaponId = equippedWeapons[heroId];
        require(weaponId != 0, "No weapon equipped");

        delete equippedWeapons[heroId];
        emit WeaponUnequipped(heroId, msg.sender, weaponId);
    }

    function getEquippedWeaponBonus(uint256 heroId) public view returns (uint256) {
        Hero storage hero = heroes[heroId];
        uint256 weaponId = equippedWeapons[heroId];
        if (hero.owner == address(0) || weaponId == 0) return 0;
        if (weaponNFT.ownerOf(weaponId) != hero.owner) return 0;
        return weaponNFT.weaponArenaBonus(weaponId);
    }

    function forgeDurationFor(address owner) public view returns (uint256) {
        return _forgeDuration(craftedWeapons[owner] + 1);
    }

    function getForgeOrder(
        address owner
    )
        external
        view
        returns (bool active, uint256 tier, uint256 shardCost, uint256 startedAt, uint256 readyAt, uint256 remaining)
    {
        ForgeOrder storage order = forgeOrders[owner];
        active = order.active;
        tier = order.tier;
        shardCost = order.shardCost;
        startedAt = order.startedAt;
        readyAt = order.readyAt;
        remaining = active && readyAt > block.timestamp ? readyAt - block.timestamp : 0;
    }

    function supportsArenaRooms() external pure returns (bool) {
        return true;
    }

    function requiredArenaNarrationFee() public view returns (uint256) {
        return requiredGateDecisionFee();
    }

    function createArenaRoom(uint256 heroId) external payable onlySomniaTestnet returns (uint256 roomId) {
        Hero storage hero = heroes[heroId];
        require(hero.owner == msg.sender, "Not hero owner");
        require(msg.value > 0, "Stake required");

        roomId = nextArenaRoomId;
        nextArenaRoomId++;

        arenaRooms[roomId] = ArenaRoom({
            creator: msg.sender,
            challenger: address(0),
            creatorHeroId: heroId,
            challengerHeroId: 0,
            stake: msg.value,
            creatorPower: _arenaPower(heroId),
            challengerPower: 0,
            winner: address(0),
            winnerHeroId: 0,
            resolved: false
        });

        emit ArenaRoomCreated(roomId, msg.sender, heroId, msg.value);
    }

    function cancelArenaRoom(uint256 roomId) external onlySomniaTestnet {
        ArenaRoom storage room = arenaRooms[roomId];
        require(room.creator == msg.sender, "Not room creator");
        require(room.challenger == address(0), "Room already joined");
        require(!room.resolved, "Room resolved");

        uint256 stake = room.stake;
        room.resolved = true;
        room.stake = 0;

        _sendValue(msg.sender, stake);
        emit ArenaRoomCancelled(roomId, msg.sender, stake);
    }

    function joinArenaRoom(uint256 roomId, uint256 heroId) external payable onlySomniaTestnet {
        ArenaRoom storage room = arenaRooms[roomId];
        require(msg.value == room.stake, "Send exact stake");

        _resolveArenaRoom(roomId, heroId);
    }

    function joinArenaRoomWithNarration(
        uint256 roomId,
        uint256 heroId
    ) external payable onlySomniaTestnet returns (uint256 requestId) {
        ArenaRoom storage room = arenaRooms[roomId];
        uint256 narrationFee = requiredArenaNarrationFee();
        require(msg.value == room.stake + narrationFee, "Send stake plus LLM fee");

        _resolveArenaRoom(roomId, heroId);
        requestId = _requestArenaNarration(roomId, narrationFee);
    }

    function requestArenaNarration(uint256 roomId) external payable onlySomniaTestnet returns (uint256 requestId) {
        require(msg.value == requiredArenaNarrationFee(), "Send exact LLM fee");
        requestId = _requestArenaNarration(roomId, msg.value);
    }

    function _handleMarketResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status
    ) private {
        uint256 groupId = requestToGroupId[requestId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            delete pendingHeroes[groupId];
            emit AgentRequestFailed(requestId, groupId, status);
            return;
        }

        uint256 marketPrice = abi.decode(responses[0].result, (uint256));
        uint256 marketId = requestToMarketId[requestId];

        if (pendingHeroes[groupId].owner == address(0)) {
            emit AgentRequestFailed(requestId, groupId, ResponseStatus.Failed);
            return;
        }

        _storeMarket(groupId, marketId, marketPrice);

        emit MarketDataReceived(requestId, groupId, marketId, marketPrice);

        if (pendingHeroes[groupId].receivedMarkets == MARKET_COUNT) {
            _generateHero(groupId);
        }
    }

    function _handleGateDecisionResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status
    ) private {
        uint256 heroId = requestToGroupId[requestId];
        pendingGateDecision[heroId] = false;

        if (status != ResponseStatus.Success || responses.length == 0) {
            emit AgentRequestFailed(requestId, heroId, status);
            return;
        }

        string memory output = abi.decode(responses[0].result, (string));
        string memory route = GateAdventureLib.normalizeRoute(output);
        string memory story = GateAdventureLib.extractStory(output);
        lastGateDecision[heroId] = route;

        emit GateDecisionReceived(requestId, heroId, route);
        emit GateAdventureNarrated(requestId, heroId, route, story);

        _resolveGateRoute(heroId, route);
    }

    function _handleArenaNarrationResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status
    ) private {
        uint256 roomId = requestToGroupId[requestId];
        pendingArenaNarration[roomId] = false;

        if (status != ResponseStatus.Success || responses.length == 0) {
            emit AgentRequestFailed(requestId, roomId, status);
            return;
        }

        string memory output = abi.decode(responses[0].result, (string));
        string memory story = GateAdventureLib.extractStory(output);
        lastArenaStory[roomId] = story;

        emit ArenaFightNarrated(requestId, roomId, story);
    }

    function _resolveGateRoute(uint256 heroId, string memory route) private {
        bytes memory steps = bytes(route);

        for (uint256 i = 0; i < steps.length && gateRuns[heroId].active; i++) {
            bool wantsContinue = steps[i] == bytes1("P");
            _resolveGateFloor(heroId, wantsContinue);

            if (!wantsContinue) {
                return;
            }
        }
    }

    function _resolveGateFloor(uint256 heroId, bool wantsContinue) private {
        Hero storage hero = heroes[heroId];
        GateRun storage run = gateRuns[heroId];
        require(run.active, "No active gate");

        uint16 floor = run.floor;
        uint256 roll = GateAdventureLib.roll(hero.seed, heroId, gateRunNonce[heroId], floor, run.hp, run.loot);
        uint16 damage = GateAdventureLib.damage(hero.bravery, hero.wisdom, hero.rarity, floor, roll);

        if (damage >= run.hp) {
            run.hp = 0;
            run.loot = 0;
            run.active = false;
            emit GateFloorResolved(heroId, hero.owner, floor, run.hp, run.loot, run.active, "DEFEATED");
            return;
        }

        run.hp -= damage;
        run.loot += GateAdventureLib.loot(hero.greed, hero.rarity, floor);

        if (run.hp < 34 && hero.bravery < 70) {
            run.active = false;
            _bankShards(hero.owner, run.loot);
            emit GateFloorResolved(heroId, hero.owner, floor, run.hp, run.loot, run.active, "RETREATED");
            return;
        }

        if (wantsContinue && GateAdventureLib.continuesDeeper(hero.bravery, hero.greed, hero.wisdom, run.hp, roll)) {
            run.floor = floor + 1;
            emit GateFloorResolved(
                heroId,
                hero.owner,
                floor,
                run.hp,
                run.loot,
                run.active,
                "CONTINUED"
            );
            return;
        }

        run.active = false;
        _bankShards(hero.owner, run.loot);
        emit GateFloorResolved(
            heroId,
            hero.owner,
            floor,
            run.hp,
            run.loot,
            run.active,
            wantsContinue ? "BLOCKED_RETURNED" : "RETURNED"
        );
    }

    function _resolveArenaRoom(uint256 roomId, uint256 challengerHeroId) private {
        ArenaRoom storage room = arenaRooms[roomId];
        Hero storage challenger = heroes[challengerHeroId];

        require(room.creator != address(0), "Unknown room");
        require(!room.resolved, "Room resolved");
        require(room.challenger == address(0), "Room already joined");
        require(challenger.owner == msg.sender, "Not hero owner");
        require(challengerHeroId != room.creatorHeroId, "Same hero");

        room.challenger = msg.sender;
        room.challengerHeroId = challengerHeroId;
        room.challengerPower = _arenaPower(challengerHeroId);
        room.resolved = true;

        bool creatorWon = ArenaCombatLib.winnerIsFirst(
            roomId,
            heroes[room.creatorHeroId].seed,
            challenger.seed,
            room.creatorPower,
            room.challengerPower,
            blockhash(block.number - 1)
        );

        uint256 loserHeroId;
        if (creatorWon) {
            room.winner = room.creator;
            room.winnerHeroId = room.creatorHeroId;
            loserHeroId = challengerHeroId;
        } else {
            room.winner = msg.sender;
            room.winnerHeroId = challengerHeroId;
            loserHeroId = room.creatorHeroId;
        }

        uint256 payout = room.stake * 2;
        _sendValue(room.winner, payout);

        emit ArenaRoomJoined(roomId, msg.sender, challengerHeroId);
        emit ArenaFightResolved(
            roomId,
            room.winner,
            room.winnerHeroId,
            loserHeroId,
            payout,
            room.creatorPower,
            room.challengerPower
        );
    }

    function _requestArenaNarration(uint256 roomId, uint256 fee) private returns (uint256 requestId) {
        ArenaRoom storage room = arenaRooms[roomId];
        require(room.creator != address(0), "Unknown room");
        require(room.resolved && room.winner != address(0), "Fight not resolved");
        require(!pendingArenaNarration[roomId], "Narration pending");

        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            _arenaFightPrompt(roomId),
            _arenaFightSystem(),
            false,
            _emptyAllowedValues()
        );

        requestId = SOMNIA_AGENTS.createRequest{value: fee}(
            LLM_INFERENCE_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );

        pendingRequests[requestId] = true;
        requestKind[requestId] = REQUEST_ARENA_NARRATION;
        requestToGroupId[requestId] = roomId;
        pendingArenaNarration[roomId] = true;

        emit ArenaNarrationRequested(requestId, roomId);
    }

    function _requestMarket(
        uint256 groupId,
        uint256 marketId,
        string memory selector,
        uint256 fee
    ) private {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            MARKET_URL,
            selector,
            uint8(8)
        );

        uint256 requestId = SOMNIA_AGENTS.createRequest{value: fee}(
            JSON_API_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );

        pendingRequests[requestId] = true;
        requestKind[requestId] = REQUEST_MARKET;
        requestToGroupId[requestId] = groupId;
        requestToMarketId[requestId] = marketId;

        emit MarketRequested(requestId, groupId, marketId, selector);
    }

    function _storeMarket(uint256 groupId, uint256 marketId, uint256 marketPrice) private {
        PendingHero storage pendingHero = pendingHeroes[groupId];

        if (marketId == 1) {
            pendingHero.bitcoinPrice = marketPrice;
            latestBitcoinPrice = marketPrice;
        } else if (marketId == 2) {
            pendingHero.ethereumPrice = marketPrice;
            latestEthereumPrice = marketPrice;
        } else {
            pendingHero.somniaPrice = marketPrice;
            latestSomniaPrice = marketPrice;
        }

        pendingHero.receivedMarkets++;
    }

    function _generateHero(uint256 groupId) private {
        PendingHero memory pendingHero = pendingHeroes[groupId];
        delete pendingHeroes[groupId];

        uint256 seed = uint256(
            keccak256(
                abi.encodePacked(
                    pendingHero.bitcoinPrice,
                    pendingHero.ethereumPrice,
                    pendingHero.somniaPrice,
                    groupId,
                    pendingHero.owner,
                    pendingHero.name,
                    block.timestamp,
                    blockhash(block.number - 1)
                )
            )
        );

        Hero storage hero = heroes[groupId];
        hero.owner = pendingHero.owner;
        hero.name = pendingHero.name;
        hero.seed = seed;
        hero.bitcoinPrice = pendingHero.bitcoinPrice;
        hero.ethereumPrice = pendingHero.ethereumPrice;
        hero.somniaPrice = pendingHero.somniaPrice;
        hero.classId = uint8((seed % 4) + 1);
        hero.rarity = GateAdventureLib.rarity(seed);
        hero.bravery = uint8(((seed >> 16) % 100) + 1);
        hero.greed = uint8(((seed >> 32) % 100) + 1);
        hero.wisdom = uint8(((seed >> 48) % 100) + 1);

        ownerHeroes[pendingHero.owner].push(groupId);
        _emitHeroGenerated(groupId);
    }

    function _emitHeroGenerated(uint256 heroId) private {
        Hero storage hero = heroes[heroId];
        emit HeroGenerated(
            heroId,
            hero.owner,
            hero.name,
            hero.seed,
            hero.bitcoinPrice,
            hero.ethereumPrice,
            hero.somniaPrice,
            hero.classId,
            hero.rarity,
            hero.bravery,
            hero.greed,
            hero.wisdom
        );
    }

    function _bankShards(address owner, uint256 amount) private {
        if (amount == 0) return;
        shards[owner] += amount;
        emit ShardsBanked(owner, amount, shards[owner]);
    }

    function _startForgeOrder(address owner) private returns (uint256 tier) {
        ForgeOrder storage order = forgeOrders[owner];
        require(!order.active, "Forge busy");
        require(shards[owner] >= WEAPON_SHARD_COST, "Need more shards");

        tier = craftedWeapons[owner] + 1;
        uint256 startedAt = block.timestamp;
        uint256 readyAt = startedAt + _forgeDuration(tier);

        shards[owner] -= WEAPON_SHARD_COST;
        forgeOrders[owner] = ForgeOrder({
            active: true,
            tier: tier,
            shardCost: WEAPON_SHARD_COST,
            startedAt: startedAt,
            readyAt: readyAt
        });

        emit ForgeOrderStarted(owner, tier, WEAPON_SHARD_COST, startedAt, readyAt);
    }

    function _forgeDuration(uint256 tier) private pure returns (uint256) {
        uint256 duration = FORGE_BASE_DURATION + (tier * FORGE_TIER_DURATION);
        return duration > FORGE_MAX_DURATION ? FORGE_MAX_DURATION : duration;
    }

    function _weaponArenaBonus(uint256 tier) private pure returns (uint256) {
        uint256 cappedTier = tier > MAX_WEAPON_BONUS_TIER ? MAX_WEAPON_BONUS_TIER : tier;
        return cappedTier * WEAPON_ARENA_BONUS_PER_TIER;
    }

    function _emptyAllowedValues() private pure returns (string[] memory allowedValues) {
        allowedValues = new string[](0);
    }

    function _gateAdventureSystem() private pure returns (string memory) {
        return
            "RPG gate narrator. Return exactly ROUTE=<P/S route ending S> newline STORY=<dark floor story>. "
            "P=push deeper, S=return. Use floor names, monsters/events, hero reaction, and why they push or stop. "
            "No exact HP, damage, loot, or visible route letters in STORY.";
    }

    function _gateAdventurePrompt(uint256 heroId) private view returns (string memory) {
        Hero storage hero = heroes[heroId];
        GateRun storage run = gateRuns[heroId];

        return
            string.concat(
                "Hero: ",
                hero.name,
                ". Class ",
                _toString(hero.classId),
                ". Rarity ",
                _toString(hero.rarity),
                ". Bravery ",
                _toString(hero.bravery),
                ". Greed ",
                _toString(hero.greed),
                ". Wisdom ",
                _toString(hero.wisdom),
                ". Current floor ",
                _toString(run.floor),
                ". HP ",
                _toString(run.hp),
                ". Shards ",
                _toString(run.loot),
                ". Floors: ",
                _floorPreview(heroId),
                " Decide by traits: greed risks, wisdom avoids death, bravery pushes. "
                "Write 3-5 complete sentences, one per chosen floor, each starting with the floor name. "
                "Return exactly ROUTE=<route> newline STORY=<under 750 chars>."
            );
    }

    function _floorPreview(uint256 heroId) private view returns (string memory preview) {
        Hero storage hero = heroes[heroId];
        GateRun memory run = gateRuns[heroId];

        preview = "";
        for (uint256 i = 0; i < MAX_ROUTE_LENGTH; i++) {
            if (!run.active) break;

            uint256 roll = GateAdventureLib.roll(hero.seed, heroId, gateRunNonce[heroId], run.floor, run.hp, run.loot);
            uint16 damage = GateAdventureLib.damage(hero.bravery, hero.wisdom, hero.rarity, run.floor, roll);
            uint256 lootGain = GateAdventureLib.loot(hero.greed, hero.rarity, run.floor);

            preview = string.concat(
                preview,
                _toString(run.floor),
                " ",
                GateAdventureLib.floorName(run.floor),
                " dmg ",
                damage >= run.hp ? "fatal" : _toString(damage),
                ", ",
                _toString(lootGain),
                " shards. "
            );

            if (damage >= run.hp) break;
            run.hp -= damage;
            run.loot += lootGain;
            run.floor++;
        }
    }

    function _arenaPower(uint256 heroId) private view returns (uint16) {
        Hero storage hero = heroes[heroId];
        return ArenaCombatLib.power(hero.rarity, hero.bravery, hero.greed, hero.wisdom, getEquippedWeaponBonus(heroId));
    }

    function _arenaFightSystem() private pure returns (string memory) {
        return
            "RPG arena narrator. Contract already chose winner. Return exactly STORY=<3-4 combat beats, advantage, final blow>. "
            "Do not change winner or invent token amounts.";
    }

    function _arenaFightPrompt(uint256 roomId) private view returns (string memory) {
        ArenaRoom storage room = arenaRooms[roomId];
        Hero storage creatorHero = heroes[room.creatorHeroId];
        Hero storage challengerHero = heroes[room.challengerHeroId];
        uint256 loserHeroId = room.winnerHeroId == room.creatorHeroId ? room.challengerHeroId : room.creatorHeroId;
        Hero storage loserHero = heroes[loserHeroId];

        return
            string.concat(
                "Arena room ",
                _toString(roomId),
                ". Fighter A: ",
                creatorHero.name,
                " strength ",
                _toString(room.creatorPower),
                ". Fighter B: ",
                challengerHero.name,
                " strength ",
                _toString(room.challengerPower),
                ". Winner: ",
                heroes[room.winnerHeroId].name,
                ". Loser: ",
                loserHero.name,
                ". Stake per fighter in wei: ",
                _toString(room.stake),
                ". Payout in wei: ",
                _toString(room.stake * 2),
                ". Dark old-school fantasy tone, under 650 chars. Return STORY=<paragraph>."
            );
    }

    function _sendValue(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "STT transfer failed");
    }

    function _toString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";

        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }

        bytes memory buffer = new bytes(digits);
        bytes memory symbols = "0123456789";
        while (value != 0) {
            digits -= 1;
            buffer[digits] = symbols[value % 10];
            value /= 10;
        }

        return string(buffer);
    }

    receive() external payable {}
}
