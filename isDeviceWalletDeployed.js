// isDeviceWalletDeployed.js
import dotenv from 'dotenv';
dotenv.config();

import {
    createPublicClient,
    http
} from 'viem';
import { baseSepolia } from 'viem/chains';

// Import ABIs
import RegistryABI from './ABIs/Registry.json' with { type: 'json' };

const ALCHEMY_BASE_SEPOLIA_RPC_URL = process.env.ALCHEMY_BASE_SEPOLIA_RPC_URL;
// Base Sepolia Registry address
const REGISTRY_ADDRESS = process.env.REGISTRY_ADDRESS;

const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(`${ALCHEMY_BASE_SEPOLIA_RPC_URL}`)
});

// Checks if the given device wallet is deployed and registered in the Registry
// Returns true if the device wallet is valid/deployed, false otherwise
export async function isDeviceWalletDeployed(deviceWalletAddress) {

    const isDeployed = await publicClient.readContract({
        address: REGISTRY_ADDRESS,
        abi: RegistryABI,
        functionName: 'isDeviceWalletValid',
        args: [deviceWalletAddress]
    });
    console.log(`isDeviceWalletDeployed (${deviceWalletAddress}): `, isDeployed);

    return isDeployed;
}

// === Example run ===
(async () => {
    // SHOULD NOT BE HARDCODED
    const deviceWalletAddress = "0x857a11Ce72A0eaCE023eF01d3f174685Adb13679";
    console.log("deviceWalletAddress: ", deviceWalletAddress);

    await isDeviceWalletDeployed(deviceWalletAddress);

    // Explicitly exit, otherwise the HTTP transport's keep-alive
    // connection can keep the Node process alive
    process.exit(0);
})()
