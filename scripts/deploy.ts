import hre from "hardhat";
import { ethers } from "ethers";

async function main() {
	console.log("Deploying FraudDetection...");

	// Create provider
	const provider = new ethers.JsonRpcProvider(process.env.GANACHE_RPC);

	// Create wallet
	const wallet = new ethers.Wallet(process.env.GANACHE_PRIVATE_KEY!, provider);

	console.log("Deploying from:");
	console.log(wallet.address);

	// Load artifact
	const artifact = await hre.artifacts.readArtifact("FraudDetection");

	// Create factory manually
	const factory = new ethers.ContractFactory(
		artifact.abi,
		artifact.bytecode,
		wallet,
	);

	// Deploy
	const contract = await factory.deploy();

	await contract.waitForDeployment();

	console.log("\nFraudDetection deployed to:");

	console.log(await contract.getAddress());
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
