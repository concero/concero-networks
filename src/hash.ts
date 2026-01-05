import fs from "fs";
import {sha256} from 'viem'



export const calcHash = () => {
    const testnetChains = fs.readFileSync('./output/chains.testnet.minified.json')
    const mainnetChains = fs.readFileSync('./output/chains.mainnet.minified.json')

    console.table([{
        testnet_hash: sha256(testnetChains),
        mainnet_hash: sha256(mainnetChains),
    }])
}
