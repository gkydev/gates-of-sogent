// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "openzeppelin-contracts/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/// @title SogentWeaponNFT
/// @notice ERC721 weapons minted by the Gates of Sogent forge.
contract SogentWeaponNFT is ERC721Enumerable {
    struct WeaponStats {
        uint256 tier;
        uint256 arenaBonus;
        uint256 forgedAt;
    }

    address public immutable minter;
    uint256 public nextWeaponId = 1;

    mapping(uint256 => WeaponStats) public weaponStats;

    modifier onlyMinter() {
        require(msg.sender == minter, "Only game can mint");
        _;
    }

    constructor(address minter_) ERC721("Sogent Forged Weapon", "SFW") {
        require(minter_ != address(0), "Bad minter");
        minter = minter_;
    }

    function mintWeapon(address owner, uint256 tier, uint256 arenaBonus) external onlyMinter returns (uint256 weaponId) {
        require(owner != address(0), "Bad owner");
        require(tier > 0, "Bad tier");

        weaponId = nextWeaponId;
        nextWeaponId++;

        weaponStats[weaponId] = WeaponStats({tier: tier, arenaBonus: arenaBonus, forgedAt: block.timestamp});
        _safeMint(owner, weaponId);
    }

    function weaponTier(uint256 weaponId) external view returns (uint256) {
        require(_exists(weaponId), "Unknown weapon");
        return weaponStats[weaponId].tier;
    }

    function weaponArenaBonus(uint256 weaponId) external view returns (uint256) {
        require(_exists(weaponId), "Unknown weapon");
        return weaponStats[weaponId].arenaBonus;
    }
}
