// lazyWalletRegistry.js
import dotenv from 'dotenv';
dotenv.config();

import {
    createWalletClient,
    createPublicClient,
    http,
    parseAbiItem,
    formatEther,
} from 'viem';

import { baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Import ABI
import LazyWalletRegistryABI from './ABIs/LazyWalletRegistry.json' with { type: 'json' };

const PRIVATE_KEY = process.env.ESIM_WALLET_ADMIN_PRIVATE_KEY;
const ALCHEMY_BASE_SEPOLIA_RPC_URL = process.env.ALCHEMY_BASE_SEPOLIA_RPC_URL;

// Base Sepolia LazyWalletRegistry proxy address
const LAZY_WALLET_REGISTRY_ADDRESS = process.env.LAZY_WALLET_REGISTRY_ADDRESS;

if (!PRIVATE_KEY) {
    throw new Error('Missing ESIM_WALLET_ADMIN_PRIVATE_KEY');
}

if (!ALCHEMY_BASE_SEPOLIA_RPC_URL) {
    throw new Error('Missing ALCHEMY_BASE_SEPOLIA_RPC_URL');
}

if (!LAZY_WALLET_REGISTRY_ADDRESS) {
    throw new Error('Missing LAZY_WALLET_REGISTRY_ADDRESS');
}

const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(ALCHEMY_BASE_SEPOLIA_RPC_URL),
});

const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(ALCHEMY_BASE_SEPOLIA_RPC_URL),
});

/**
 * 1. READ: deviceIdentifierToESIMDetails
 *    RETURNS: DataBundleDetails {
 *                  string dataBundleID;
 *                  uint256 dataBundlePrice;
 *             }
 *
 * Solidity mapping:
 * mapping(string => mapping(string => DataBundleDetails[])) public deviceIdentifierToESIMDetails;
 *
 * List of data bundles should be known before hand.
 * Loop through the indexes to fetch each data bundle detail
 * 
 * Solidity-generated getter requires:
 * - device identifier
 * - eSIM identifier
 * - array index
 *
 * For the full eSIM list for a device Backend DB is better
 * For the full data bundle history	Backend DB is better
 * For production backend, do not rely on blind index reads like 0, 1, 2... until revert.
 * Store the history in DB when calling batchPopulateHistory.
 * 
 * It does NOT return the full DataBundleDetails[] array.
 */
export async function getDeviceIdentifierToESIMDetails(
    deviceUniqueIdentifier,
    eSIMUniqueIdentifier,
    dataBundleIndex
) {
    const dataBundleDetails = await publicClient.readContract({
        address: LAZY_WALLET_REGISTRY_ADDRESS,
        abi: LazyWalletRegistryABI,
        functionName: 'deviceIdentifierToESIMDetails',
        args: [
            deviceUniqueIdentifier,
            eSIMUniqueIdentifier,
            BigInt(dataBundleIndex),
        ],
    });

    console.log('deviceIdentifierToESIMDetails:', dataBundleDetails);

    return dataBundleDetails;
}

/**
 * 2. READ: eSIMIdentifierToDeviceIdentifier
 * 
 * RETURNS: deviceIdentifier
 *
 * Solidity mapping:
 * mapping(string => string) public eSIMIdentifierToDeviceIdentifier;
 * 
 */
export async function getDeviceIdentifierForESIMIdentifier(eSIMUniqueIdentifier) {
    const deviceUniqueIdentifier = await publicClient.readContract({
        address: LAZY_WALLET_REGISTRY_ADDRESS,
        abi: LazyWalletRegistryABI,
        functionName: 'eSIMIdentifierToDeviceIdentifier',
        args: [eSIMUniqueIdentifier],
    });

    console.log('deviceUniqueIdentifier:', deviceUniqueIdentifier);

    return deviceUniqueIdentifier;
}

/**
 * 3. READ: eSIMIdentifiersAssociatedWithDeviceIdentifier
 *    RETURNS: eSIMIdentifier
 *
 * Solidity mapping:
 * mapping(string => string[]) public eSIMIdentifiersAssociatedWithDeviceIdentifier;
 *
 * Number of eSIMs associated with a device should be tracked by DB
 * Loop through the indexes to fetch each eSIM identifier
 * 
 * Solidity-generated getter requires:
 * - device identifier
 * - array index
 *
 * Ideally, Backend DB is better
 * 
 * It does NOT return the full string[] array.
 */
export async function getESIMIdentifierAssociatedWithDeviceIdentifier(
    deviceUniqueIdentifier,
    eSIMIndex
) {
    const eSIMUniqueIdentifier = await publicClient.readContract({
        address: LAZY_WALLET_REGISTRY_ADDRESS,
        abi: LazyWalletRegistryABI,
        functionName: 'eSIMIdentifiersAssociatedWithDeviceIdentifier',
        args: [
            deviceUniqueIdentifier,
            BigInt(eSIMIndex),
        ],
    });

    console.log('eSIMUniqueIdentifier:', eSIMUniqueIdentifier);

    return eSIMUniqueIdentifier;
}

/**
 * 4. READ: isLazyWalletDeployed
 *    RETURNS: BOOL
 * 
 * Check if a FIAT user has deployed their lazy wallet
 * 
 * If the wallet has been deployed, then the lazy wallet registry should no longer be used
 * Use the deployed device wallet and esim wallet for future txs
 * 
 */
export async function isLazyWalletDeployed(deviceUniqueIdentifier) {
    const deployed = await publicClient.readContract({
        address: LAZY_WALLET_REGISTRY_ADDRESS,
        abi: LazyWalletRegistryABI,
        functionName: 'isLazyWalletDeployed',
        args: [deviceUniqueIdentifier],
    });

    console.log('isLazyWalletDeployed:', deployed);

    return deployed;
}

/**
 * 5. ADMIN WRITE: batchPopulateHistory
 * 
 * Should be called for all the FIAT transactions.
 * Its up to the ADMIN to decide, if they want to batch multiple FIAT txs into one
 * or, use this to process single tx per function call
 *
 * Solidity:
 * batchPopulateHistory(
 *   string[] calldata _deviceUniqueIdentifiers,
 *   string[][] calldata _eSIMUniqueIdentifiers,
 *   DataBundleDetails[][] calldata _dataBundleDetails
 * )
 *
 * Shape:
 *
 * deviceUniqueIdentifiers = [
 *   "Device_1",
 *   "Device_2"
 * ]
 *
 * eSIMUniqueIdentifiers = [
 *   ["eSIM_1", "eSIM_1", "eSIM_2"],
 *   ["eSIM_3"]
 * ]
 *
 * dataBundleDetails = [
 *   [
 *     { dataBundleID: "Argentina_3GB_30days", dataBundlePrice: 10000000000000000n },
 *     { dataBundleID: "Argentina_10GB_30days", dataBundlePrice: 20000000000000000n },
 *     { dataBundleID: "India_5GB_30days", dataBundlePrice: 15000000000000000n }
 *   ],
 *   [
 *     { dataBundleID: "Japan_1GB_7days", dataBundlePrice: 5000000000000000n }
 *   ]
 * ]
 */
export async function batchPopulateHistory(
    deviceUniqueIdentifiers,
    eSIMUniqueIdentifiers,
    dataBundleDetails
) {
    if (deviceUniqueIdentifiers.length !== eSIMUniqueIdentifiers.length) {
        throw new Error('Unequal array length: deviceUniqueIdentifiers and eSIMUniqueIdentifiers');
    }

    if (deviceUniqueIdentifiers.length !== dataBundleDetails.length) {
        throw new Error('Unequal array length: deviceUniqueIdentifiers and dataBundleDetails');
    }

    const hash = await walletClient.writeContract({
        address: LAZY_WALLET_REGISTRY_ADDRESS,
        abi: LazyWalletRegistryABI,
        functionName: 'batchPopulateHistory',
        args: [
            deviceUniqueIdentifiers,
            eSIMUniqueIdentifiers,
            dataBundleDetails,
        ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 2,
    });

    console.log(`batchPopulateHistory Tx Hash: ${receipt.transactionHash}`);

    return receipt;
}

/**
 * 6. ADMIN WRITE: deployLazyWalletAndSetESIMIdentifier
 * 
 * Should be used to deploy a LAZY wallet for a FIAT user.
 * Once the wallet is deployed, use device wallet and esim wallet for txs.
 *
 * This function deployes the device wallet and esim wallet
 * and also sets the eSIM identifier in the same tx.
 * NO NEED TO CALL `setESIMUniqueIdentifierForAnESIMWallet` after this function
 * 
 * ONLY ADMIN can call this function. ADMIN MUST PAY FOR THE TX.
 * 
 * Solidity:
 * deployLazyWalletAndSetESIMIdentifier(
 *   bytes32[2] memory _deviceOwnerPublicKey,
 *   string calldata _deviceUniqueIdentifier,
 *   uint256 _salt,
 *   uint256 _depositAmount
 * )
 *
 * IMPORTANT:
 * - _depositAmount must equal msg.value.
 * - The device must already have populated eSIM history.
 * - The lazy wallet must not already be deployed.
 */
export async function deployLazyWalletAndSetESIMIdentifier(
    deviceOwnerPublicKey,
    deviceUniqueIdentifier,
    salt,
    depositAmount
) {
    const alreadyDeployed = await isLazyWalletDeployed(deviceUniqueIdentifier);

    if (alreadyDeployed) {
        throw new Error('ERROR: Lazy wallet already deployed for this device identifier');
    }

    console.log('deviceOwnerPublicKey:', deviceOwnerPublicKey);
    console.log('deviceUniqueIdentifier:', deviceUniqueIdentifier);
    console.log('salt:', salt);
    console.log(`depositAmount: ${depositAmount} wei = ${formatEther(depositAmount)} ETH`);

    const hash = await walletClient.writeContract({
        address: LAZY_WALLET_REGISTRY_ADDRESS,
        abi: LazyWalletRegistryABI,
        functionName: 'deployLazyWalletAndSetESIMIdentifier',
        args: [
            deviceOwnerPublicKey,
            deviceUniqueIdentifier,
            BigInt(salt),
            depositAmount,
        ],
        value: depositAmount,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 2,
    });

    console.log(`deployLazyWalletAndSetESIMIdentifier Tx Hash: ${receipt.transactionHash}`);

    const logs = await publicClient.getContractEvents({
        address: LAZY_WALLET_REGISTRY_ADDRESS,
        abi: LazyWalletRegistryABI,
        eventName: 'LazyWalletDeployed',
        fromBlock: receipt.blockNumber,
        toBlock: receipt.blockNumber,
    });

    if (logs.length > 0) {
        const { args } = logs[0];

        console.log('Lazy wallet deployed');
        console.log('deviceWallet:', args.deviceWallet);
        console.log('eSIMWallets:', args.eSIMWallets);
        console.log('_deviceUniqueIdentifier:', args._deviceUniqueIdentifier);
        console.log('_eSIMUniqueIdentifiers:', args._eSIMUniqueIdentifiers);

        return {
            deviceWallet: args.deviceWallet,
            eSIMWallets: args.eSIMWallets,
            deviceUniqueIdentifier: args._deviceUniqueIdentifier,
            eSIMUniqueIdentifiers: args._eSIMUniqueIdentifiers,
            receipt,
        };
    }

    return {
        deviceWallet: '0x',
        eSIMWallets: [],
        deviceUniqueIdentifier,
        eSIMUniqueIdentifiers: [],
        receipt,
    };
}

/**
 * 7. ADMIN WRITE: switchESIMIdentifierToNewDeviceIdentifier
 *
 * This is a feature function. Needed when a user is a FIAT user and wants to
 * switch their eSIM to a new device. 
 * The function would need help from BFF and Kokio app in identifying and authenticating
 * that a given eSIM was tranferred (or the user requests from the App to transfer the eSIM to new device)
 * from an old to a new device.
 * 
 * FEATURE NOT PART OF BETA - BFF and App need to be ready for this feature to work
 * 
 * Solidity:
 * switchESIMIdentifierToNewDeviceIdentifier(
 *   string calldata _eSIMIdentifier,
 *   string calldata _oldDeviceIdentifier,
 *   string calldata _newDeviceIdentifier
 * )
 */
export async function switchESIMIdentifierToNewDeviceIdentifier(
    eSIMIdentifier,
    oldDeviceIdentifier,
    newDeviceIdentifier
) {
    if (!eSIMIdentifier || eSIMIdentifier.length === 0) {
        throw new Error('ERROR: eSIMIdentifier 0');
    }

    if (!newDeviceIdentifier || newDeviceIdentifier.length === 0) {
        throw new Error('ERROR: newDeviceIdentifier 0');
    }

    const currentDeviceIdentifier = await getDeviceIdentifierForESIMIdentifier(eSIMIdentifier);

    if (!currentDeviceIdentifier || currentDeviceIdentifier.length === 0) {
        throw new Error('ERROR: Unknown eSIM identifier');
    }

    if (currentDeviceIdentifier !== oldDeviceIdentifier) {
        throw new Error('ERROR: Incorrect old device identifier');
    }

    if (currentDeviceIdentifier === newDeviceIdentifier) {
        throw new Error('ERROR: Cannot switch to same device');
    }

    const hash = await walletClient.writeContract({
        address: LAZY_WALLET_REGISTRY_ADDRESS,
        abi: LazyWalletRegistryABI,
        functionName: 'switchESIMIdentifierToNewDeviceIdentifier',
        args: [
            eSIMIdentifier,
            oldDeviceIdentifier,
            newDeviceIdentifier,
        ],
    });

    const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 2,
    });

    console.log(`switchESIMIdentifierToNewDeviceIdentifier Tx Hash: ${receipt.transactionHash}`);

    return receipt;
}

// ============================================================================
// Example run
// ============================================================================

(async () => {
    /**
     * Example values.
     * Replace all hardcoded values with backend/user/app values.
     */

    const deviceUniqueIdentifier = `Test_Device_${Date.now()}`;
    const eSIMUniqueIdentifier = `Test_eSIM_${Date.now()}`;
    const ownerX = '';
    const owenrY = '';

    const deviceOwnerPublicKey = [
        '0x0000000000000000000000000000000000000000000000000000000000000001',
        '0x0000000000000000000000000000000000000000000000000000000000000002',
    ];

    const dataBundleID = 'Argentina_3GB_30days';

    /**
     * This must already be in wei.
     *
     * For lazy fiat history, this should usually represent the on-chain stored
     * bundle price value expected by your contract suite.
     */
    const dataBundlePrice = 10_000_000_000_000_000n; // 0.01 ETH

    /**
     * 1. Check if lazy wallet is already deployed.
     */
    const lazyWalletDeployed = await isLazyWalletDeployed(deviceUniqueIdentifier);

    if (lazyWalletDeployed) {
        console.log('Lazy wallet already deployed. Skipping history population and deployment.');
        return;
    }

    /**
     * 2. Populate fiat/off-chain purchase history before lazy wallet deployment.
     *
     * NOTE:
     * The same eSIM identifier can appear multiple times if multiple bundles
     * were bought for the same eSIM.
     */
    await batchPopulateHistory(
        [deviceUniqueIdentifier],
        [
            [
                eSIMUniqueIdentifier,
            ],
        ],
        [
            [
                {
                    dataBundleID,
                    dataBundlePrice,
                },
            ],
        ],
    );

    /**
     * 3. Read mapped device identifier for eSIM.
     */
    await getDeviceIdentifierForESIMIdentifier(eSIMUniqueIdentifier);

    /**
     * 4. Read first associated eSIM identifier for device.
     *
     * NOTE:
     * There is no automatic full-array getter for this mapping.
     * You must know the index or track the list from backend/events.
     */
    await getESIMIdentifierAssociatedWithDeviceIdentifier(
        deviceUniqueIdentifier,
        0,
    );

    /**
     * 5. Read first data bundle detail for device + eSIM.
     *
     * NOTE:
     * There is no automatic full-array getter for this nested mapping.
     * You must know the index or track count from backend/events.
     */
    await getDeviceIdentifierToESIMDetails(
        deviceUniqueIdentifier,
        eSIMUniqueIdentifier,
        0,
    );

    /**
     * 6. Deploy lazy wallet and corresponding eSIM wallets.
     *
     * _depositAmount must equal msg.value.
     *
     * Testnet example:
     * depositAmount can be > 0 if you want to fund the device wallet.
     *
     * Mainnet:
     * choose based on actual production flow.
     */
    const SALT = 923n;
    const depositAmount = 0n;

    const lazyWalletDeploymentResult = await deployLazyWalletAndSetESIMIdentifier(
        deviceOwnerPublicKey,
        deviceUniqueIdentifier,
        SALT,
        depositAmount,
    );

    console.log('lazyWalletDeploymentResult:', lazyWalletDeploymentResult);

    /**
     * 7. Optional: switch eSIM identifier to a new device identifier.
     *
     * Uncomment only when needed.
     */

    // const newDeviceUniqueIdentifier = 'Test_Device_Identifier_02';

    // await switchESIMIdentifierToNewDeviceIdentifier(
    //     eSIMUniqueIdentifier,
    //     deviceUniqueIdentifier,
    //     newDeviceUniqueIdentifier,
    // );

})();
