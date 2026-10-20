require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");
require("solidity-coverage");

const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");
const solc = require("solc");

// Utilise la version solc-js installée avec npm : compiler et tester restent hors ligne.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }, _hre, runSuper) => {
  if (solcVersion === "0.8.20") {
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: solcVersion,
      longVersion: solc.version(),
    };
  }
  return runSuper();
});

const { PRIVATE_KEY, SEPOLIA_RPC_URL, ETHERSCAN_API_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    sepolia: {
      url: SEPOLIA_RPC_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY || "",
    enabled: Boolean(ETHERSCAN_API_KEY),
  },
  sourcify: {
    // The bundled Hardhat 2 plugin still calls Sourcify API v1, which is retired.
    // Use scripts/verify-sourcify.js for Sourcify's current API v2.
    enabled: false,
  },
};
