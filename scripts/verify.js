const fs = require("node:fs");
const path = require("node:path");
const { run, ethers } = require("hardhat");

async function main() {
  const deploymentPath = path.resolve(__dirname, "../frontend/src/contract.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("Déployez d'abord le contrat sur Sepolia pour créer frontend/src/contract.json.");
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  if (deployment.chainId !== 11155111) {
    throw new Error("Le fichier de déploiement ne correspond pas à Sepolia.");
  }

  const constructorArguments = [
    process.env.TOKEN_NAME || "Campus Token",
    process.env.TOKEN_SYMBOL || "CAMP",
    ethers.parseUnits(process.env.INITIAL_SUPPLY || "1000000", 18),
    ethers.parseUnits(process.env.TOKEN_CAP || "10000000", 18),
    ethers.parseUnits(process.env.FAUCET_AMOUNT || "100", 18),
  ];

  await run("verify:verify", {
    address: deployment.address,
    constructorArguments,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
