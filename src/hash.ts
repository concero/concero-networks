import fs from "fs";
import {sha256} from 'viem'

const base = fs.readFileSync('./output/chains.minified.json')
const minified = fs.readFileSync('./output/chains.minified.json')

console.log({
    base: sha256(base),
    minified: sha256(minified)
})