// getEthPrice.js (CommonJS)
import dotenv from 'dotenv';
dotenv.config();

import { createPublicClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import AggregatorV3InterfaceABI from '@chainlink/contracts/abi/v0.8/AggregatorV3Interface.json' with { type: 'json' };

// Chainlink ETH/USD aggregator address (base sepolia)
const CHAINLINK_ETH_USD_FEED = '0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1';

const client = createPublicClient({
    chain: baseSepolia,
    transport: http(`${process.env.CHAINSTACK_HTTP_BASE_RPC}`)
});

export async function getETHPriceUSD() {
    // latestRoundData returns (roundId, answer, startedAt, updatedAt, answeredInRound)
    const [, answer] = await client.readContract({
        address: CHAINLINK_ETH_USD_FEED,
        abi: AggregatorV3InterfaceABI,
        functionName: 'latestRoundData',
    });
    console.log(Number(answer) / 1e8);
    return Number(answer) / 1e8;
}

