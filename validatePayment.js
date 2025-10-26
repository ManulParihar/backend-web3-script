import { createPublicClient, http, parseAbi, formatUnits, getAddress, parseEventLogs } from "viem";
import {
    mainnet,
    arbitrum,
    base,
    optimism,
} from "viem/chains";
import { getETHPriceUSD } from "./getETHPrice.js";

const ERC20_ABI = parseAbi([
    "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

const MAINNET_STABLECOINS = {
    USDC: {
        [mainnet.id]: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        [arbitrum.id]: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
        [base.id]: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        [optimism.id]: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"
    },
    USDT: {
        [mainnet.id]: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    },
    DAI: {
        [mainnet.id]: "0x6b175474e89094c44da98b954eedeac495271d0f",
    }
};

const CHAIN_MAP = {
    mainnet,
    arbitrum,
    base,
    optimism,
};

// Address of the vault that receives payment.
const VAULT = "";

// Converts USD value of data bundle price into ETH (wei i.e. 1 ETH = 10^18 wei)
// This amount of wei will also be deducted from Admin's wallet
async function convertETHToUSD(ethAmount) {

    const ethPriceUSD = await getETHPriceUSD();
    const usdAmount = ethAmount * ethPriceUSD;
    console.log(`1 ETH = $${ethPriceUSD.toFixed(2)} → $${ethAmount} ETH = $${usdAmount}`);

    return usdAmount;
}

/**
 * Verifies if the given transaction transferred ETH or a given ERC20 token to the VAULT.
 * Returns the amount (in human-readable units) transferred to the VAULT.
 *
 * @param {string} txHash - The transaction hash
 * @param {string} network - Network name (mainnet, polygon, arbitrum, base, optimism)
 * @param {string} tokenName - Token name ("ETH", "USDC", "USDT", "DAI")
 */
export async function getVaultTransferAmount(txHash, network, tokenName, VAULT) {
    const chain = CHAIN_MAP[network];
    if (!chain) throw new Error(`Unsupported network: ${network}`);

    const client = createPublicClient({
        chain,
        transport: http()
    });

    const normalizedVault = getAddress(VAULT);
    const normalizedToken = tokenName?.toUpperCase();

    if (!normalizedToken) throw new Error("Token name is required");

    let totalReceived = 0;
    let totalETHReceived = 0;

    // --- 1️⃣ Handle ETH ---
    if (normalizedToken === "ETH") {
        const tx = await client.getTransaction({ hash: txHash });
        console.dir(tx, { depth: null });

        if (!tx) throw new Error("Transaction not found");

        if (tx.to && getAddress(tx.to) === normalizedVault) {
            console.log("tx.value: ", tx.value);
            const value = Number(formatUnits(tx.value, 18));
            if (value > 0) totalETHReceived += value;
        }

        if(totalETHReceived > 0) {
            totalReceived = await convertETHToUSD(totalETHReceived);
            console.log("totalReceived: ", totalReceived);
        }

        return { amount: totalReceived, asset: "USD in ETH" };
    }
    // --- 2️⃣ Handle ERC20 tokens (USDC, USDT, DAI) ---
    else {
        const tx = await client.getTransactionReceipt({ hash: txHash });
        console.dir(tx, { depth: null });

        const tokenAddress = MAINNET_STABLECOINS[normalizedToken]?.[chain.id];
        if (!tokenAddress) {
            throw new Error(
                `Token ${normalizedToken} not supported on ${network} or missing from address map`
            );
        }

        const logs = parseEventLogs({
            abi: ERC20_ABI,
            logs: tx.logs
        });
        console.dir(logs, { depth: null });
        console.log("\n\n");

        for (const log of logs) {
            try {
                if (
                    log.eventName === "Transfer" &&
                    getAddress(log.args.to) === normalizedVault
                ) {
                    // Works for direct ERC20 token transfers
                    let decimals = normalizedToken === "USDC" || normalizedToken === "USDT" ? 6 : 18;
                    // Needed for tokens transfers via swaps. 
                    // A form user should be recommended to swap in a separate transaction before transferring the amount
                    if (log.args.value.toString().length >= 18) decimals = 18;
                    const amount = Number(formatUnits(log.args.value, decimals));
                    console.log("amount: ", amount);
                    totalReceived += amount;
                }
            } catch {
                // ignore unrelated logs
            }
        }

        console.log("totalReceived: ", totalReceived, "\n\n");
        return { amount: totalReceived, asset: normalizedToken };
    }
}

(async () => {

    const VAULT = "";

    // Test 1a: ETH mainnet
    // Check ETH transfer
    // const ethTx = await getVaultTransferAmount(
    //   "0xee787d54bba3b2ccbdc557f24f55630c59bc121eed6815f5be240669c4fe316d",
    //   "mainnet",
    //   "ETH",
    //   "0x468Bb7921b7B63c2C6c9303D2cDA3522c56902C8"
    // );
    // console.log(`Vault received ${ethTx.amount} ${ethTx.asset}`);

    // Test 1b
    // Check USDT transfer
    // const usdtTx = await getVaultTransferAmount(
    //   "0x76c3634abc71552c9632d36d2d72199f2b883537f587d66608c2050d734ac130",
    //   "mainnet",
    //   "USDT",
    //   "0x147AC0b39675769E55a0F0e7fdd3641b47963661"
    // );
    // console.log(`Vault received ${usdtTx.amount} ${usdtTx.asset}`);


    // Test 2a: Arbitrum
    // Check ETH transfer
    // const ethTx = await getVaultTransferAmount(
    //   "0x8d1b0b0bc76babda596f8cfd6c086e14702fb6e8c7e7adbc03257c5a252cb2ce",
    //   "arbitrum",
    //   "ETH",
    //   "0x8C826F795466E39acbfF1BB4eEeB759609377ba1"
    // );
    // console.log(`Vault received ${ethTx.amount} ${ethTx.asset}`);

    // Test 2b
    // Check USDC transfer
    // const usdcTx = await getVaultTransferAmount(
    //   "0x891d124d656048ac76881ab8ef2e5c18e904081026a156b8b8b72e3707bd0687",
    //   "arbitrum",
    //   "USDC",
    //   "0x65474A499D6d5008254b032b3FB21eD56B620db5"
    // );
    // console.log(`Vault received ${usdcTx.amount} ${usdcTx.asset}`);

    // Test 3a: Optimism
    // Check ETH transfer
    // const ethTx = await getVaultTransferAmount(
    //   "0x1a3a4955db80c9695950a0d8b8bd5df0203bc7efd4bff24bd459ab67a3f7710a",
    //   "optimism",
    //   "ETH",
    //   "0x58b704065B7aFF3ED351052f8560019E05925023"
    // );
    // console.log(`Vault received ${ethTx.amount} ${ethTx.asset}`);

    // Test 3b
    // Check USDC transfer
    // const usdcTx = await getVaultTransferAmount(
    //   "0xcff408dc4d14edf2e7cb9198ed116ea83e08086c0da2478a70c3bf3834d03e79",
    //   "optimism",
    //   "USDC",
    //   "0xf70da97812CB96acDF810712Aa562db8dfA3dbEF"
    // );
    // console.log(`Vault received ${usdcTx.amount} ${usdcTx.asset}`);

    // Test 4a: Base
    // Check ETH transfer
    // const ethTx = await getVaultTransferAmount(
    //   "0xc0aa3a06bd94bda9a90644ccc6609f24ecfbb2f01bcd9303cd2749b1560c0710",
    //   "base",
    //   "ETH",
    //   "0x113CFE0c2b2ec55Bb6D8ccBEa1AaaE5720c43dCC"
    // );
    // console.log(`Vault received ${ethTx.amount} ${ethTx.asset}`);

    // Test 4b
    // Check USDC transfer
    // const usdcTx = await getVaultTransferAmount(
    //   "0x3cc99cbd210a9e00e5dd7a00f2203eb39c74d202a988b0940fad236226e82a62",
    //   "base",
    //   "USDC",
    //   "0xfDE382e831b21dBbbe21DDCd05943533bf1d3ba7"
    // );
    // console.log(`Vault received ${usdcTx.amount} ${usdcTx.asset}`);
})();
