// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/GatesOfSogentMarketGame.sol";
import "../contracts/SogentWeaponNFT.sol";

interface Vm {
    function chainId(uint256 chainId) external;
    function deal(address account, uint256 balance) external;
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address caller) external;
    function startPrank(address caller) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
}

contract MockSomniaAgents is IAgentRequester {
    struct CreatedRequest {
        uint256 agentId;
        address callbackAddress;
        bytes4 callbackSelector;
        uint256 value;
        bytes payload;
    }

    uint256 public requestDeposit;
    uint256 public nextRequestId;
    mapping(uint256 => CreatedRequest) private createdRequests;

    function setRequestDeposit(uint256 newRequestDeposit) external {
        requestDeposit = newRequestDeposit;
    }

    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId) {
        requestId = nextRequestId == 0 ? 1 : nextRequestId;
        nextRequestId = requestId + 1;

        createdRequests[requestId] = CreatedRequest({
            agentId: agentId,
            callbackAddress: callbackAddress,
            callbackSelector: callbackSelector,
            value: msg.value,
            payload: payload
        });
    }

    function getRequestDeposit() external view returns (uint256) {
        return requestDeposit;
    }

    function requestRecord(
        uint256 requestId
    )
        external
        view
        returns (
            uint256 agentId,
            address callbackAddress,
            bytes4 callbackSelector,
            uint256 value,
            bytes memory payload
        )
    {
        CreatedRequest storage request = createdRequests[requestId];
        return (request.agentId, request.callbackAddress, request.callbackSelector, request.value, request.payload);
    }

    function fulfillUint(uint256 requestId, uint256 value, ResponseStatus status) external {
        fulfill(requestId, abi.encode(value), status);
    }

    function fulfillString(uint256 requestId, string memory value, ResponseStatus status) external {
        fulfill(requestId, abi.encode(value), status);
    }

    function fulfill(uint256 requestId, bytes memory result, ResponseStatus status) private {
        CreatedRequest storage createdRequest = createdRequests[requestId];
        require(createdRequest.callbackAddress != address(0), "Unknown mock request");

        Response[] memory responses = new Response[](status == ResponseStatus.Success ? 1 : 0);
        if (status == ResponseStatus.Success) {
            responses[0] = Response({
                validator: address(this),
                result: result,
                status: status,
                receipt: 0,
                timestamp: block.timestamp,
                executionCost: 0
            });
        }

        Request memory request;
        request.id = requestId;
        request.requester = address(this);
        request.callbackAddress = createdRequest.callbackAddress;
        request.callbackSelector = createdRequest.callbackSelector;
        request.status = status;

        (bool ok, bytes memory revertData) = createdRequest.callbackAddress.call(
            abi.encodeWithSelector(createdRequest.callbackSelector, requestId, responses, status, request)
        );

        if (!ok) {
            assembly {
                revert(add(revertData, 32), mload(revertData))
            }
        }
    }
}

contract GatesOfSogentMarketGameTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant SOMNIA_AGENTS_ADDRESS = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;
    address private constant PLAYER = address(0xA11CE);
    address private constant PLAYER_TWO = address(0xB0B);

    GatesOfSogentMarketGame private game;
    MockSomniaAgents private mockAgents;

    function setUp() public {
        vm.chainId(50312);

        MockSomniaAgents mockImplementation = new MockSomniaAgents();
        vm.etch(SOMNIA_AGENTS_ADDRESS, address(mockImplementation).code);
        mockAgents = MockSomniaAgents(SOMNIA_AGENTS_ADDRESS);
        mockAgents.setRequestDeposit(0.01 ether);

        game = new GatesOfSogentMarketGame();
    }

    function testRequiredFeeUsesSomniaAgentDeposit() public view {
        assertEq(game.requiredFee(), 0.1 ether, "wrong per-market fee");
        assertEq(game.requiredTotalFee(), 0.3 ether, "wrong total market fee");
        assertEq(game.requiredGateDecisionFee(), 0.22 ether, "wrong llm fee");
    }

    function testRequestHeroCreatesThreeMarketAgentRequests() public {
        uint256 groupId = requestHero("Aryn");

        assertEq(groupId, 1, "wrong group id");
        assertEq(game.pendingRequests(1), true, "btc request missing");
        assertEq(game.pendingRequests(2), true, "eth request missing");
        assertEq(game.pendingRequests(3), true, "somnia request missing");
        assertEq(game.requestToMarketId(1), 1, "wrong btc market id");
        assertEq(game.requestToMarketId(2), 2, "wrong eth market id");
        assertEq(game.requestToMarketId(3), 3, "wrong somnia market id");
        assertEq(uint256(game.requestKind(1)), uint256(game.REQUEST_MARKET()), "wrong btc request kind");
        assertEq(uint256(game.requestKind(2)), uint256(game.REQUEST_MARKET()), "wrong eth request kind");
        assertEq(uint256(game.requestKind(3)), uint256(game.REQUEST_MARKET()), "wrong somnia request kind");

        assertMockRequest(1, "bitcoin.usd");
        assertMockRequest(2, "ethereum.usd");
        assertMockRequest(3, "somnia.usd");
    }

    function testHeroIsGeneratedAfterThreeMarketResponses() public {
        requestHero("Aryn");
        fulfillMarketRequests();

        (
            address owner,
            string memory name,
            uint256 seed,
            uint256 bitcoinPrice,
            uint256 ethereumPrice,
            uint256 somniaPrice,
            uint8 classId,
            uint8 rarity,
            uint8 bravery,
            uint8 greed,
            uint8 wisdom
        ) = game.heroes(1);

        assertEq(owner, PLAYER, "wrong owner");
        assertStringEq(name, "Aryn", "wrong name");
        assertTrue(seed != 0, "missing seed");
        assertEq(bitcoinPrice, 68_420_13000000, "wrong btc price");
        assertEq(ethereumPrice, 3_740_62000000, "wrong eth price");
        assertEq(somniaPrice, 18_420000, "wrong somi price");
        assertTrue(classId >= 1 && classId <= 4, "class out of range");
        assertTrue(rarity >= 1 && rarity <= 5, "rarity out of range");
        assertTrue(bravery >= 1 && bravery <= 100, "bravery out of range");
        assertTrue(greed >= 1 && greed <= 100, "greed out of range");
        assertTrue(wisdom >= 1 && wisdom <= 100, "wisdom out of range");

        uint256[] memory ids = game.getOwnerHeroes(PLAYER);
        assertEq(ids.length, 1, "wrong hero count");
        assertEq(ids[0], 1, "wrong owned hero id");
    }

    function testGateRunCanResolveGeneratedHero() public {
        requestHero("Aryn");
        fulfillMarketRequests();

        uint256 fee = game.requiredGateDecisionFee();
        vm.deal(PLAYER, fee);
        vm.prank(PLAYER);
        uint256 requestId = game.startAdventure{value: fee}(1);

        mockAgents.fulfillString(
            requestId,
            "ROUTE=S\nSTORY=Wolf Tunnel rose before Aryn, and she returned with the shards she could carry.",
            ResponseStatus.Success
        );

        (bool active, , uint16 hp, ) = game.gateRuns(1);
        assertEq(active, false, "run should close");
        assertTrue(hp <= 100, "hp cannot increase");
    }

    function testStartAdventureStartsRunAndCreatesLLMRequest() public {
        requestHero("Aryn");
        fulfillMarketRequests();

        uint256 fee = game.requiredGateDecisionFee();
        vm.deal(PLAYER, fee);
        vm.prank(PLAYER);
        uint256 requestId = game.startAdventure{value: fee}(1);

        assertEq(requestId, 4, "wrong llm request id");
        (bool active, uint16 floor, uint16 hp, uint256 loot) = game.gateRuns(1);
        assertEq(active, true, "run should be active");
        assertTrue(floor == 1, "wrong starting floor");
        assertTrue(hp == 100, "wrong starting hp");
        assertEq(loot, 0, "wrong starting loot");
        assertEq(game.pendingRequests(4), true, "llm request missing");
        assertEq(game.pendingGateDecision(1), true, "hero decision not pending");

        assertMockLLMRequest(4);
    }

    function testLLMGateStoryRouteResolvesAdventure() public {
        requestHero("Aryn");
        fulfillMarketRequests();

        uint256 fee = game.requiredGateDecisionFee();
        vm.deal(PLAYER, fee);
        vm.prank(PLAYER);
        uint256 requestId = game.startAdventure{value: fee}(1);

        mockAgents.fulfillString(
            requestId,
            "ROUTE=PPS\nSTORY=Aryn cut through the wolf tunnel, endured the crypt, then returned before the gate swallowed him.",
            ResponseStatus.Success
        );

        (bool active, , uint16 hp, uint256 loot) = game.gateRuns(1);
        assertEq(active, false, "run should close");
        assertTrue(hp <= 100, "hp cannot increase");
        assertTrue(loot > 0, "loot should be kept");
        assertEq(game.shards(PLAYER), loot, "loot should be banked");
        assertStringEq(game.lastGateDecision(1), "PPS", "wrong stored llm route");
        assertEq(game.pendingGateDecision(1), false, "decision should clear");
    }

    function testForgeOrderMintsTradableWeaponNFT() public {
        requestHero("Aryn");
        fulfillMarketRequests();
        earnShards(PLAYER, 1, game.WEAPON_SHARD_COST());

        uint256 shardBalanceBefore = game.shards(PLAYER);
        vm.prank(PLAYER);
        uint256 tier = game.startForgeOrder();

        assertEq(tier, 1, "wrong forge tier");
        assertEq(game.shards(PLAYER), shardBalanceBefore - game.WEAPON_SHARD_COST(), "shards should be spent at start");

        (bool active, uint256 storedTier, uint256 shardCost, uint256 startedAt, uint256 readyAt, uint256 remaining) =
            game.getForgeOrder(PLAYER);
        assertEq(active, true, "order should be active");
        assertEq(storedTier, 1, "wrong stored tier");
        assertEq(shardCost, game.WEAPON_SHARD_COST(), "wrong shard cost");
        assertTrue(readyAt > startedAt, "missing cooldown");
        assertTrue(remaining > 0, "remaining time should be positive");

        vm.expectRevert(bytes("Forge not ready"));
        vm.prank(PLAYER);
        game.claimForgeOrder();

        vm.warp(readyAt);
        vm.prank(PLAYER);
        uint256 weaponId = game.claimForgeOrder();

        SogentWeaponNFT weaponNFT = SogentWeaponNFT(game.weaponNFTAddress());
        assertEq(weaponId, 1, "wrong weapon id");
        assertEq(weaponNFT.ownerOf(weaponId), PLAYER, "wrong weapon owner");
        assertEq(weaponNFT.weaponTier(weaponId), 1, "wrong weapon tier");
        assertEq(weaponNFT.weaponArenaBonus(weaponId), 18, "wrong arena bonus");
        assertEq(game.craftedWeapons(PLAYER), 1, "crafted count should update on claim");

        vm.prank(PLAYER);
        weaponNFT.transferFrom(PLAYER, PLAYER_TWO, weaponId);
        assertEq(weaponNFT.ownerOf(weaponId), PLAYER_TWO, "weapon should transfer");
    }

    function testForgeOrderRequiresShardsAndSingleActiveOrder() public {
        vm.expectRevert(bytes("Need more shards"));
        vm.prank(PLAYER);
        game.startForgeOrder();

        requestHero("Aryn");
        fulfillMarketRequests();
        earnShards(PLAYER, 1, game.WEAPON_SHARD_COST() * 2);

        vm.prank(PLAYER);
        game.startForgeOrder();

        vm.expectRevert(bytes("Forge busy"));
        vm.prank(PLAYER);
        game.startForgeOrder();
    }

    function testEquippedWeaponAffectsArenaPowerOnlyWhileOwned() public {
        requestHero("Aryn");
        fulfillMarketRequests();
        requestHeroFor(PLAYER_TWO, "Bryn");
        fulfillMarketRequestsFrom(4);

        earnShards(PLAYER, 1, game.WEAPON_SHARD_COST());
        vm.prank(PLAYER);
        game.startForgeOrder();
        (, , , , uint256 readyAt, ) = game.getForgeOrder(PLAYER);
        vm.warp(readyAt);
        vm.prank(PLAYER);
        uint256 weaponId = game.claimForgeOrder();

        uint256 stake = 1 ether;
        vm.deal(PLAYER, stake * 2);
        vm.prank(PLAYER);
        uint256 plainRoomId = game.createArenaRoom{value: stake}(1);
        (, , , , , uint16 plainPower, , , , ) = game.arenaRooms(plainRoomId);
        vm.prank(PLAYER);
        game.cancelArenaRoom(plainRoomId);

        vm.prank(PLAYER);
        game.equipWeapon(1, weaponId);
        assertEq(game.getEquippedWeaponBonus(1), 18, "missing equipped weapon bonus");

        vm.prank(PLAYER);
        uint256 equippedRoomId = game.createArenaRoom{value: stake}(1);
        (, , , , , uint16 equippedPower, , , , ) = game.arenaRooms(equippedRoomId);
        assertEq(uint256(equippedPower), uint256(plainPower) + 18, "equipped weapon should add arena power");
        vm.prank(PLAYER);
        game.cancelArenaRoom(equippedRoomId);

        SogentWeaponNFT weaponNFT = SogentWeaponNFT(game.weaponNFTAddress());
        vm.prank(PLAYER);
        weaponNFT.transferFrom(PLAYER, PLAYER_TWO, weaponId);
        assertEq(game.getEquippedWeaponBonus(1), 0, "transferred weapon should not count");

        vm.prank(PLAYER);
        uint256 transferredRoomId = game.createArenaRoom{value: stake}(1);
        (, , , , , uint16 transferredPower, , , , ) = game.arenaRooms(transferredRoomId);
        assertEq(uint256(transferredPower), uint256(plainPower), "transferred weapon should not affect arena");
    }

    function testArenaRoomResolvesStakeFight() public {
        requestHero("Aryn");
        fulfillMarketRequests();
        requestHeroFor(PLAYER_TWO, "Bryn");
        fulfillMarketRequestsFrom(4);

        uint256 stake = 1 ether;
        vm.deal(PLAYER, stake);
        vm.prank(PLAYER);
        uint256 roomId = game.createArenaRoom{value: stake}(1);

        vm.deal(PLAYER_TWO, stake);
        vm.prank(PLAYER_TWO);
        game.joinArenaRoom{value: stake}(roomId, 2);

        (
            address creator,
            address challenger,
            uint256 creatorHeroId,
            uint256 challengerHeroId,
            uint256 storedStake,
            uint16 creatorPower,
            uint16 challengerPower,
            address winner,
            uint256 winnerHeroId,
            bool resolved
        ) = game.arenaRooms(roomId);

        assertEq(creator, PLAYER, "wrong creator");
        assertEq(challenger, PLAYER_TWO, "wrong challenger");
        assertEq(creatorHeroId, 1, "wrong creator hero");
        assertEq(challengerHeroId, 2, "wrong challenger hero");
        assertEq(storedStake, stake, "wrong stake");
        assertTrue(creatorPower > 0, "missing creator power");
        assertTrue(challengerPower > 0, "missing challenger power");
        assertTrue(winner == PLAYER || winner == PLAYER_TWO, "bad winner");
        assertTrue(winnerHeroId == 1 || winnerHeroId == 2, "bad winner hero");
        assertEq(resolved, true, "fight should resolve");
        assertEq(address(game).balance, 0, "stake should be paid out");
        assertEq(PLAYER.balance + PLAYER_TWO.balance, stake * 2, "winner should receive pot");
    }

    function testArenaRoomWithNarrationCreatesLLMRequest() public {
        requestHero("Aryn");
        fulfillMarketRequests();
        requestHeroFor(PLAYER_TWO, "Bryn");
        fulfillMarketRequestsFrom(4);

        uint256 stake = 1 ether;
        vm.deal(PLAYER, stake);
        vm.prank(PLAYER);
        uint256 roomId = game.createArenaRoom{value: stake}(1);

        uint256 fee = game.requiredArenaNarrationFee();
        vm.deal(PLAYER_TWO, stake + fee);
        vm.prank(PLAYER_TWO);
        uint256 requestId = game.joinArenaRoomWithNarration{value: stake + fee}(roomId, 2);

        assertEq(requestId, 7, "wrong arena llm request id");
        assertEq(game.pendingArenaNarration(roomId), true, "narration should be pending");
        assertEq(uint256(game.requestKind(requestId)), uint256(game.REQUEST_ARENA_NARRATION()), "wrong request kind");
        assertEq(game.requestToGroupId(requestId), roomId, "wrong request room id");
        assertMockArenaLLMRequest(requestId);

        mockAgents.fulfillString(
            requestId,
            "STORY=The arena bell cracked through the ruins. Aryn and Bryn traded three brutal passes before the winner broke guard and claimed the pot.",
            ResponseStatus.Success
        );

        assertEq(game.pendingArenaNarration(roomId), false, "narration should clear");
        assertTrue(contains(bytes(game.lastArenaStory(roomId)), bytes("arena bell")), "story not stored");
    }

    function testRequestHeroRequiresSomniaTestnetChainId() public {
        uint256 totalFee = game.requiredTotalFee();
        vm.deal(PLAYER, totalFee);
        vm.chainId(1);

        vm.expectRevert(bytes("Use Somnia testnet"));
        vm.prank(PLAYER);
        game.requestHero{value: totalFee}("Aryn");
    }

    function testRequestHeroRequiresExactFee() public {
        vm.deal(PLAYER, 1 ether);

        vm.expectRevert(bytes("Send exact STT fee"));
        vm.prank(PLAYER);
        game.requestHero{value: 0.01 ether}("Aryn");
    }

    function requestHero(string memory name) private returns (uint256 groupId) {
        groupId = requestHeroFor(PLAYER, name);
    }

    function requestHeroFor(address player, string memory name) private returns (uint256 groupId) {
        uint256 totalFee = game.requiredTotalFee();
        vm.deal(player, totalFee);
        vm.prank(player);
        groupId = game.requestHero{value: totalFee}(name);
    }

    function earnShards(address player, uint256 heroId, uint256 minimumShards) private {
        for (uint256 attempt = 0; attempt < 16 && game.shards(player) < minimumShards; attempt++) {
            uint256 fee = game.requiredGateDecisionFee();
            vm.deal(player, fee);
            vm.prank(player);
            uint256 requestId = game.startAdventure{value: fee}(heroId);

            mockAgents.fulfillString(
                requestId,
                "ROUTE=PPPS\nSTORY=Wolf Tunnel opened the trial. Soulsucker Crypt tested the hero. Bone Knight Bridge nearly broke resolve. Ash Warden Hall sent the hero home with shards.",
                ResponseStatus.Success
            );
        }

        assertTrue(game.shards(player) >= minimumShards, "test helper could not earn enough shards");
    }

    function fulfillMarketRequests() private {
        mockAgents.fulfillUint(1, 68_420_13000000, ResponseStatus.Success);
        mockAgents.fulfillUint(2, 3_740_62000000, ResponseStatus.Success);
        mockAgents.fulfillUint(3, 18_420000, ResponseStatus.Success);
    }

    function fulfillMarketRequestsFrom(uint256 firstRequestId) private {
        mockAgents.fulfillUint(firstRequestId, 68_420_13000000, ResponseStatus.Success);
        mockAgents.fulfillUint(firstRequestId + 1, 3_740_62000000, ResponseStatus.Success);
        mockAgents.fulfillUint(firstRequestId + 2, 18_420000, ResponseStatus.Success);
    }

    function assertMockRequest(uint256 requestId, string memory expectedSelector) private view {
        (
            uint256 agentId,
            address callbackAddress,
            bytes4 callbackSelector,
            uint256 value,
            bytes memory payload
        ) = mockAgents.requestRecord(requestId);

        assertEq(agentId, game.JSON_API_AGENT_ID(), "wrong agent id");
        assertEq(callbackAddress, address(game), "wrong callback address");
        assertEq(callbackSelector, game.handleResponse.selector, "wrong callback selector");
        assertEq(value, game.requiredFee(), "wrong request fee");
        assertEq(payloadSelector(payload), IJsonApiAgent.fetchUint.selector, "wrong payload selector");
        assertTrue(contains(payload, bytes(expectedSelector)), "selector missing from payload");
    }

    function assertMockLLMRequest(uint256 requestId) private view {
        (
            uint256 agentId,
            address callbackAddress,
            bytes4 callbackSelector,
            uint256 value,
            bytes memory payload
        ) = mockAgents.requestRecord(requestId);

        assertEq(agentId, game.LLM_INFERENCE_AGENT_ID(), "wrong llm agent id");
        assertEq(callbackAddress, address(game), "wrong llm callback address");
        assertEq(callbackSelector, game.handleResponse.selector, "wrong llm callback selector");
        assertEq(value, game.requiredGateDecisionFee(), "wrong llm request fee");
        assertEq(payloadSelector(payload), ILLMAgent.inferString.selector, "wrong llm payload selector");
        assertTrue(contains(payload, bytes("ROUTE=")), "route format missing from prompt");
        assertTrue(contains(payload, bytes("STORY=")), "story format missing from prompt");
        assertTrue(contains(payload, bytes("Floors:")), "floor preview missing from prompt");
        assertTrue(contains(payload, bytes("Aryn")), "hero name missing from prompt");
    }

    function assertMockArenaLLMRequest(uint256 requestId) private view {
        (
            uint256 agentId,
            address callbackAddress,
            bytes4 callbackSelector,
            uint256 value,
            bytes memory payload
        ) = mockAgents.requestRecord(requestId);

        assertEq(agentId, game.LLM_INFERENCE_AGENT_ID(), "wrong llm agent id");
        assertEq(callbackAddress, address(game), "wrong llm callback address");
        assertEq(callbackSelector, game.handleResponse.selector, "wrong llm callback selector");
        assertEq(value, game.requiredArenaNarrationFee(), "wrong arena llm fee");
        assertEq(payloadSelector(payload), ILLMAgent.inferString.selector, "wrong llm payload selector");
        assertTrue(contains(payload, bytes("STORY=")), "story format missing from prompt");
        assertTrue(contains(payload, bytes("Arena room")), "arena room missing from prompt");
        assertTrue(contains(payload, bytes("Winner")), "winner missing from prompt");
        assertTrue(contains(payload, bytes("Aryn")), "creator hero missing from prompt");
        assertTrue(contains(payload, bytes("Bryn")), "challenger hero missing from prompt");
    }

    function runIsActive(uint256 heroId) private view returns (bool active) {
        (active, , , ) = game.gateRuns(heroId);
    }

    function payloadSelector(bytes memory payload) private pure returns (bytes4 selector) {
        require(payload.length >= 4, "payload too short");
        assembly {
            selector := mload(add(payload, 32))
        }
    }

    function contains(bytes memory haystack, bytes memory needle) private pure returns (bool) {
        if (needle.length == 0 || needle.length > haystack.length) return false;

        for (uint256 i = 0; i <= haystack.length - needle.length; i++) {
            bool matched = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return true;
        }

        return false;
    }

    function assertEq(uint256 actual, uint256 expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function assertEq(uint16 actual, uint16 expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function assertEq(address actual, address expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function assertEq(bytes4 actual, bytes4 expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function assertEq(uint8 actual, uint8 expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function assertEq(bool actual, bool expected, string memory message) private pure {
        require(actual == expected, message);
    }

    function assertStringEq(string memory actual, string memory expected, string memory message) private pure {
        require(keccak256(bytes(actual)) == keccak256(bytes(expected)), message);
    }

    function assertTrue(bool condition, string memory message) private pure {
        require(condition, message);
    }
}
