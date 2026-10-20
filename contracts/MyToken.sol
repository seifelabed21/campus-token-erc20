// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title MyToken
/// @author Projet universitaire Gestion d'un Token ERC-20
/// @notice ERC-20 plafonné avec mint propriétaire, pause d'urgence et faucet journalier.
contract MyToken is ERC20, ERC20Burnable, ERC20Capped, ERC20Pausable, Ownable {
    uint256 public immutable faucetAmount;
    uint256 public constant FAUCET_COOLDOWN = 24 hours;

    mapping(address => uint256) public lastFaucetClaim;

    error FaucetCooldownActive(uint256 nextClaimAt);
    error FaucetAmountMustBePositive();

    event FaucetClaimed(address indexed account, uint256 amount);

    /// @param name_ Nom du token affiché dans les portefeuilles.
    /// @param symbol_ Symbole court du token.
    /// @param initialSupply_ Offre initiale en unités minimales (18 décimales).
    /// @param cap_ Offre maximale en unités minimales (18 décimales).
    /// @param faucetAmount_ Quantité distribuée à chaque réclamation (18 décimales).
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply_,
        uint256 cap_,
        uint256 faucetAmount_
    ) ERC20(name_, symbol_) ERC20Capped(cap_) Ownable(msg.sender) {
        if (faucetAmount_ == 0) revert FaucetAmountMustBePositive();
        faucetAmount = faucetAmount_;
        _mint(msg.sender, initialSupply_);
    }

    /// @notice Crée de nouveaux tokens. Seul le propriétaire peut appeler cette fonction.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Met les transferts, mint et burn en pause d'urgence.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Réactive les opérations sur les tokens.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Distribue la quantité du faucet une fois toutes les 24 heures par adresse.
    function claimFaucet() external {
        uint256 nextClaimAt = lastFaucetClaim[msg.sender] + FAUCET_COOLDOWN;
        if (lastFaucetClaim[msg.sender] != 0 && block.timestamp < nextClaimAt) {
            revert FaucetCooldownActive(nextClaimAt);
        }

        // État mis à jour avant le mint : le contrat ne fait aucun appel externe.
        lastFaucetClaim[msg.sender] = block.timestamp;
        _mint(msg.sender, faucetAmount);
        emit FaucetClaimed(msg.sender, faucetAmount);
    }

    /// @dev Combine les contrôles de plafond et de pause d'OpenZeppelin.
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20, ERC20Capped, ERC20Pausable)
    {
        super._update(from, to, value);
    }
}
