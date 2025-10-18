// buyDataBundle.js
import dotenv from 'dotenv';
dotenv.config();

import {
    createWalletClient,
    createPublicClient,
    http,
    parseUnits,
    parseAbiItem,
    formatEther
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
// Used to fetch real-time ETH price in USD
import { getETHPriceUSD } from './getETHPrice.js';

// Import ABIs
import DeviceWalletFactoryABI from './ABIs/DeviceWalletFactory.json' with { type: 'json' };
import DeviceWalletABI from './ABIs/DeviceWallet.json' with { type: 'json' };
import ESIMWalletABI from './ABIs/ESIMWallet.json' with { type: 'json' };

const PRIVATE_KEY = process.env.ESIM_WALLET_ADMIN_PRIVATE_KEY;
const ALCHEMY_BASE_SEPOLIA_RPC_URL = process.env.ALCHEMY_BASE_SEPOLIA_RPC_URL;
// Base Sepolia address
const DEVICE_WALLET_FACTORY_ADDRESS = process.env.DEVICE_WALLET_FACTORY_ADDRESS;

const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(`${ALCHEMY_BASE_SEPOLIA_RPC_URL}`)
});

const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(`${ALCHEMY_BASE_SEPOLIA_RPC_URL}`)
});

// Converts USD value of data bundle price into ETH (wei i.e. 1 ETH = 10^18 wei)
// This amount of wei will also be deducted from Admin's wallet
async function convertUsdToETH(usdAmount) {

    const ethPriceUSD = await getETHPriceUSD();
    const ethAmount = usdAmount / ethPriceUSD;
    console.log(`1 ETH = $${ethPriceUSD.toFixed(2)} → $${usdAmount} = ${ethAmount} ETH`);

    const weiAmount = parseUnits(ethAmount.toString(), 18);

    return weiAmount;
}

// 1. To be called only ONCE after device wallet is deployed by the user from the app
export async function postCreateAccount(deviceWalletAddress) {

    const deviceUniqueIdentifier = await publicClient.readContract({
        address: deviceWalletAddress,
        abi: DeviceWalletABI,
        functionName: 'deviceUniqueIdentifier'
    })
    console.log("deviceUniqueIdentifier: ", deviceUniqueIdentifier);

    const ownerX = await publicClient.readContract({
        address: deviceWalletAddress,
        abi: DeviceWalletABI,
        functionName: 'owner',
        args: [0]
    })
    console.log("ownerX: ", ownerX);

    const ownerY = await publicClient.readContract({
        address: deviceWalletAddress,
        abi: DeviceWalletABI,
        functionName: 'owner',
        args: [1]
    })
    console.log("ownerY: ", ownerY);

    // Call postCreateAccount function on Device wallet factory
    // Necessary for all device wallet's deployed through mobile app
    const hash = await walletClient.writeContract({
        address: DEVICE_WALLET_FACTORY_ADDRESS,
        abi: DeviceWalletFactoryABI,
        functionName: 'postCreateAccount',
        args: [deviceWalletAddress, deviceUniqueIdentifier, [ownerX, ownerY]]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
    console.log(`postCreateAccount Tx Hash: ${receipt.transactionHash}`);

    return true;
}

// 2. ADMIN: Deploy eSIM wallet for the user
export async function deployESIMWallet(deviceWalletAddress, salt) {

    const eSIMWalletAdmin = await publicClient.readContract({
        address: DEVICE_WALLET_FACTORY_ADDRESS,
        abi: DeviceWalletFactoryABI,
        functionName: 'eSIMWalletAdmin',
    });
    console.log("eSIMWalletAdmin: ", eSIMWalletAdmin);

    // Checks if the one deploying the wallet is actually the admin
    if (account.address !== eSIMWalletAdmin) {
        throw new Error("ERROR: Unauthorised caller. Not the ADMIN");
    }

    const hash = await walletClient.writeContract({
        address: deviceWalletAddress,
        abi: DeviceWalletABI,
        functionName: 'deployESIMWallet',
        args: [true, salt]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
    console.log(`deployESIMWallet Tx Hash: ${receipt.transactionHash}`);

    const logs = await publicClient.getLogs({
        address: deviceWalletAddress,
        event: parseAbiItem('event ESIMWalletAdded(address indexed _eSIMWalletAddress,bool _hasAccessToETH,address indexed _caller)'),
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
    });

    if (logs.length > 0) {
        const { args } = logs[0];
        console.log("Deployed eSIM Wallet:", args._eSIMWalletAddress);
        console.log("Has access to ETH:", args._hasAccessToETH);
        console.log("Added by:", args._caller);

        return args._eSIMWalletAddress;
    };

    return "0x";
}

// 3. ADMIN: Set eSIM unique identifier for the eSIM wallet
export async function setESIMUniqueIdentifierForAnESIMWallet(deviceWalletAddress, eSIMWalletAddress, eSIMUniqueIdentifier) {

    const hash = await walletClient.writeContract({
        address: deviceWalletAddress,
        abi: DeviceWalletABI,
        functionName: 'setESIMUniqueIdentifierForAnESIMWallet',
        args: [eSIMWalletAddress, eSIMUniqueIdentifier]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
    console.log(`setESIMUniqueIdentifierForAnESIMWallet Tx Hash: ${receipt.transactionHash}`);
}

// 4. ADMIN: Buy data bundle for the user. ADMIN pays the amount
// NOTE: ONLY for TESTNET
// For MAINNET, value should be 0 (as admin won't pay for users' data bundle)
export async function buyDataBundle(deviceWalletAddress, eSIMWalletAddress, dataBundleID, dataBundlePriceUSD) {

    const isValidESIMWallet = await publicClient.readContract({
        address: deviceWalletAddress,
        abi: DeviceWalletABI,
        functionName: 'isValidESIMWallet',
        args: [eSIMWalletAddress]
    });
    console.log("isValidESIMWallet: ", isValidESIMWallet);

    if(!isValidESIMWallet) {
        throw new Error("ERROR: Unknown eSIM wallet. Not associated with Device wallet");
    }

    const ethValue = await convertUsdToETH(dataBundlePriceUSD);
    console.log(`dataBundle price in ETH: ${ethValue}wei = ${formatEther(ethValue)}ETH`);

    const hash = await walletClient.writeContract({
        address: eSIMWalletAddress,
        abi: ESIMWalletABI,
        functionName: 'buyDataBundle',
        args: [{ dataBundleID, dataBundlePrice: ethValue }],
        value: ethValue,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
    console.log(`buyDataBundle Tx Hash: ${receipt.transactionHash}`);
}

// === Example run ===
// if (require.main === module) {
//   ;(async () => {
//     await buyDataBundle({
//         // deviceWalletAddress: '0x857a11Ce72A0eaCE023eF01d3f174685Adb13679',
//         deviceWalletAddress: '0x8a829eEde6A6f2d8F3B322f498764Dc4E1Fc55B6',
//       dataBundleID: 'Argentina_10GB_30days',
//       dataBundlePriceUSD: 26.5, // $26.5 bundle
//     })
//   })()
// }

(async () => {
    // SHOULD NOT BE HARDCODED
    const deviceWalletAddress = "0x857a11Ce72A0eaCE023eF01d3f174685Adb13679";
    console.log("deviceWalletAddress: ", deviceWalletAddress);

    // SHOULD NOT BE HARDCODED
    const eSIMUniqueIdentifier = "Test_HashedUiccID_02";
    console.log("eSIMUniqueIdentifier: ", eSIMUniqueIdentifier);

    // SHOULD NOT BE HARDCODED
    const dataBundleID = "Argentina_3GB_30days";
    console.log("dataBundleID: ", dataBundleID);

    // SHOULD NOT BE HARDCODED
    const dataBundlePriceUSD = 10; // $10 bundle
    console.log("dataBundlePriceUSD: ", dataBundlePriceUSD);

    // 1. Checks if the device wallet is correctly registered in the SC suite
    const deviceWalletInfoAdded = await publicClient.readContract({
        address: DEVICE_WALLET_FACTORY_ADDRESS,
        abi: DeviceWalletFactoryABI,
        functionName: 'deviceWalletInfoAdded',
        args: [deviceWalletAddress]
    })
    console.log("Is deviceWalletInfoAdded? ", deviceWalletInfoAdded);

    // 2. If the device wallet is newly deployed 
    // i.e. it does not exist in the DB, then call postCreateAccount function
    // If the device wallet already exist, then no need to call this function
    // Add DB validation check for calling this function
    if(!deviceWalletInfoAdded) {
        await postCreateAccount(deviceWalletAddress);
        console.log("deviceWalletInfoAdded: ", deviceWalletInfoAdded);
    }

    // BACKEND TODO: Either store salt for eSIM wallets to avoid collision, or generate uniquely
    // NOTE: SALT cannot be same for eSIM wallets being deployed to the same device wallet 
    // To make sure salt is unique, it can be generated on the go using something like:
    // keccak256(encodePacked("Kokio_Alpha_v1", deviceWalletAddress, encryptedOrHashedUiccId, timestamp), bytes)
    // The above keccak256 hash would produce 256 bit hash
    const SALT = 923n;

    // 3. Deploy the eSIM wallet 
    const eSIMWalletAddress = await deployESIMWallet(
        deviceWalletAddress,
        SALT
    );
    console.log("eSIMWalletAddress: ", eSIMWalletAddress);

    if(eSIMWalletAddress === "0x") {
        throw new Error("ERROR: eSIM Wallet could not be deployed. Retry!!!");
    }

    // 4. Set eSIM unique identifier for the newly deployed eSIM wallet
    await setESIMUniqueIdentifierForAnESIMWallet(
        deviceWalletAddress,
        eSIMWalletAddress,
        eSIMUniqueIdentifier
    );

    // 5. Buy data bundle for the user
    // ONLY FOR TESTNET
    await buyDataBundle(
        deviceWalletAddress,
        eSIMWalletAddress,
        dataBundleID,
        dataBundlePriceUSD
    );
})()

// module.exports = { buyDataBundle }
