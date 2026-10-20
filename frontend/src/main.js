import { ethers } from "ethers";
import deployment from "./contract.json";

const SEPOLIA_ID = 11155111n;
const LOCAL_ID = 31337n;
const $ = (id) => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Élément #${id} absent de la page. Rechargez l'interface.`);
  return element;
};

let provider;
let signer;
let account = null;
let chainId = null;
let readContract;
let writeContract;
let eventContract;
let tokenSymbol = "CAMP";

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatToken(value, maximumFractionDigits = 4) {
  const number = Number(ethers.formatUnits(value, 18));
  if (!Number.isFinite(number)) return ethers.formatUnits(value, 18);
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits }).format(number);
}

function setNotice(message, kind = "") {
  const notice = $("app-notice");
  notice.className = `notice ${kind}`.trim();
  $("notice-text").textContent = message;
}

function setFormStatus(id, message = "", isError = false) {
  const element = $(id);
  element.className = `form-status${isError ? " error-text" : ""}`;
  element.textContent = message;
}

function setTxStatus(id, hash, confirmed) {
  const element = $(id);
  const label = confirmed ? "Transaction confirmée" : "Transaction envoyée";
  const link = chainId === SEPOLIA_ID
    ? `<a href="https://sepolia.etherscan.io/tx/${hash}" target="_blank" rel="noreferrer">${hash} ↗</a>`
    : `${hash}${chainId === LOCAL_ID ? " (local)" : ""}`;
  element.className = "form-status";
  element.innerHTML = `${label} : ${link}`;
}

function networkLabel(id) {
  if (id === SEPOLIA_ID) return "Sepolia Testnet";
  if (id === LOCAL_ID) return "Hardhat Local";
  return "Réseau non pris en charge";
}

function isSupportedChain() {
  return chainId === SEPOLIA_ID || chainId === LOCAL_ID;
}

function deploymentMatchesNetwork() {
  return Boolean(deployment.address && deployment.abi?.length && BigInt(deployment.chainId || 0) === chainId);
}

function updateNetworkUI() {
  const name = chainId === null ? "Wallet déconnecté" : networkLabel(chainId);
  $("network-name").textContent = name;
  $("footer-contract").textContent = deployment.address ? shortAddress(deployment.address) : "Contrat non déployé";
  $("switch-sepolia").hidden = chainId === SEPOLIA_ID;
  $("switch-local").hidden = chainId === LOCAL_ID;
  document.querySelector(".network-pill").classList.toggle("connected", chainId !== null && isSupportedChain());
}

function enableWriteControls(enabled) {
  const selectors = [
    "#transfer-form button[type=submit]", "#approve-form button[type=submit]",
    "#transferfrom-form button[type=submit]", "#burn-form button[type=submit]",
    "#mint-form button[type=submit]", "#faucet-button", "#pause-button", "#unpause-button",
  ];
  for (const selector of selectors) document.querySelector(selector).disabled = !enabled;
}

function txLink(hash) {
  if (chainId === SEPOLIA_ID) return `<a class="history-link" href="https://sepolia.etherscan.io/tx/${hash}" target="_blank" rel="noreferrer">${hash.slice(0, 10)}…${hash.slice(-6)} ↗</a>`;
  if (chainId === LOCAL_ID) return `${hash.slice(0, 10)}…${hash.slice(-6)} (local)`;
  return hash;
}

function explainError(error) {
  if (error?.code === 4001 || error?.info?.error?.code === 4001) return "Transaction refusée dans MetaMask.";
  const text = `${error?.shortMessage || ""} ${error?.reason || ""} ${error?.message || ""}`.toLowerCase();
  if (text.includes("insufficient funds")) return "Solde ETH insuffisant pour payer le gas.";
  if (text.includes("insufficient balance") || text.includes("erc20insufficientbalance") || (text.includes("solde") && text.includes("insuffisant"))) return "Votre solde de tokens est insuffisant.";
  if (text.includes("insufficient allowance") || text.includes("erc20insufficientallowance") || (text.includes("allowance") && text.includes("insuffisante"))) return "Allowance insuffisante : demandez d'abord une autorisation au propriétaire.";
  if (text.includes("exceededcap") || text.includes("cap")) return "Cette opération dépasserait le plafond maximal du token.";
  if (text.includes("cooldownactive")) return "Le faucet est limité à une réclamation toutes les 24 heures.";
  if (text.includes("enforcedpause")) return "Le contrat est en pause. Les transferts sont désactivés.";
  if (text.includes("ownableunauthorizedaccount") || text.includes("caller is not the owner")) return "Cette fonction est réservée au propriétaire du contrat.";
  if (text.includes("network") || text.includes("chain")) return "Le réseau du portefeuille ne correspond pas au réseau du contrat.";
  return error?.shortMessage || error?.reason || error?.message || "Une erreur inattendue est survenue.";
}

function validateAddress(value, label) {
  const address = value.trim();
  if (!ethers.isAddress(address)) throw new Error(`${label} : adresse Ethereum invalide.`);
  return ethers.getAddress(address);
}

function parseAmount(value, label = "Montant") {
  if (!value || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new Error(`${label} : entrez un montant supérieur à zéro.`);
  }
  try {
    return ethers.parseUnits(value, 18);
  } catch {
    throw new Error(`${label} : maximum 18 décimales.`);
  }
}

function requireWritableContract() {
  if (!account || !signer) throw new Error("Connectez d'abord MetaMask.");
  if (!isSupportedChain()) throw new Error("Passez sur Sepolia ou sur Hardhat Local.");
  if (!deploymentMatchesNetwork() || !writeContract) {
    throw new Error(`Aucun contrat déployé sur ${networkLabel(chainId)}. Déployez-le avec le script correspondant.`);
  }
  return writeContract;
}

async function submitTransaction(statusId, action) {
  try {
    setFormStatus(statusId, "Confirmez la transaction dans MetaMask…");
    const { tx, done } = await action();
    setTxStatus(statusId, tx.hash, false);
    await done;
    setTxStatus(statusId, tx.hash, true);
    setNotice("Transaction confirmée sur la blockchain.", "success");
    await refreshValues();
    await loadHistory();
  } catch (error) {
    const message = explainError(error);
    setFormStatus(statusId, message, true);
    setNotice(message, "error");
  }
}

async function refreshValues() {
  if (!provider) return;
  try {
    const net = await provider.getNetwork();
    chainId = net.chainId;
    updateNetworkUI();
    $("hero-chain-id").textContent = chainId.toString();
    if (account) {
      const ethBalance = await provider.getBalance(account);
      $("wallet-address").textContent = account;
      $("eth-balance").textContent = `${Number(ethers.formatEther(ethBalance)).toLocaleString("fr-FR", { maximumFractionDigits: 4 })} ETH`;
    } else {
      $("wallet-address").textContent = "Connectez votre portefeuille pour commencer";
      $("eth-balance").textContent = "—";
    }

    if (!deployment.address || !deployment.abi?.length) {
      enableWriteControls(false);
      setNotice("Aucun déploiement détecté. Lancez le script de déploiement pour générer l'adresse et l'ABI.");
      return;
    }
    if (!deploymentMatchesNetwork()) {
      enableWriteControls(false);
      const target = Number(deployment.chainId) === Number(SEPOLIA_ID) ? "Sepolia" : "Hardhat Local";
      setNotice(`Le contrat chargé est sur ${target}. Changez le réseau MetaMask pour continuer.`, "error");
      return;
    }

    readContract = new ethers.Contract(deployment.address, deployment.abi, provider);
    signer = account ? await provider.getSigner(account) : null;
    writeContract = signer ? readContract.connect(signer) : null;
    enableWriteControls(Boolean(account));

    const [name, symbol, totalSupply, cap] = await Promise.all([
      readContract.name(), readContract.symbol(), readContract.totalSupply(), readContract.cap(),
    ]);
    tokenSymbol = symbol;
    $("hero-token-name").textContent = name;
    $("hero-token-symbol").textContent = `${symbol} · ERC-20`;
    $("transfer-symbol").textContent = symbol;
    $("approve-symbol").textContent = symbol;
    $("transferfrom-symbol").textContent = symbol;
    document.querySelectorAll(".token-symbol").forEach((node) => { node.textContent = symbol; });
    $("total-supply").textContent = formatToken(totalSupply);
    $("token-cap").textContent = formatToken(cap);
    $("token-balance").textContent = account ? formatToken(await readContract.balanceOf(account)) : "—";
    $("allowance-value").innerHTML = `— <small>${symbol}</small>`;

    if (account) {
      const ownerAddress = await readContract.owner();
      const isOwner = ownerAddress.toLowerCase() === account.toLowerCase();
      document.querySelectorAll(".owner-restricted").forEach((control) => { control.disabled = !isOwner; });
      $("pause-state").textContent = await readContract.paused() ? "En pause" : "Actif";
      $("pause-button").disabled = !isOwner || await readContract.paused();
      $("unpause-button").disabled = !isOwner || !(await readContract.paused());
      setNotice(isOwner ? "Portefeuille connecté comme propriétaire du contrat." : "Portefeuille connecté. Transferts, allowance et faucet sont disponibles.", "success");
    } else {
      document.querySelectorAll(".owner-restricted").forEach((control) => { control.disabled = true; });
      $("pause-state").textContent = await readContract.paused() ? "En pause" : "Actif";
      $("pause-button").disabled = true;
      $("unpause-button").disabled = true;
      setNotice("Contrat connecté en lecture seule. Connectez MetaMask pour envoyer des transactions.");
    }
    await refreshAllowance();
    if (account) await loadHistory();
    else $("history-list").innerHTML = '<div class="empty-state">Connectez votre portefeuille pour voir l’activité.</div>';
    attachEventListeners();
  } catch (error) {
    enableWriteControls(false);
    setNotice(`Impossible de lire le contrat : ${explainError(error)}`, "error");
  }
}

async function refreshAllowance() {
  if (!readContract || !account) return;
  if (!$("allowance-owner").value.trim()) $("allowance-owner").value = account;
  const owner = $("allowance-owner").value.trim();
  const spender = $("approve-spender").value.trim();
  if (!ethers.isAddress(owner) || !ethers.isAddress(spender)) {
    $("allowance-value").innerHTML = `— <small>${tokenSymbol}</small>`;
    return;
  }
  try {
    const value = await readContract.allowance(ethers.getAddress(owner), ethers.getAddress(spender));
    $("allowance-value").innerHTML = `${formatToken(value)} <small>${escapeHtml(tokenSymbol)}</small>`;
  } catch (error) {
    setFormStatus("approve-status", explainError(error), true);
  }
}

async function loadHistory() {
  if (!readContract || !account) return;
  const list = $("history-list");
  try {
    const fromFilter = readContract.filters.Transfer(account, null);
    const toFilter = readContract.filters.Transfer(null, account);
    const [outgoing, incoming] = await Promise.all([
      readContract.queryFilter(fromFilter, Number(deployment.deployedBlock || 0), "latest"),
      readContract.queryFilter(toFilter, Number(deployment.deployedBlock || 0), "latest"),
    ]);
    const unique = new Map();
    for (const event of [...outgoing, ...incoming]) unique.set(`${event.transactionHash}-${event.index}`, event);
    const events = [...unique.values()].sort((a, b) => b.blockNumber - a.blockNumber || b.index - a.index).slice(0, 8);
    if (!events.length) {
      list.innerHTML = '<div class="empty-state">Aucun transfert trouvé pour cette adresse.</div>';
      return;
    }
    list.innerHTML = events.map((event) => {
      const [from, to, amount] = event.args;
      const outgoingEvent = from.toLowerCase() === account.toLowerCase();
      const counterparty = outgoingEvent ? to : from;
      const direction = outgoingEvent ? "sortant" : "entrant";
      const symbol = escapeHtml(tokenSymbol);
      const txHash = escapeHtml(event.transactionHash);
      return `<div class="history-row"><span class="history-direction ${outgoingEvent ? "outgoing" : ""}">${outgoingEvent ? "↗" : "↙"}</span><div class="history-main"><strong>${direction} · ${shortAddress(counterparty)}</strong><small>Bloc ${event.blockNumber} · <a class="history-link" href="${chainId === SEPOLIA_ID ? `https://sepolia.etherscan.io/tx/${txHash}` : "#"}" ${chainId === SEPOLIA_ID ? 'target="_blank" rel="noreferrer"' : ""}>${txHash.slice(0, 10)}… ↗</a></small></div><span class="history-amount ${outgoingEvent ? "outgoing" : ""}">${outgoingEvent ? "−" : "+"}${formatToken(amount)} ${symbol}</span></div>`;
    }).join("");
  } catch (error) {
    list.innerHTML = `<div class="empty-state">Historique indisponible : ${escapeHtml(explainError(error))}</div>`;
  }
}

function attachEventListeners() {
  if (!readContract || !deploymentMatchesNetwork()) return;
  if (eventContract) eventContract.removeAllListeners();
  eventContract = readContract;
  eventContract.on("Transfer", async () => {
    try {
      const [supply, cap] = await Promise.all([readContract.totalSupply(), readContract.cap()]);
      $("total-supply").textContent = formatToken(supply);
      $("token-cap").textContent = formatToken(cap);
      if (account) $("token-balance").textContent = formatToken(await readContract.balanceOf(account));
      await loadHistory();
    } catch { /* Le prochain rafraîchissement manuel relira les valeurs. */ }
  });
  eventContract.on("Approval", refreshAllowance);
}

async function connectWallet() {
  if (!window.ethereum) {
    setNotice("MetaMask n'est pas détecté. Installez l'extension, puis rechargez cette page.", "error");
    return;
  }
  try {
    provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);
    account = accounts[0] || null;
    await refreshValues();
  } catch (error) {
    setNotice(explainError(error), "error");
  }
}

async function switchNetwork(target) {
  if (!window.ethereum) return setNotice("MetaMask n'est pas détecté.", "error");
  const local = target === "local";
  const chainHex = local ? "0x7a69" : "0xaa36a7";
  const chainName = local ? "Hardhat Local" : "Sepolia";
  const chain = local
    ? { chainId: chainHex, chainName, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["http://127.0.0.1:8545"] }
    : { chainId: chainHex, chainName, nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://rpc.sepolia.org"], blockExplorerUrls: ["https://sepolia.etherscan.io"] };
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
  } catch (error) {
    if (error.code === 4902) {
      try {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [chain] });
      } catch (addError) {
        setNotice(explainError(addError), "error");
      }
    } else {
      setNotice(explainError(error), "error");
    }
  }
}

function wireForm(formId, statusId, action) {
  $(formId).addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      requireWritableContract();
      await action();
    } catch (error) {
      const message = explainError(error);
      setFormStatus(statusId, message, true);
      setNotice(message, "error");
    }
  });
}

wireForm("transfer-form", "transfer-status", async () => submitTransaction("transfer-status", async () => {
  const to = validateAddress($("transfer-to").value, "Destinataire");
  const amount = parseAmount($("transfer-amount").value);
  if (amount > await readContract.balanceOf(account)) throw new Error("Solde de tokens insuffisant pour cet envoi.");
  const tx = await writeContract.transfer(to, amount);
  return { tx, done: tx.wait() };
}));

wireForm("approve-form", "approve-status", async () => submitTransaction("approve-status", async () => {
  const spender = validateAddress($("approve-spender").value, "Spender");
  const amount = parseAmount($("approve-amount").value);
  const tx = await writeContract.approve(spender, amount);
  return { tx, done: tx.wait() };
}));

wireForm("transferfrom-form", "transferfrom-status", async () => submitTransaction("transferfrom-status", async () => {
  const owner = validateAddress($("transferfrom-owner").value, "Propriétaire");
  const to = validateAddress($("transferfrom-to").value, "Destinataire");
  const amount = parseAmount($("transferfrom-amount").value);
  if (amount > await readContract.allowance(owner, account)) throw new Error("Allowance insuffisante pour ce transfert.");
  if (amount > await readContract.balanceOf(owner)) throw new Error("Solde du propriétaire insuffisant pour ce transfert.");
  const tx = await writeContract.transferFrom(owner, to, amount);
  return { tx, done: tx.wait() };
}));

wireForm("mint-form", "mint-status", async () => submitTransaction("mint-status", async () => {
  const to = validateAddress($("mint-to").value, "Destinataire");
  const amount = parseAmount($("mint-amount").value);
  const tx = await writeContract.mint(to, amount);
  return { tx, done: tx.wait() };
}));

wireForm("burn-form", "burn-status", async () => submitTransaction("burn-status", async () => {
  const amount = parseAmount($("burn-amount").value);
  const tx = await writeContract.burn(amount);
  return { tx, done: tx.wait() };
}));

$("connect-button").addEventListener("click", connectWallet);
$("switch-sepolia").addEventListener("click", () => switchNetwork("sepolia"));
$("switch-local").addEventListener("click", () => switchNetwork("local"));
$("check-allowance").addEventListener("click", refreshAllowance);
$("approve-spender").addEventListener("input", refreshAllowance);
$("allowance-owner").addEventListener("input", refreshAllowance);
$("refresh-history").addEventListener("click", loadHistory);
$("faucet-button").addEventListener("click", async () => {
  try {
    const contract = requireWritableContract();
    await submitTransaction("faucet-status", async () => {
      const tx = await contract.claimFaucet();
      return { tx, done: tx.wait() };
    });
  } catch (error) {
    setFormStatus("faucet-status", explainError(error), true);
  }
});

$("pause-button").addEventListener("click", async () => {
  try {
    const contract = requireWritableContract();
    await submitTransaction("pause-status", async () => {
      const tx = await contract.pause();
      return { tx, done: tx.wait() };
    });
  } catch (error) { setFormStatus("pause-status", explainError(error), true); }
});

$("unpause-button").addEventListener("click", async () => {
  try {
    const contract = requireWritableContract();
    await submitTransaction("pause-status", async () => {
      const tx = await contract.unpause();
      return { tx, done: tx.wait() };
    });
  } catch (error) { setFormStatus("pause-status", explainError(error), true); }
});

if (window.ethereum) {
  provider = new ethers.BrowserProvider(window.ethereum);
  window.ethereum.on("accountsChanged", async (accounts) => {
    account = accounts[0] || null;
    signer = null;
    await refreshValues();
  });
  window.ethereum.on("chainChanged", async () => {
    provider = new ethers.BrowserProvider(window.ethereum);
    await refreshValues();
  });
  provider.getNetwork().then(async (net) => {
    chainId = net.chainId;
    updateNetworkUI();
    await refreshValues();
  }).catch(() => updateNetworkUI());
} else {
  setNotice("Installez MetaMask pour connecter un portefeuille. Le site restera en lecture seule.");
  updateNetworkUI();
}
