import { ethers } from "ethers";
import { env } from "../config/env.js";

// Read-only provider used solely to pick the commit-reveal block for a mint
// signature. We never send transactions from the backend.
let provider = null;

function getProvider() {
  if (!env.rpcUrl) return null;
  if (!provider) {
    provider = new ethers.JsonRpcProvider(env.rpcUrl, Number(env.chainId));
  }
  return provider;
}

// The future block whose hash the contract will use to derive a token's
// traits/rarity. Chosen at signing time and a few blocks ahead so it isn't
// mined yet — that's what makes the outcome impossible to grind. The mint must
// then land within the chain's 256-block hash window.
export async function pickRevealBlock() {
  const p = getProvider();
  if (!p) {
    console.warn(
      "RPC_URL is not set — revealBlock defaults to 0 and on-chain mints will fail until it is configured."
    );
    return 0;
  }
  const current = await p.getBlockNumber();
  return current + env.revealBufferBlocks;
}
