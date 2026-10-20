const fs = require("node:fs");
const path = require("node:path");
const { ethers, network, artifacts } = require("hardhat");

async function main() {
  const tokenName = process.env.TOKEN_NAME || "Campus Token";
  const tokenSymbol = process.env.TOKEN_SYMBOL || "CAMP";
  const initialSupply = ethers.parseUnits(process.env.INITIAL_SUPPLY || "1000000", 18);
  const cap = ethers.parseUnits(process.env.TOKEN_CAP || "10000000", 18);
  const faucetAmount = ethers.parseUnits(process.env.FAUCET_AMOUNT || "100", 18);

  if (initialSupply > cap) {
    throw new Error("INITIAL_SUPPLY ne peut pas dépasser TOKEN_CAP.");
  }

  const Token = await ethers.getContractFactory("MyToken");
  const token = await Token.deploy(tokenName, tokenSymbol, initialSupply, cap, faucetAmount);
  const deploymentTx = token.deploymentTransaction();
  await token.waitForDeployment();

  const confirmations = network.name === "sepolia" ? 2 : 1;
  const receipt = await deploymentTx.wait(confirmations);
  const address = await token.getAddress();
  const artifact = await artifacts.readArtifact("MyToken");
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const deployment = {
    address,
    chainId,
    network: network.name,
    deployedBlock: receipt.blockNumber,
    abi: artifact.abi,
  };

  const outputPath = path.resolve(__dirname, "../frontend/src/contract.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`, "utf8");

  console.log(`MyToken déployé sur ${network.name} : ${address}`);
  console.log(`Réseau (chainId) : ${chainId}`);
  console.log(`Adresse et ABI enregistrées dans ${outputPath}`);
  if (network.name === "sepolia") {
    console.log(`Etherscan : https://sepolia.etherscan.io/address/${address}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
