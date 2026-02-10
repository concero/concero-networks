import fs from 'fs';
import { sha256 } from 'viem';

export const calcHash = () => {
    const testnetChains = fs.readFileSync('./output/chains.testnet.minified.json');
    const mainnetChains = fs.readFileSync('./output/chains.mainnet.minified.json');
    const stageChains = fs.readFileSync('./output/chains.stage.minified.json');
    const compressedMainnetChains = fs.readFileSync('./output/chains.mainnet.compressed.json');

    console.table([
        {
            testnet_hash: sha256(testnetChains),
            mainnet_hash: sha256(mainnetChains),
            compressed_mainnet_hash: sha256(compressedMainnetChains),
            stage_hash: sha256(stageChains),
        },
    ]);
};
