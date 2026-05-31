// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/GatesOfSogentMarketGame.sol";

interface Vm {
    function chainId(uint256 chainId) external;
    function deal(address account, uint256 balance) external;
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address caller) external;
    function startPrank(address caller) external;
    function stopPrank() external;
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

        vm.startPrank(PLAYER);
        game.startGateRun(1);

        for (uint256 i = 0; i < 12 && runIsActive(1); i++) {
            game.resolveGateFloor(1);
        }
        vm.stopPrank();

        (, , uint16 hp, ) = game.gateRuns(1);
        assertTrue(hp <= 100, "hp cannot increase");
    }

    function testRequestGateDecisionCreatesLLMRequest() public {
        requestHero("Aryn");
        fulfillMarketRequests();

        vm.startPrank(PLAYER);
        game.startGateRun(1);
        uint256 fee = game.requiredGateDecisionFee();
        vm.deal(PLAYER, fee);
        uint256 requestId = game.requestGateDecision{value: fee}(1);
        vm.stopPrank();

        assertEq(requestId, 4, "wrong llm request id");
        assertEq(game.pendingRequests(4), true, "llm request missing");
        assertEq(game.pendingGateDecision(1), true, "hero decision not pending");
        assertEq(uint256(game.requestKind(4)), uint256(game.REQUEST_GATE_DECISION()), "wrong llm request kind");
        assertEq(game.requestToGroupId(4), 1, "wrong llm hero id");

        assertMockLLMRequest(4);
    }

    function testLLMGateDecisionReturnResolvesFloor() public {
        requestHero("Aryn");
        fulfillMarketRequests();

        vm.startPrank(PLAYER);
        game.startGateRun(1);
        uint256 fee = game.requiredGateDecisionFee();
        vm.deal(PLAYER, fee);
        game.requestGateDecision{value: fee}(1);
        vm.stopPrank();

        mockAgents.fulfillString(4, "RETURN", ResponseStatus.Success);

        (bool active, , uint16 hp, uint256 loot) = game.gateRuns(1);
        assertEq(active, false, "run should close");
        assertTrue(hp <= 100, "hp cannot increase");
        assertTrue(loot > 0, "loot should be kept");
        assertEq(game.shards(PLAYER), loot, "loot should be banked");
        assertStringEq(game.lastGateDecision(1), "RETURN", "wrong stored llm decision");
        assertEq(game.pendingGateDecision(1), false, "decision should clear");
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
        uint256 totalFee = game.requiredTotalFee();
        vm.deal(PLAYER, totalFee);
        vm.prank(PLAYER);
        groupId = game.requestHero{value: totalFee}(name);
    }

    function fulfillMarketRequests() private {
        mockAgents.fulfillUint(1, 68_420_13000000, ResponseStatus.Success);
        mockAgents.fulfillUint(2, 3_740_62000000, ResponseStatus.Success);
        mockAgents.fulfillUint(3, 18_420000, ResponseStatus.Success);
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
        assertTrue(contains(payload, bytes("CONTINUE")), "continue missing from prompt");
        assertTrue(contains(payload, bytes("RETURN")), "return missing from prompt");
        assertTrue(contains(payload, bytes("Aryn")), "hero name missing from prompt");
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
