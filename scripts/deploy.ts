import hre from "hardhat";
import { ethers } from "ethers";
import fs from "fs";

async function main() {
	console.log("Deploying FraudDetection...\n");

	// =====================================
	// PROVIDER
	// =====================================

	const provider = new ethers.JsonRpcProvider(process.env.GANACHE_RPC);

	// =====================================
	// WALLET
	// =====================================

	const wallet = new ethers.Wallet(process.env.GANACHE_PRIVATE_KEY!, provider);

	console.log("Deploying from:");
	console.log(wallet.address);

	// =====================================
	// LOAD ARTIFACT
	// =====================================

	const artifact = await hre.artifacts.readArtifact("FraudDetection");

	// =====================================
	// FACTORY
	// =====================================

	const factory = new ethers.ContractFactory(
		artifact.abi,
		artifact.bytecode,
		wallet,
	);

	// =====================================
	// DEPLOY
	// =====================================

	const contract = await factory.deploy();

	await contract.waitForDeployment();

	const contractAddress = await contract.getAddress();

	console.log("\nFraudDetection deployed to:");
	console.log(contractAddress);

	// =====================================
	// SAVE DEPLOYMENT
	// =====================================

	const deployment = {
		network: "ganache",
		contract: "FraudDetection",
		address: contractAddress,
		deployedBy: wallet.address,
		timestamp: new Date().toISOString(),
	};

	fs.writeFileSync(
		"./blockchain/deployment.json",
		JSON.stringify(deployment, null, 2),
	);

	console.log("\nSaved deployment → blockchain/deployment.json");

	// =====================================
	// SAVE ABI FOR PYTHON
	// =====================================

	fs.writeFileSync(
		"./blockchain/abi.json",
		JSON.stringify(artifact.abi, null, 2),
	);

	console.log("Saved ABI → blockchain/abi.json");
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
