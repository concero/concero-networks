import fs from "fs";
import {sha256} from 'viem'

const raw = fs.readFileSync('./output/chains.minified.json')

export const calcHash = () => {
    console.log({
        hash: sha256(raw),
    })
}