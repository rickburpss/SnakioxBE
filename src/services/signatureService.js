import { ethers } from "ethers";
import { env } from "../config/env.js";
import { badRequest } from "../utils/errors.js";

const registerPrefix = "Register for Snakiox with wallet";

export function normalizeWallet(wallet) {
  return ethers.getAddress(wallet);
}

export function getRegistrationMessage(wallet) {
  return `${registerPrefix} ${normalizeWallet(wallet)}`;
}

export function verifyRegistrationSignature(wallet, signature) {
  const normalizedWallet = normalizeWallet(wallet);
  const recovered = ethers.verifyMessage(
    getRegistrationMessage(normalizedWallet),
    signature
  );

  return normalizeWallet(recovered) === normalizedWallet;
}

export function getGameSignerAddress() {
  return getGameSigner().address;
}

export function buildMintPayload({
  wallet,
  sessionId,
  score,
  snakeLength,
  finalSnakeCells,
  random = false,
  revealBlock = 0
}) {
  const normalizedWallet = normalizeWallet(wallet);
  // The mint takes only the hash of the replay blob (signed below); the raw blob
  // never goes on-chain. For a random-score mint there is no play, so the hash is
  // just a sentinel over the session id. `random` is part of the signed payload
  // so the on-chain mode can't be forged.
  const snakeDataHash = random
    ? ethers.id(`random:${sessionId}`)
    : ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(finalSnakeCells)));

  const payloadHash = ethers.solidityPackedKeccak256(
    ["address", "bytes32", "bytes32", "uint256", "uint256", "bool", "uint256", "address", "uint256"],
    [
      normalizedWallet,
      ethers.id(sessionId),
      snakeDataHash,
      BigInt(score),
      BigInt(snakeLength),
      random,
      BigInt(revealBlock),
      env.mintContractAddress,
      env.chainId
    ]
  );

  return {
    wallet: normalizedWallet,
    sessionId,
    sessionHash: ethers.id(sessionId),
    snakeDataHash,
    score,
    snakeLength,
    random,
    revealBlock,
    contractAddress: env.mintContractAddress,
    chainId: env.chainId.toString(),
    payloadHash
  };
}

export async function signMintPayload(payload) {
  const signer = getGameSigner();
  return signer.signMessage(ethers.getBytes(payload.payloadHash));
}

function getGameSigner() {
  if (!env.gameSignerPrivateKey || /^0x0+$/.test(env.gameSignerPrivateKey)) {
    throw badRequest("GAME_SIGNER_PRIVATE_KEY must be configured");
  }

  return new ethers.Wallet(env.gameSignerPrivateKey);
}
