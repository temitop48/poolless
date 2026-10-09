// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../PoollessV2.sol";

contract DeployPoollessV2 is Script {
    function run() external returns (PoollessV2) {
        vm.startBroadcast();

        PoollessV2 poolless = new PoollessV2(
            0x3600000000000000000000000000000000000000
        );

        vm.stopBroadcast();

        return poolless;
    }
}
