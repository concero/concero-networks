import axios from "axios";
import fs from "fs";
import * as process from "process";
import {Chain, DeploymentAddress, DeploymentType} from "./types";
import { calcHash } from './hash';

const v2ContractsBranch = 'feature/v3/dev'
const rpcsBranch = 'master'
const networksBranch = 'master'

type OldNetwork = {
    name: string,
    chainId: number,
    chainSelector: number,
    rpcUrls: [],
    blockExplorers:  {
        name: string,
        url: string,
        apiUrl: string
    }[],
    nativeCurrency: {
        name: string,
        symbol: string,
        decimals: number
    },
    finalityConfirmations: number,
    finalityTagEnabled?: boolean
}
type OldRPCs = {
    rpcUrls: string[], chainSelector: number, chainId: string, finalityTagEnabled?: boolean
}


const toCamelCaseKey = (raw: string) => raw
    .toLowerCase()
    .split('_')
    .map((p, i) =>
        i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)
    )
    .join('');

function buildExtractPipe(
    envText: string,
    regex: RegExp,
    deploymentType: DeploymentType,
    deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>
): void {
    let match: RegExpExecArray | null;

    while (match = regex.exec(envText)) {
        const [, chainRaw, address] = match;

        const chainName = toCamelCaseKey(chainRaw);
        deployments[chainName] = {
            ...deployments[chainName],
            [deploymentType]: address as DeploymentAddress,
        };
    }
}

export const pipeRouterDeployments = (envText: string, deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>) =>
    buildExtractPipe(envText, /CONCERO_ROUTER_PROXY_(?!ADMIN_)([A-Z0-9_]+)\s*=\s*(0x[a-fA-F0-9]{40})/g, DeploymentType.Router, deployments)

export const pipeRelayerLibDeployments = (envText: string, deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>) =>
    buildExtractPipe(envText, /CONCERO_RELAYER_LIB_PROXY_(?!ADMIN_)([A-Z0-9_]+)\s*=\s*(0x[a-fA-F0-9]{40})/g, DeploymentType.RelayerLib, deployments)

export const pipeValidatorLibDeployments = (envText: string, deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>>) =>
    buildExtractPipe(envText, /CONCERO_CRE_VALIDATOR_LIB_PROXY_(?!ADMIN_)([A-Z0-9_]+)\s*=\s*(0x[a-fA-F0-9]{40})/g, DeploymentType.ValidatorLib, deployments)


const main = async () => {
    const mainnetChains: Record<Chain['chainSelector'], Chain> = {}
    const testnetChains: Record<Chain['chainSelector'], Chain> = {}

    const enrich = (chainSelector: Chain['chainSelector'], chain: Chain) => {
        if (chain.isTestnet) {
            testnetChains[chainSelector] = chain
        } else {
            mainnetChains[chainSelector] = chain
        }
    }

    const [
        {data: mainnetDeployments},
        {data: testnetDeployments},
        {data: mainnetRPCs},
        {data: testnetRPCs},
        {data: mainnetNetworks},
        {data: testnetNetworks}
    ] = await Promise.all([
        axios.get<string>(`https://raw.githubusercontent.com/concero/messaging-contracts-v2/refs/heads/${v2ContractsBranch}/.env.deployments.mainnet`),
        axios.get<string>(`https://raw.githubusercontent.com/concero/messaging-contracts-v2/refs/heads/${v2ContractsBranch}/.env.deployments.testnet`),
        axios.get<Record<string, OldRPCs>>(
        `https://raw.githubusercontent.com/concero/rpcs/refs/heads/${rpcsBranch}/output/mainnet.json`
        ),
        axios.get<Record<string, OldRPCs>>(
        `https://raw.githubusercontent.com/concero/rpcs/refs/heads/${rpcsBranch}/output/testnet.json`
        ),
        axios.get<Record<string, OldNetwork>>(
            `https://raw.githubusercontent.com/concero/v2-networks/refs/heads/${networksBranch}/dist/networks/mainnet.json`
        ),
        axios.get<Record<string, OldNetwork>>(
            `https://raw.githubusercontent.com/concero/v2-networks/refs/heads/${networksBranch}/dist/networks/testnet.json`
        )
    ])

    const deployments: Record<string, Partial<Record<DeploymentType, DeploymentAddress>>> = {}
    const fullDeploymentsEnv = mainnetDeployments + testnetDeployments
    pipeRouterDeployments(fullDeploymentsEnv, deployments)
    pipeRelayerLibDeployments(fullDeploymentsEnv , deployments)
    pipeValidatorLibDeployments(fullDeploymentsEnv, deployments)

    Object.values(mainnetNetworks).map(network => {
        const rpcUrls = [...mainnetRPCs?.[network.name]?.rpcUrls, ...network?.rpcUrls]
        enrich(network.chainSelector, {
            id: network.chainId.toString(),
            ...(testnetNetworks?.[network.name]?.finalityTagEnabled && {finalityTagEnabled: true} ),
            chainSelector: network.chainSelector,
            name: network.name,
            rpcUrls,
            nativeCurrency: {name: network.nativeCurrency.name, decimals: network.nativeCurrency.decimals, symbol: network.nativeCurrency.symbol},
            blockExplorers: network.blockExplorers.map(i => ({name: i.name, url: i.url, apiUrl: i.apiUrl})),
            finalityConfirmations: network.finalityConfirmations,
            minBlockConfirmations: 1,
            deployments: deployments[network.name] ?? {}
        })
    })

    Object.values(testnetNetworks).map(network => {
        const rpcUrls = [...testnetRPCs?.[network.name]?.rpcUrls, ...network?.rpcUrls]
        enrich(network.chainSelector, {
            id: network.chainId.toString(),
            isTestnet: true,
            ...(testnetNetworks?.[network.name]?.finalityTagEnabled && {finalityTagEnabled: true} ),
            chainSelector: network.chainSelector,
            name: network.name,
            rpcUrls,
            nativeCurrency: {name: network.nativeCurrency.name, decimals: network.nativeCurrency.decimals, symbol: network.nativeCurrency.symbol},
            blockExplorers: network.blockExplorers.map(i => ({name: i.name, url: i.url, apiUrl: i.apiUrl})),
            finalityConfirmations: network.finalityConfirmations,
            minBlockConfirmations: 1,
            deployments: deployments[network.name] ?? {}
        })
    })

    fs.writeFileSync(`${process.cwd()}/output/chains.mainnet.json`, JSON.stringify(mainnetChains, null, 2))
    fs.writeFileSync(`${process.cwd()}/output/chains.mainnet.minified.json`, JSON.stringify(mainnetChains))

    fs.writeFileSync(`${process.cwd()}/output/chains.testnet.json`, JSON.stringify(testnetChains, null, 2))
    fs.writeFileSync(`${process.cwd()}/output/chains.testnet.minified.json`, JSON.stringify(testnetChains))


    fs.writeFileSync(`${process.cwd()}/output/chains.json`, JSON.stringify({...testnetChains, ...mainnetChains}, null, 2))
    fs.writeFileSync(`${process.cwd()}/output/chains.minified.json`, JSON.stringify({...testnetChains, ...mainnetChains}))
}

main().then(() => calcHash())
