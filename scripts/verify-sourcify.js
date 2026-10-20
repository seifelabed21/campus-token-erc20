const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const CHAIN_ID = 11155111;
const CONTRACT_ID = "contracts/MyToken.sol:MyToken";
const SOURCIFY_API = "https://sourcify.dev/server/v2";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const deploymentPath = path.resolve(__dirname, "../frontend/src/contract.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("No deployment file found at frontend/src/contract.json.");
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  if (deployment.chainId !== CHAIN_ID) {
    throw new Error("The deployment file does not point to Sepolia.");
  }

  await hre.run("compile");

  const buildInfoDir = path.resolve(__dirname, "../artifacts/build-info");
  const buildInfo = fs.readdirSync(buildInfoDir)
    .map((filename) => JSON.parse(fs.readFileSync(path.join(buildInfoDir, filename), "utf8")))
    .find((info) => info.output?.contracts?.["contracts/MyToken.sol"]?.MyToken);

  if (!buildInfo) {
    throw new Error(`Could not find compiler input for ${CONTRACT_ID}.`);
  }

  const compilerVersion = buildInfo.solcLongVersion.split(".Emscripten")[0];
  const response = await fetch(
    `${SOURCIFY_API}/verify/${CHAIN_ID}/${deployment.address}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stdJsonInput: buildInfo.input,
        compilerVersion,
        contractIdentifier: CONTRACT_ID,
      }),
    },
  );
  const submission = await response.json();

  if (!response.ok) {
    throw new Error(`Sourcify rejected the submission (${response.status}): ${JSON.stringify(submission)}`);
  }

  if (submission.verificationId) {
    let result;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(2000);
      const statusResponse = await fetch(`${SOURCIFY_API}/verify/${submission.verificationId}`);
      result = await statusResponse.json();
      if (!statusResponse.ok) {
        throw new Error(`Could not read Sourcify status (${statusResponse.status}): ${JSON.stringify(result)}`);
      }
      const serialized = JSON.stringify(result).toLowerCase();
      if (serialized.includes("perfect") || serialized.includes("partial") || serialized.includes("verified")) {
        console.log(JSON.stringify(result, null, 2));
        console.log(`Sourcify contract page: https://repo.sourcify.dev/${CHAIN_ID}/${deployment.address}`);
        return;
      }
      if (serialized.includes("error") || serialized.includes("failed")) {
        throw new Error(`Sourcify verification failed: ${JSON.stringify(result)}`);
      }
    }

    throw new Error(`Sourcify verification is still processing: ${JSON.stringify(result)}`);
  }

  console.log(JSON.stringify(submission, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
