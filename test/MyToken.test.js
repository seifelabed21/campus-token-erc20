const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const units = (value) => ethers.parseUnits(value.toString(), 18);

async function deployToken(options = {}) {
  const [owner] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MyToken");
  const token = await Token.deploy(
    options.name || "Campus Token",
    options.symbol || "CAMP",
    options.initialSupply ?? units(1000),
    options.cap ?? units(2000),
    options.faucetAmount ?? units(10)
  );
  return { token, owner };
}

describe("MyToken", function () {
  describe("Déploiement", function () {
    it("définit les métadonnées, les 18 décimales et l'offre initiale au propriétaire", async function () {
      const { token, owner } = await deployToken();
      expect(await token.name()).to.equal("Campus Token");
      expect(await token.symbol()).to.equal("CAMP");
      expect(await token.decimals()).to.equal(18);
      expect(await token.totalSupply()).to.equal(units(1000));
      expect(await token.balanceOf(owner.address)).to.equal(units(1000));
      expect(await token.owner()).to.equal(owner.address);
      expect(await token.cap()).to.equal(units(2000));
    });

    it("refuse une offre initiale supérieure au plafond", async function () {
      const Token = await ethers.getContractFactory("MyToken");
      await expect(Token.deploy("Token", "TKN", units(11), units(10), units(1)))
        .to.be.revertedWithCustomError(Token, "ERC20ExceededCap");
    });

    it("refuse un faucet nul", async function () {
      const Token = await ethers.getContractFactory("MyToken");
      await expect(Token.deploy("Token", "TKN", units(1), units(10), 0))
        .to.be.revertedWithCustomError(Token, "FaucetAmountMustBePositive");
    });
  });

  describe("ERC-20", function () {
    it("transfère les tokens et émet Transfer", async function () {
      const { token, owner } = await deployToken();
      const [, recipient] = await ethers.getSigners();
      await expect(token.transfer(recipient.address, units(25)))
        .to.emit(token, "Transfer").withArgs(owner.address, recipient.address, units(25));
      expect(await token.balanceOf(recipient.address)).to.equal(units(25));
    });

    it("approuve puis exécute transferFrom avec les événements attendus", async function () {
      const { token, owner } = await deployToken();
      const [, spender, recipient] = await ethers.getSigners();
      await expect(token.approve(spender.address, units(40)))
        .to.emit(token, "Approval").withArgs(owner.address, spender.address, units(40));
      expect(await token.allowance(owner.address, spender.address)).to.equal(units(40));
      await expect(token.connect(spender).transferFrom(owner.address, recipient.address, units(15)))
        .to.emit(token, "Transfer").withArgs(owner.address, recipient.address, units(15));
      expect(await token.allowance(owner.address, spender.address)).to.equal(units(25));
      expect(await token.balanceOf(recipient.address)).to.equal(units(15));
    });

    it("refuse un transfert supérieur au solde", async function () {
      const { token } = await deployToken();
      const [, recipient] = await ethers.getSigners();
      await expect(token.connect(recipient).transfer(recipient.address, 1))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("refuse les adresses zéro comme destinataire ou spender", async function () {
      const { token } = await deployToken();
      await expect(token.transfer(ethers.ZeroAddress, 1))
        .to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
      await expect(token.approve(ethers.ZeroAddress, 1))
        .to.be.revertedWithCustomError(token, "ERC20InvalidSpender");
    });

    it("refuse transferFrom si l'allowance est insuffisante", async function () {
      const { token, owner } = await deployToken();
      const [, spender, recipient] = await ethers.getSigners();
      await token.approve(spender.address, units(1));
      await expect(token.connect(spender).transferFrom(owner.address, recipient.address, units(2)))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });

  describe("Extensions", function () {
    it("autorise le mint au propriétaire uniquement et respecte le cap", async function () {
      const { token, owner } = await deployToken();
      const [, recipient] = await ethers.getSigners();
      await expect(token.mint(recipient.address, units(5)))
        .to.emit(token, "Transfer").withArgs(ethers.ZeroAddress, recipient.address, units(5));
      await expect(token.connect(recipient).mint(recipient.address, 1))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
      await expect(token.mint(owner.address, units(996)))
        .to.be.revertedWithCustomError(token, "ERC20ExceededCap");
    });

    it("permet à chacun de brûler ses tokens", async function () {
      const { token, owner } = await deployToken();
      await expect(token.burn(units(20)))
        .to.emit(token, "Transfer").withArgs(owner.address, ethers.ZeroAddress, units(20));
      expect(await token.totalSupply()).to.equal(units(980));
    });

    it("bloque les opérations pendant la pause et les rétablit ensuite", async function () {
      const { token, owner } = await deployToken();
      const [, recipient] = await ethers.getSigners();
      await token.pause();
      await expect(token.transfer(recipient.address, 1))
        .to.be.revertedWithCustomError(token, "EnforcedPause");
      await expect(token.mint(recipient.address, 1))
        .to.be.revertedWithCustomError(token, "EnforcedPause");
      await expect(token.connect(recipient).pause())
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
      await token.unpause();
      await token.transfer(recipient.address, 1);
      expect(await token.balanceOf(recipient.address)).to.equal(1);
      expect(await token.owner()).to.equal(owner.address);
    });

    it("distribue le faucet et impose un délai de 24 heures par adresse", async function () {
      const { token } = await deployToken();
      const [, user] = await ethers.getSigners();
      await expect(token.connect(user).claimFaucet())
        .to.emit(token, "FaucetClaimed").withArgs(user.address, units(10));
      expect(await token.balanceOf(user.address)).to.equal(units(10));
      await expect(token.connect(user).claimFaucet())
        .to.be.revertedWithCustomError(token, "FaucetCooldownActive");
      await network.provider.send("evm_increaseTime", [24 * 60 * 60]);
      await network.provider.send("evm_mine");
      await token.connect(user).claimFaucet();
      expect(await token.balanceOf(user.address)).to.equal(units(20));
    });

    it("ne distribue pas de faucet au-delà du plafond", async function () {
      const { token } = await deployToken({ initialSupply: units(1995), cap: units(2000), faucetAmount: units(10) });
      const [, user] = await ethers.getSigners();
      await expect(token.connect(user).claimFaucet())
        .to.be.revertedWithCustomError(token, "ERC20ExceededCap");
      expect(await token.lastFaucetClaim(user.address)).to.equal(0);
    });
  });
});
