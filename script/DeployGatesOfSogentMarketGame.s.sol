// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../contracts/GatesOfSogentMarketGame.sol";

interface ScriptVm {
    function envUint(string calldata key) external returns (uint256 value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

contract DeployGatesOfSogentMarketGame {
    ScriptVm private constant vm = ScriptVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (GatesOfSogentMarketGame game) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(privateKey);
        game = new GatesOfSogentMarketGame();
        vm.stopBroadcast();
    }
}
