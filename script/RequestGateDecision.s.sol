// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface GateDecisionGame {
    function requiredGateDecisionFee() external view returns (uint256);
    function startAdventure(uint256 heroId) external payable returns (uint256 requestId);
}

interface RequestGateVm {
    function envAddress(string calldata key) external returns (address value);
    function envOr(string calldata key, uint256 defaultValue) external returns (uint256 value);
    function envUint(string calldata key) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract RequestGateDecision {
    RequestGateVm private constant vm = RequestGateVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (uint256 requestId) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address gameAddress = vm.envAddress("GAME_ADDRESS");
        uint256 heroId = vm.envOr("HERO_ID", uint256(1));

        GateDecisionGame game = GateDecisionGame(gameAddress);
        uint256 fee = game.requiredGateDecisionFee();

        vm.startBroadcast(privateKey);
        requestId = game.startAdventure{value: fee}(heroId);
        vm.stopBroadcast();
    }
}
