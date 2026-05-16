import "dotenv/config";
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import { defineConfig } from "hardhat/config";

export default defineConfig({
	plugins: [hardhatEthers],

	solidity: {
		version: "0.8.20",
		settings: {
			evmVersion: "paris",
		},
	},

	networks: {
		ganache: {
			type: "http",
			chainType: "l1",
			url: process.env.GANACHE_RPC!,
			accounts: [process.env.GANACHE_PRIVATE_KEY!],
		},
	},
});
